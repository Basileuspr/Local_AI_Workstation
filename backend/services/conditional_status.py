"""Conditional status responses retain the full contract on first/reconnect reads."""
import hashlib
import json
from fastapi.encoders import jsonable_encoder
from fastapi.responses import Response


def conditional_status(request, data, *, etag_data=None):
    if request is None:  # Direct service/route tests and internal callers.
        return data
    content = json.dumps(jsonable_encoder(data), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    tag_content = content if etag_data is None else json.dumps(jsonable_encoder(etag_data), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    tag = ("W/" if etag_data is not None else "") + '"' + hashlib.sha256(tag_content).hexdigest() + '"'
    headers = {"ETag": tag, "Cache-Control": "no-store"}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return Response(content=content, media_type="application/json", headers=headers)
