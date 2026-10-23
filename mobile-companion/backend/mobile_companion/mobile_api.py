"""Narrow browser API: conversations, inference jobs and visible image bytes."""
import asyncio
import json
import re
import sqlite3
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool
from starlette.background import BackgroundTask

from services import image_library, image_vault, session_store
from services.image_thumbnails import response as image_response
from mobile_companion.mobile_access import COOKIE, DEVICE_LIFETIME
from mobile_companion.mobile_jobs import MobileSubmission
from services.bridge_store import TERMINAL
from mobile_companion.mobile_updates import MobileUpdates, VERSION
from mobile_companion.mobile_characters import router as character_router

MAX_BODY = 64 * 1024
ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"


def session_image_items():
    items = []
    for value in session_store.list_session_images():
        parts = [value.get(key, "") for key in ("session_id", "message_id", "image_id")]
        if all(ID.fullmatch(part) for part in parts):
            items.append({"id": "session/" + "/".join(parts), "name": value["name"],
                          "url": "/api/media/session/" + "/".join(parts),
                          "updated_at": value.get("updated_at", ""), "session_id": parts[0], "message_id": parts[1],
                          "source": "session", "session_title": value.get("session_title", "")})
    return items


def gallery_items():
    items = session_image_items()
    for value in image_library.public_index()["images"]:
        if ID.fullmatch(value["id"]) and not value.get("review_only") and not value.get("hidden"):
            items.append({"id": "library/" + value["id"], "name": value["name"],
                          "url": "/api/media/library/" + value["id"], "updated_at": value.get("created_at", ""),
                          "source": "library"})
    # The shared chat inventory already orders messages and their images newest
    # first. Preserve that order for equal timestamps instead of sorting UUIDs.
    return sorted(items, key=lambda item: (gallery_timestamp(item) is not None, gallery_timestamp(item) or 0), reverse=True)


def gallery_timestamp(item):
    try:
        value = datetime.fromisoformat(item["updated_at"])
        return value.replace(tzinfo=value.tzinfo or timezone.utc).timestamp()
    except (KeyError, TypeError, ValueError, OverflowError, OSError):
        return None


def mobile_session(session_id):
    if not ID.fullmatch(session_id):
        raise HTTPException(404, "Conversation not found")
    value = session_store.get_session(session_id)
    if value is None:
        raise HTTPException(404, "Conversation not found")
    session_store.public_session(value)
    images = defaultdict(list)
    for item in session_image_items():
        if item.get("session_id") == session_id:
            images[item["message_id"]].append(item)
    return {**{key: value.get(key) for key in ("id", "title", "revision", "model", "updated_at")},
            "messages": [{"id": item["id"], "role": item.get("role"), "content": item.get("content", ""),
                          "images": images[item["id"]], "response_usage": item.get("response_usage")} for item in value["messages"]]}


class PairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=60)


class NewSession(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default="New Chat", min_length=1, max_length=100)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value or any(ord(character) < 32 for character in value):
            raise ValueError("Enter a conversation name without control characters.")
        return value


class RenameSession(NewSession):
    title: str = Field(min_length=1, max_length=100)
    expected_revision: str = Field(min_length=1, max_length=100)


def create_mobile_api(jobs, access, origin, assets, *, updates=None):
    expected_host = urlsplit(origin).netloc
    assets = Path(assets).resolve()
    updates = updates or MobileUpdates(assets, assets.parent / '.mobile-update-logs')
    streams = defaultdict(int)

    @asynccontextmanager
    async def lifespan(_app):
        # A stopped listener can be restarted on a new event loop.
        jobs.submit_lock = asyncio.Lock()
        yield
        await jobs.close()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.include_router(character_router)

    @app.middleware("http")
    async def guard(request, call_next):
        def deny(status, message):
            return JSONResponse({"detail": message}, status_code=status, headers={"Cache-Control": "no-store"})
        from services.maintenance_gate import gate
        if gate.blocked():
            return deny(503, "Desktop maintenance in progress")
        if request.headers.get("host") != expected_host:
            return deny(403, "Unexpected host")
        supplied_origin = request.headers.get("origin")
        if supplied_origin and supplied_origin != origin:
            return deny(403, "Unexpected origin")
        if request.headers.get("sec-fetch-site") == "cross-site":
            return deny(403, "Cross-site access is not allowed")
        if any(key.lower() in {"token", "law_token", "code", "apitoken", "authorization"} for key in request.query_params):
            return deny(400, "Credentials must not appear in URLs")
        if request.method not in {"GET", "HEAD"}:
            if supplied_origin != origin or request.headers.get("x-law-mobile") != "1":
                return deny(403, "Same-origin application request required")
            # Bound the actual body, not just the caller's Content-Length.
            chunks, size = [], 0
            try:
                async with asyncio.timeout(10):
                    async for chunk in request.stream():
                        size += len(chunk)
                        if size > MAX_BODY:
                            return deny(413, "Request too large")
                        chunks.append(chunk)
            except TimeoutError:
                return deny(408, "Request body timed out")
            request._body = b"".join(chunks)
            if size and request.headers.get("content-type", "").split(";")[0] != "application/json":
                return deny(415, "JSON body required")
        if request.url.path == "/api/pair":
            if not access.throttle("pair", 12):
                return deny(429, "Too many pairing attempts. Wait one minute.")
        elif request.url.path.startswith("/api/"):
            device = access.authenticate(request.cookies.get(COOKIE))
            if not device:
                return deny(401, "Pair this device with your desktop")
            request.state.device = device
            if not access.throttle(device["id"], 360):
                return deny(429, "Too many requests. Wait one minute.")
        try:
            response = await call_next(request)
        except (OSError, sqlite3.Error, json.JSONDecodeError):
            return deny(503, "Desktop storage unavailable. Check the desktop and retry.")
        response.headers.update({"Cache-Control": "no-store" if request.url.path.startswith("/api/") else "no-cache",
            "Content-Security-Policy": CSP, "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(), microphone=(), geolocation=()"})
        return response

    @app.exception_handler(image_vault.LockedImageError)
    async def locked(_request, _error):
        return JSONResponse({"detail": "This image is unavailable"}, status_code=404)

    @app.exception_handler(session_store.SessionConflict)
    async def conflict(_request, _error):
        return JSONResponse({"detail": "The conversation changed. Reload before submitting."}, status_code=409)

    @app.post("/api/pair")
    def pair(body: PairRequest):
        try:
            device, token = access.pair(body.code, body.name)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        response = JSONResponse({"device": {"id": device["id"], "name": device["name"]}})
        response.set_cookie(COOKIE, token, max_age=DEVICE_LIFETIME, secure=True, httponly=True, samesite="strict", path="/")
        return response

    @app.post("/api/logout")
    def logout(request: Request):
        access.revoke(request.state.device["id"])
        response = JSONResponse({"disconnected": True})
        response.delete_cookie(COOKIE, secure=True, httponly=True, samesite="strict", path="/")
        return response

    @app.get("/api/state")
    def state(request: Request):
        device = request.state.device
        version = request.headers.get('x-law-client-version', '')
        updates.seen(device['id'], version if VERSION.fullmatch(version) else None)
        sessions = [{key: item.get(key) for key in ("id", "title", "model", "updated_at")} for item in session_store.list_sessions()]
        return {"device": {"id": device["id"], "name": device["name"]}, "sessions": sessions,
                "jobs": jobs.list(device["id"]), "client_update": {"version": updates.current()[1]}}

    @app.get("/api/models")
    async def models():
        async def probe(path):
            try:
                return await asyncio.wait_for(jobs.local(path), 20)
            except (httpx.HTTPError, asyncio.TimeoutError):
                return {"error": "Desktop model service unavailable. Check it on your desktop, then reconnect."}
        chat, images = await asyncio.gather(probe("/models"), probe("/image-generation/models"))
        return {"chat_models": [{"id": item["name"], "context_length": item.get("context_length")} for item in chat.get("models", [])],
                "image_models": [{**{key: item[key] for key in ("id", "name", "dimension_multiple", "supports_lora_training", "supports_long_prompt") if key in item},
                    **({"recommended_settings": {key: value for key, value in item["recommended_settings"].items()
                        if key in {"width", "height", "steps", "guidanceScale", "seed", "longPrompt", "allowLongWait"}
                        and isinstance(value, (int, float, bool))}} if item.get("recommended_settings") else {})}
                    for item in images.get("models", [])]
                    if images.get("runtime", {}).get("ready") else [],
                "image_loras": [{key: item[key] for key in ("id", "name", "base_model_id", "trigger_word", "training_goal") if key in item} for item in images.get("loras", [])],
                "image_runtime": {"ready": images.get("runtime", {}).get("ready", False),
                    "resolution_limits": {key: value for key, value in images.get("runtime", {}).get("resolution_limits", {}).items() if isinstance(value, (int, float))}},
                "lora_error": "Optional LoRAs could not be loaded. Check the desktop and reconnect." if images.get("lora_error") else None,
                "chat_error": chat.get("error"), "image_error": images.get("error") or
                    (None if images.get("runtime", {}).get("ready") else "Image runtime unavailable. Check the desktop.")}

    @app.post("/api/sessions")
    def create_session(body: NewSession):
        value = session_store.create_session(body.title)
        jobs.changed()
        return mobile_session(value["id"])

    @app.get("/api/sessions/{session_id}")
    def session(session_id: str):
        return mobile_session(session_id)

    @app.patch("/api/sessions/{session_id}/metadata")
    def rename_session(session_id: str, body: RenameSession):
        if not ID.fullmatch(session_id):
            raise HTTPException(404, "Conversation not found")
        value = session_store.update_session_metadata(session_id, title=body.title, expected_revision=body.expected_revision)
        if value is None:
            raise HTTPException(404, "Conversation not found")
        jobs.changed()
        return mobile_session(session_id)

    @app.put("/api/jobs/{job_id}")
    async def submit(job_id: uuid.UUID, body: MobileSubmission, request: Request):
        try:
            return await jobs.submit(request.state.device["id"], str(job_id), body)
        except session_store.SessionConflict:
            raise
        except ValueError as error:
            raise HTTPException(409, str(error)) from error

    def owned(request, job_id):
        try:
            return jobs.owned(request.state.device["id"], str(job_id))
        except KeyError:
            raise HTTPException(404, "Job not found") from None

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: uuid.UUID, request: Request):
        return jobs.public(owned(request, job_id), detail=True)

    @app.post("/api/jobs/{job_id}/cancel")
    async def cancel(job_id: uuid.UUID, request: Request):
        owned(request, job_id)
        try:
            return await jobs.cancel(request.state.device["id"], str(job_id))
        except httpx.HTTPError:
            raise HTTPException(503, "Cancellation saved; desktop confirmation is unavailable. Retry cancellation after reconnecting.") from None

    @app.delete("/api/jobs/{job_id}")
    def archive(job_id: uuid.UUID, request: Request):
        job = owned(request, job_id)
        if job["status"] not in TERMINAL:
            raise HTTPException(409, "Finish or cancel this job first")
        jobs.store.delete("incoming", str(job_id))
        return {"archived": True}

    @app.post("/api/jobs/{job_id}/images/{member_id}/cancel")
    async def cancel_batch_image(job_id: uuid.UUID, member_id: str, request: Request):
        try:
            return await jobs.cancel_image(request.state.device["id"], str(job_id), member_id)
        except KeyError:
            raise HTTPException(404, "Image not found") from None
        except httpx.HTTPError:
            raise HTTPException(503, "Cancellation saved; desktop confirmation is unavailable. Retry after reconnecting.") from None

    @app.get("/api/jobs/{job_id}/events")
    async def events(job_id: uuid.UUID, request: Request):
        owned(request, job_id)
        device_id = request.state.device["id"]
        if streams[device_id] >= 3:
            raise HTTPException(429, "Too many open job streams")
        streams[device_id] += 1
        async def stream():
            previous, heartbeat = None, 0
            try:
                while not await request.is_disconnected():
                    if not access.authenticate(request.cookies.get(COOKIE)):
                        return
                    value = jobs.public(jobs.owned(device_id, str(job_id)), detail=True)
                    encoded = json.dumps(value)
                    if encoded != previous:
                        yield f"data: {encoded}\n\n"
                        previous = encoded
                    elif heartbeat % 30 == 0:
                        yield ": heartbeat\n\n"
                    if value["status"] in TERMINAL:
                        return
                    heartbeat += 1
                    await asyncio.sleep(.3)
            finally:
                streams[device_id] -= 1
        return StreamingResponse(stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})

    @app.get("/api/gallery")
    def gallery(offset: int = Query(0, ge=0), limit: int = Query(24, ge=1, le=48), search: str = Query("", max_length=200),
                sort: Literal["newest", "oldest", "name_asc", "name_desc"] = "newest",
                source: Literal["all", "session", "library"] = "all",
                session_id: str = Query("", max_length=100, pattern=r"^[A-Za-z0-9_-]*$"),
                days: int = Query(0, ge=0, le=30)):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).timestamp() if days else None
        query = search.strip().casefold()
        items = [item for item in gallery_items()
                 if (source == "all" or item["source"] == source)
                 and (not session_id or item.get("session_id") == session_id)
                 and (query in item["name"].casefold() or query in item.get("session_title", "").casefold())
                 and (cutoff is None or (gallery_timestamp(item) is not None and gallery_timestamp(item) >= cutoff))]
        if sort == "oldest":
            dated = [item for item in items if gallery_timestamp(item) is not None]
            undated = [item for item in items if gallery_timestamp(item) is None]
            items = list(reversed(dated)) + undated
        elif sort in {"name_asc", "name_desc"}:
            items.sort(key=lambda item: item["name"].casefold(), reverse=sort == "name_desc")
        return {"images": items[offset:offset + limit], "total": len(items)}

    @app.get("/api/media/session/{session_id}/{message_id}/{image_id}")
    def session_media(session_id: str, message_id: str, image_id: str, thumbnail: bool = False, download: bool = False):
        identity = "session/" + "/".join((session_id, message_id, image_id))
        # Recheck visibility and locks at request time, including after a stale
        # gallery page was loaded. A caller cannot bypass hiding by guessing IDs.
        item = next((item for item in session_image_items() if item["id"] == identity), None)
        if item is None:
            raise HTTPException(404, "Image not found")
        value = session_store.get_session_image_by_id(session_id, message_id, image_id)
        if not value:
            raise HTTPException(404, "Image not found")
        data, media_type = value
        response = image_response(data, media_type, thumbnail and not download)
        if download:
            response.headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(item["name"], safe="")
        return response

    @app.get("/api/media/library/{image_id}")
    async def library_media(image_id: str, thumbnail: bool = False, download: bool = False):
        item = await run_in_threadpool(lambda: next((item for item in gallery_items() if item["id"] == "library/" + image_id), None))
        if item is None:
            raise HTTPException(404, "Image not found")
        # Fixed existing desktop route, compatible with both its byte-response
        # and streaming implementations. No dependency on unpublished edits.
        client = jobs.client()
        response = None
        async def close():
            if response is not None:
                await response.aclose()
            await client.aclose()
        try:
            response = await client.send(client.build_request("GET", f"/image-library/images/{image_id}/content",
                params={"thumbnail": str(thumbnail and not download).lower()}), stream=True)
            if response.status_code != 200:
                raise HTTPException(404, "Image unavailable")
        except BaseException:
            await close()
            raise
        headers = {}
        if response.headers.get("content-length"):
            headers["Content-Length"] = response.headers["content-length"]
        if download:
            headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(item["name"], safe="")
        return StreamingResponse(response.aiter_bytes(), media_type=response.headers.get("content-type", "application/octet-stream"),
                                 headers=headers, background=BackgroundTask(close))

    @app.get("/{path:path}")
    def shell(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        relative = path or "index.html"
        version = None
        if relative.startswith('releases/'):
            parts = relative.split('/', 2)
            if len(parts) != 3:
                raise HTTPException(404, 'Not found')
            _, version, relative = parts
        target = updates.resolve(relative, version)
        if target is None and version is None and relative.startswith('assets/'):
            baseline = updates.manifest(assets)
            target = updates.resolve(relative, baseline['version']) if baseline else None
        if target is None:
            raise HTTPException(404, "Build the mobile client on the desktop first")
        return FileResponse(target)

    return app
