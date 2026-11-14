"""Bounded Ollama connections owned by the backend's running event loop.

Request scopes keep independent timeouts, cookies and headers. Closing one scope
closes its responses, not the shared transport; backend shutdown closes the pool.
Standalone service callers retain ordinary scoped-client ownership.
"""
import asyncio
from contextlib import asynccontextmanager

import httpx

_pools = {}


class _BorrowedTransport(httpx.AsyncBaseTransport):
    def __init__(self, pool):
        self.pool = pool

    async def handle_async_request(self, request):
        return await self.pool.handle_async_request(request)

    async def aclose(self):
        # The lifespan owner closes this transport after jobs have stopped.
        pass


async def start():
    loop = asyncio.get_running_loop()
    if loop not in _pools:
        _pools[loop] = httpx.AsyncHTTPTransport(trust_env=False,
            limits=httpx.Limits(max_connections=16, max_keepalive_connections=8,
                                keepalive_expiry=30))


async def close():
    pool = _pools.pop(asyncio.get_running_loop(), None)
    if pool is not None:
        await pool.aclose()


@asynccontextmanager
async def client(*, timeout=30):
    pool = _pools.get(asyncio.get_running_loop())
    options = {"transport": _BorrowedTransport(pool)} if pool is not None else {}
    # Local model traffic must never inherit system/environment proxies.
    async with httpx.AsyncClient(timeout=timeout, trust_env=False, **options) as connection:
        yield connection
