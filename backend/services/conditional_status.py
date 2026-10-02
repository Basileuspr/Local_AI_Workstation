"""Conditional status responses retain the full contract on first/reconnect reads."""
import hashlib
import json
from fastapi.encoders import jsonable_encoder
from fastapi.responses import Response


def conditional_status(request, data):
    if request is None:  # Direct service/route tests and internal callers.
        return data
    content = json.dumps(jsonable_encoder(data), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    tag = '"' + hashlib.sha256(content).hexdigest() + '"'
    headers = {"ETag": tag, "Cache-Control": "no-store"}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return Response(content=content, media_type="application/json", headers=headers)
