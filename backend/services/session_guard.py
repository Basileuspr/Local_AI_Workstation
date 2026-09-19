"""Treat the browser as untrusted, even on loopback.

Binding to 127.0.0.1 keeps other machines out; it does nothing about the
browser already running on this one. Any page the user visits can issue
requests here, and a sandboxed iframe carries the `null` origin that a
file:// renderer also carries -- so origin alone cannot separate this app
from an arbitrary website.

Three checks, cheapest first:

1. Host must name loopback, which removes DNS rebinding.
2. Origin, when the browser sends one, must be an allowed application origin.
3. A per-launch session credential must accompany every privileged request.

Only (3) is a real secret. (1) and (2) are defence in depth: they stop whole
classes of request before any handler runs.
"""
from __future__ import annotations

import os
import secrets

from starlette.responses import JSONResponse

from config import settings

# /health says only whether the process is alive and is what the desktop polls
# before the renderer exists, so it carries no credential and reveals nothing.
PUBLIC_PATHS = frozenset({"/health"})
TOKEN_HEADER = b"x-law-session"
TOKEN_QUERY = "law_token"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})


def _generated_token() -> str:
    """A token nobody was told, so an unconfigured backend serves only /health.

    Starting wide open would make the guard advisory. A developer running the
    backend by hand sets LAW_SESSION_TOKEN deliberately; the desktop app always
    passes one. The value is never logged or written to disk.
    """
    return secrets.token_urlsafe(32)


_FALLBACK = _generated_token()


def expected_token() -> str:
    return os.environ.get("LAW_SESSION_TOKEN") or _FALLBACK


def configured() -> bool:
    return bool(os.environ.get("LAW_SESSION_TOKEN"))


def host_allowed(host: str) -> bool:
    if not host:
        return False
    name = host.rsplit(":", 1)[0] if host.count(":") == 1 or host.startswith("[") else host
    return name.strip("[]").lower() in {item.strip("[]") for item in LOOPBACK_HOSTS}


def token_from(scope, headers) -> str:
    supplied = headers.get(TOKEN_HEADER, b"").decode("latin-1")
    if supplied:
        return supplied
    # Image tags, download links and event streams cannot set a header, so the
    # same credential is accepted as a query value for those.
    from urllib.parse import parse_qs
    values = parse_qs(scope.get("query_string", b"").decode("latin-1")).get(TOKEN_QUERY)
    return values[0] if values else ""


class SessionGuard:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {key.lower(): value for key, value in scope.get("headers", [])}

        if not host_allowed(headers.get(b"host", b"").decode("latin-1")):
            return await self._deny(scope, receive, send, "This API only answers on loopback.")

        origin = headers.get(b"origin", b"").decode("latin-1")
        if origin and origin not in settings.allowed_origins:
            return await self._deny(scope, receive, send,
                                    "This local API does not serve web pages.")

        if scope.get("path") in PUBLIC_PATHS or scope.get("method") == "OPTIONS":
            return await self.app(scope, receive, send)

        if not secrets.compare_digest(token_from(scope, headers), expected_token()):
            return await self._deny(scope, receive, send,
                                    "This request needs the current app session credential. "
                                    "Open the Local AI Workstation window, or set LAW_SESSION_TOKEN "
                                    "and pass ?apiToken= when running the dev server.")
        async def private_send(message):
            if message["type"] == "http.response.start":
                stripped = {b"cache-control", b"referrer-policy", b"x-content-type-options"}
                message = {**message, "headers": [(k, v) for k, v in message.get("headers", []) if k.lower() not in stripped] + [
                    (b"cache-control", b"no-store"), (b"referrer-policy", b"no-referrer"), (b"x-content-type-options", b"nosniff")]}
            await send(message)
        return await self.app(scope, receive, private_send)

    @staticmethod
    async def _deny(scope, receive, send, detail):
        response = JSONResponse({"detail": detail}, status_code=403,
                                headers={"Cache-Control": "no-store"})
        return await response(scope, receive, send)
