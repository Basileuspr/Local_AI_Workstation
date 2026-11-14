import asyncio

from services import ollama_http


def test_pool_reuses_connections_but_not_request_cookies_or_timeouts(monkeypatch):
    monkeypatch.setenv('HTTP_PROXY', 'http://127.0.0.1:1')
    monkeypatch.setenv('ALL_PROXY', 'http://127.0.0.1:1')
    monkeypatch.setenv('NO_PROXY', '')

    async def scenario():
        connections, requests, finished = [], [], []
        async def serve(reader, writer):
            connections.append(writer)
            try:
                while True:
                    request = await reader.readuntil(b'\r\n\r\n')
                    requests.append(request)
                    writer.write(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nSet-Cookie: isolated=yes\r\n\r\n{}')
                    await writer.drain()
            except asyncio.IncompleteReadError:
                pass
            finally:
                writer.close()
                await writer.wait_closed()
                finished.append(True)

        server = await asyncio.start_server(serve, '127.0.0.1', 0)
        url = f'http://127.0.0.1:{server.sockets[0].getsockname()[1]}'
        await ollama_http.start()
        try:
            async with ollama_http.client(timeout=2) as first:
                assert first.timeout.read == 2
                assert (await first.get(url + '/api/tags')).status_code == 200
            async with ollama_http.client(timeout=20) as second:
                assert second.timeout.read == 20
                assert (await second.get(url + '/api/ps')).status_code == 200
            assert len(connections) == 1
            assert len(requests) == 2
            assert b'cookie:' not in requests[1].lower()
        finally:
            await ollama_http.close()
            server.close()
            await server.wait_closed()
        for _ in range(20):
            if finished:
                break
            await asyncio.sleep(.01)
        assert finished
        assert asyncio.get_running_loop() not in ollama_http._pools

    asyncio.run(scenario())
