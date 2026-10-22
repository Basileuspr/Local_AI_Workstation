"""Synthetic desktop + HTTPS mobile gateway for Chromium QA. Temp data only."""
import asyncio
import hashlib
import io
import ipaddress
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from PIL import Image

work = Path(os.environ["LAW_MOBILE_QA_DIR"])
assert Path(os.environ["LAW_DATA_DIR"]).is_relative_to(work)
import main
from routes import image_generation
from routes import mobile as mobile_routes
from services import image_library, image_store, session_store
from services.mobile_companion import MobileCompanion, MobileListen
from services.session_guard import SessionGuard


async def prepare(_kind):
    pass


async def chat(_request, _client):
    async def stream():
        for word in "A response streamed from your desktop.".split(" "):
            await asyncio.sleep(.4)
            yield "data: " + json.dumps({"token": word + " ", "done": False}) + "\n\n"
        yield 'data: {"done":true}\n\n'
    return StreamingResponse(stream(), media_type="text/event-stream")


def generate(request, *args, **kwargs):
    import time
    if os.environ.get("LAW_MOBILE_QA_HOLD_IMAGES") == "1":
        deadline = time.monotonic() + 60
        while not (work / "release-image-jobs").exists():
            if time.monotonic() > deadline:
                raise RuntimeError("Image queue fixture was not released")
            time.sleep(.05)
    time.sleep(1)
    (work / "image-request.json").write_text(json.dumps(request.model_dump(), default=str))
    data = io.BytesIO()
    Image.new("RGB", (request.width, request.height), "#427c83").save(data, "PNG")
    return {"filename": "Mobile creation.png", "image_ref": image_store.put_bytes(data.getvalue()), "seed": 42}


main._chat = chat
main.prepare_runtime = image_generation.prepare_runtime = prepare
image_generation._generate_image = generate
image_library.public_index = lambda: {"images": [], "folders": []}
desktop = FastAPI()
desktop.add_middleware(SessionGuard)
desktop.post("/chat")(main.chat)
desktop.post("/chat/stop/{request_id}")(main.stop_chat)
desktop.get("/health")(lambda: {"ok": True})
desktop.get("/models")(lambda: {"models": [{"name": "Fixture chat model"}]})
# Register fixture discovery before included routes, which FastAPI may defer.
desktop.get("/image-generation/models")(lambda: {"models": [{"id": "fixture-image", "name": "Fixture image model"}],
    "loras": [{"id": "fixture-adapter", "name": "Fixture adapter", "base_model_id": "fixture-image"}], "runtime": {"ready": True}})
desktop.include_router(image_generation.router)
desktop.include_router(mobile_routes.router)

session = session_store.create_session("Weekend ideas")
session_store.append_messages(session["id"], [{"id": "welcome", "role": "assistant", "content": "What would you like to explore today?"}])
for index, color in enumerate(("#a9b9a2", "#bb866c", "#547f91", "#d1bba0", "#7d8d78", "#bd9d97")):
    data = io.BytesIO()
    Image.new("RGB", (1200, 800), color).save(data, "PNG")
    session_store.append_messages(session["id"], [{"id": f"picture-{index}", "role": "assistant", "content": f"Study {index + 1}",
        "generatedImages": [{"id": f"image-{index}", "name": f"Color study {index + 1}.png", "src": image_store.put_bytes(data.getvalue())}]}])
original = data.getvalue()

key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Mobile QA fixture")])
now = datetime.now(timezone.utc)
cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
    .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=1))
    .not_valid_after(now + timedelta(days=1))
    .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), False)
    .sign(key, hashes.SHA256()))
cert_path, key_path = work / "fixture.pem", work / "fixture.key"
cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
origin = "https://127.0.0.1:" + os.environ["LAW_MOBILE_QA_PORT"]
mobile = MobileCompanion(work / "mobile", "http://127.0.0.1:" + os.environ["LAW_PORT"],
    os.environ["LAW_SESSION_TOKEN"], Path(os.environ.get("LAW_MOBILE_BUILD_DIR") or Path(__file__).resolve().parents[2] / "dist" / "mobile"))
mobile_routes._instance = mobile
mobile.start(MobileListen(origin=origin, address="127.0.0.1", port=int(os.environ["LAW_MOBILE_QA_PORT"]),
    certificate=str(cert_path), private_key=str(key_path)))
(work / "ready.json").write_text(json.dumps({"origin": origin, "code": mobile.invitation()["code"], "session_id": session["id"],
    "fingerprint": cert.fingerprint(hashes.SHA256()).hex(), "download_sha256": hashlib.sha256(original).hexdigest()}))
try:
    uvicorn.run(desktop, host="127.0.0.1", port=int(os.environ["LAW_PORT"]), access_log=False, proxy_headers=False, lifespan="off")
finally:
    mobile.stop(force=True)
