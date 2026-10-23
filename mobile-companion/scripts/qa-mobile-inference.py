"""Opt-in real inference smoke test. Writes only to an explicit temporary root.

Uses installed models and existing routes/queue without opening a listener.
Run only while the desktop is idle. Model downloads are never requested here.
"""
import argparse
import asyncio
import json
import os
import secrets
import sys
import tempfile
import uuid
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--chat-model", required=True)
parser.add_argument("--image-model", required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
work = Path(tempfile.mkdtemp(prefix="law-mobile-inference-"))
os.environ.update(LAW_DATA_DIR=str(work / "data"), LAW_LOG_DIR=str(work / "logs"),
                  LAW_MODELS_DIR=str(root / "models"), LAW_SESSION_TOKEN=secrets.token_urlsafe(32))
sys.path.insert(0, str(root / "backend"))

import httpx
import main
from services import image_library, session_store
from mobile_companion.mobile_api import create_mobile_api
from mobile_companion.mobile_access import MobileAccess
from mobile_companion.mobile_jobs import MobileJobs, MobileSubmission


async def run():
    jobs = MobileJobs(work / "mobile", "http://127.0.0.1:8000", os.environ["LAW_SESSION_TOKEN"], transport=httpx.ASGITransport(app=main.app))
    session = session_store.create_session("Mobile inference verification")
    results = {"work": str(work), "inference": "real installed models", "network_listener": False}
    for kind, model, prompt in (("chat", args.chat_model, "Reply with exactly MOBILE_CHAT_OK."),
                               ("image", args.image_model, "A simple blue ceramic mug on a white table, soft daylight, no text")):
        current = session_store.get_session(session["id"])
        payload = MobileSubmission(kind=kind, session_id=session["id"], expected_revision=current["revision"],
                                  model=model, prompt=prompt, width=512, height=512, steps=2, seed=42)
        job_id = str(uuid.uuid4())
        await jobs.submit("local-smoke-test", job_id, payload)
        print(f"{kind}: submitted", flush=True)
        await asyncio.wait_for(asyncio.gather(*jobs.tasks.values()), 900)
        value = jobs.owned("local-smoke-test", job_id)
        results[kind] = {"status": value["status"], "error": value.get("error")}
        print(f"{kind}: {value['status']}", flush=True)
        if value["status"] != "completed":
            (work / "result.json").write_text(json.dumps(results, indent=2))
            raise RuntimeError(kind + " did not complete; see isolated logs at " + str(work))
        if kind == "chat":
            assert "MOBILE_CHAT_OK" in value["result"]["text"], "The chat model did not return the expected marker"
    # Exercise the mobile gallery and download routes using the real output.
    access = MobileAccess(jobs.store)
    app = create_mobile_api(jobs, access, "https://desktop.example.ts.net", root / "dist/mobile")
    headers = {"Origin": "https://desktop.example.ts.net", "X-LAW-Mobile": "1"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://desktop.example.ts.net") as client:
        invitation = access.invitation()
        response = await client.post("/api/pair", headers=headers, json={"code": invitation["code"], "name": "Isolated verification"})
        response.raise_for_status()
        gallery = (await client.get("/api/gallery")).json()
        assert gallery["total"] == 1
        downloaded = await client.get(gallery["images"][0]["url"] + "?download=true")
        downloaded.raise_for_status()
        image = session_store.list_session_images()[0]
        original, _ = session_store.get_session_image_by_id(session["id"], image["message_id"], image["image_id"])
        assert downloaded.content == original
        assert "attachment" in downloaded.headers["content-disposition"]
        from PIL import Image
        import io
        assert Image.open(io.BytesIO(original)).size == (512, 512)
        results.update(gallery=True, original_download_match=True, dimensions=[512, 512])
    (work / "result.json").write_text(json.dumps(results, indent=2))
    print("Real inference verification passed: " + str(work), flush=True)


asyncio.run(run())
