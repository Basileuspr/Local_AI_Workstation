import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI

from services.web_access import (PageText, WebAccess, WebError, address_rejection,
                                 normalize_url, retry_seconds)

WIKI = "https://en.wikipedia.org/wiki/Solar_energy"


class Clock:
    def __init__(self):
        self.value = 10000.0
        self.waits = []

    def now(self):
        return self.value

    async def sleep(self, seconds):
        self.waits.append(seconds)
        self.value += seconds


async def public_dns(host):
    return ["93.184.216.34"]


def wiki_response(request):
    return httpx.Response(200, json={"query": {"pages": [{"title": "Solar energy", "extract": "Solar energy is radiant light and heat from the Sun.", "fullurl": WIKI, "lastrevid": 123}]}})


def service(tmp_path, handler=wiki_response):
    clock = Clock()
    requests = []
    def record(request):
        requests.append((clock.now(), request))
        return handler(request)
    manager = WebAccess(tmp_path, httpx.MockTransport(record), public_dns, clock.now, clock.sleep)
    return manager, clock, requests


def run(coroutine):
    return asyncio.run(coroutine)


@pytest.mark.parametrize("url", [
    # Schemes that are not the public web at all.
    "http://example.com/", "file:///C:/secret", "ftp://example.com/x", "javascript:alert(1)",
    "https://user:pass@example.com/",
    # Names that only exist inside a machine or a LAN.
    "https://localhost/", "https://router/", "https://nas.local/", "https://svc.internal/",
    "https://build.corp/", "https://thing.home.arpa/", "https://evil.test/",
    # Literal addresses that must never be contacted.
    "https://127.0.0.1/", "https://[::1]/", "https://10.0.0.5/", "https://192.168.1.1/",
    "https://172.16.9.9/", "https://0.0.0.0/", "https://100.64.1.1/", "https://224.0.0.1/",
    # Cloud metadata services, including providers that do not use 169.254.
    "https://169.254.169.254/latest/meta-data/", "https://192.0.0.192/",
    # Wrappers that look public but deliver to a private destination.
    "https://[::ffff:127.0.0.1]/", "https://[::ffff:10.0.0.1]/", "https://[64:ff9b::7f00:1]/",
    # A browser reads the backslash as a separator and would reach localhost.
    "https://example.com\\@localhost/",
])
def test_reject_private_and_non_web_urls(url):
    with pytest.raises(WebError):
        normalize_url(url)


@pytest.mark.parametrize("url,expected", [
    ("https://example.com/a/b?q=hello+world&page=2", "https://example.com/a/b?q=hello+world&page=2"),
    ("https://example.com/search?q=%E2%98%83", "https://example.com/search?q=%E2%98%83"),
    ("https://sub.domain.co.uk:8443/x", "https://sub.domain.co.uk:8443/x"),
    ("https://EXAMPLE.com/./a/../b", "https://example.com/b"),
    ("https://b\u00fccher.example.com/seite", "https://xn--bcher-kva.example.com/seite"),
    ("https://en.wikipedia.org/wiki/Special:Random", "https://en.wikipedia.org/wiki/Special:Random"),
    ("https://93.184.216.34/", "https://93.184.216.34/"),
    ("  https://example.com/x  ", "https://example.com/x"),
])
def test_ordinary_public_pages_are_accepted(url, expected):
    assert normalize_url(url) == expected


def test_fragments_do_not_create_a_second_import():
    assert normalize_url("https://example.com/a?q=1#section") == "https://example.com/a?q=1"


@pytest.mark.parametrize("address,public", [
    ("93.184.216.34", True), ("8.8.8.8", True), ("2606:4700:4700::1111", True),
    ("::ffff:8.8.8.8", True), ("127.0.0.1", False), ("10.0.0.1", False),
    ("169.254.169.254", False), ("224.0.0.1", False), ("240.0.0.1", False),
    ("fe80::1", False), ("fc00::1", False), ("64:ff9b::7f00:1", False),
    ("::ffff:192.168.0.1", False), ("100.64.0.1", False), ("not-an-address", False),
    ("fe80::1%eth0", False),
])
def test_address_rejection_covers_every_private_family(address, public):
    assert (address_rejection(address) is None) is public


def test_spacing_and_persistent_cache(tmp_path):
    manager, clock, requests = service(tmp_path)
    async def exercise():
        first = await manager.fetch(WIKI, {})
        second = await manager.fetch(WIKI, {})
        await manager.fetch("https://en.wikipedia.org/wiki/Wind_power", {})
        assert first["revision"] == 123
        assert second["cached"] is True
    run(exercise())
    assert len(requests) == 2
    assert requests[1][0] - requests[0][0] >= 10
    request = requests[0][1]
    assert request.url.host == "93.184.216.34"
    assert request.headers["host"] == "en.wikipedia.org"
    assert request.extensions["sni_hostname"] == "en.wikipedia.org"
    assert "LocalAIWorkstation" in request.headers["user-agent"]
    second_manager, _, _ = service(tmp_path, lambda _: pytest.fail("Cache should avoid network"))
    assert run(second_manager.fetch(WIKI, {}))["cached"]


@pytest.mark.parametrize("status", [429, 503, 401, 403])
def test_denial_persists_cooldown_without_retry(tmp_path, status):
    manager, clock, requests = service(tmp_path, lambda _: httpx.Response(status, headers={"Retry-After": "120"}))
    with pytest.raises(WebError):
        run(manager.fetch(WIKI, {}))
    fresh, _, _ = service(tmp_path, lambda _: pytest.fail("Cooldown must survive restart"))
    with pytest.raises(WebError, match="cooldown"):
        run(fresh.fetch(WIKI, {}))
    assert len(requests) == 1


def test_http_date_retry_after():
    assert retry_seconds("Thu, 01 Jan 1970 00:02:00 GMT", 0) == 120


def test_hourly_budget_covers_all_network_requests(tmp_path):
    manager, clock, requests = service(tmp_path)
    async def exercise():
        for index in range(30):
            await manager.fetch(f"https://en.wikipedia.org/wiki/Page_{index}", {})
        with pytest.raises(WebError, match="Hourly"):
            await manager.fetch("https://en.wikipedia.org/wiki/Extra", {})
    run(exercise())
    assert len(requests) == 30


def test_private_dns_answer_blocks_the_request(tmp_path):
    manager, _, requests = service(tmp_path)
    async def private(host):
        return ["127.0.0.1"]
    manager.resolver = private
    with pytest.raises(WebError, match="loopback"):
        run(manager.fetch(WIKI, {}))
    assert requests == []


def test_one_private_answer_among_public_ones_still_blocks(tmp_path):
    manager, _, requests = service(tmp_path)
    async def mixed(host):
        return ["93.184.216.34", "10.0.0.7"]
    manager.resolver = mixed
    with pytest.raises(WebError, match="private"):
        run(manager.fetch(WIKI, {}))
    assert requests == []


def test_ordinary_redirects_are_followed_and_recorded(tmp_path):
    def response(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        if request.headers["host"] == "start.example.com":
            return httpx.Response(301, headers={"Location": "https://end.example.com/article?id=7"})
        return httpx.Response(200, headers={"Content-Type": "text/html; charset=utf-8"},
                              text="<html><head><title>Arrived</title></head><body><p>Body text</p></body></html>")
    manager, _, _ = service(tmp_path, response)
    result = run(manager.fetch("https://start.example.com/old", {}))
    assert result["url"] == "https://end.example.com/article?id=7"
    assert result["requested_url"] == "https://start.example.com/old"
    assert result["redirect_chain"] == ["https://start.example.com/old"]
    assert result["title"] == "Arrived"
    assert "Body text" in result["text"]


@pytest.mark.parametrize("location", [
    "http://example.com/x", "https://127.0.0.1/x", "https://localhost/x",
    "https://169.254.169.254/", "file:///C:/secret",
])
def test_redirect_into_a_blocked_destination_is_refused(tmp_path, location):
    def response(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        if request.headers["host"] == "start.example.com":
            return httpx.Response(302, headers={"Location": location})
        pytest.fail("A blocked redirect target must never be contacted")
    manager, _, _ = service(tmp_path, response)
    with pytest.raises(WebError):
        run(manager.fetch("https://start.example.com/old", {}))


def test_redirect_loop_stops_cleanly(tmp_path):
    def loop(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(302, headers={"Location": "https://a.example.com/one"})
    manager, _, _ = service(tmp_path, loop)
    with pytest.raises(WebError, match="loop"):
        run(manager.fetch("https://a.example.com/one", {}))


def test_endless_redirect_chain_is_capped(tmp_path):
    counter = {"n": 0}

    def forever(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        counter["n"] += 1
        return httpx.Response(302, headers={"Location": "https://b.example.com/" + str(counter["n"])})

    manager, _, _ = service(tmp_path, forever)
    with pytest.raises(WebError, match="redirected more than"):
        run(manager.fetch("https://b.example.com/start", {}))


@pytest.mark.parametrize("content_type", ["application/pdf", "image/png", "application/json", ""])
def test_non_page_content_is_reported_not_imported(tmp_path, content_type):
    def response(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(200, headers={"Content-Type": content_type}, content=b"binary")
    manager, _, _ = service(tmp_path, response)
    with pytest.raises(WebError, match="cannot read"):
        run(manager.fetch("https://files.example.com/thing", {}))


def test_declared_encoding_is_honored(tmp_path):
    body = "<html><head><title>Caf\u00e9</title></head><body><p>Cr\u00e8me br\u00fbl\u00e9e</p></body></html>".encode("latin-1")

    def response(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(200, headers={"Content-Type": "text/html; charset=iso-8859-1"}, content=body)

    manager, _, _ = service(tmp_path, response)
    result = run(manager.fetch("https://news.example.com/story", {}))
    assert result["title"] == "Caf\u00e9"
    assert "Cr\u00e8me br\u00fbl\u00e9e" in result["text"]


def test_dns_failure_is_reported_without_crashing(tmp_path):
    manager, _, _ = service(tmp_path)

    async def missing(host):
        raise WebError("'" + host + "' could not be found. Check the address or your connection.")

    manager.resolver = missing
    with pytest.raises(WebError, match="could not be found"):
        run(manager.fetch("https://nowhere.example.com/x", {}))


def test_title_falls_back_to_open_graph(tmp_path):
    def response(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(200, headers={"Content-Type": "text/html"},
                              text='<html><head><meta property="og:title" content="Social name"></head>'
                                   "<body><h1>Heading</h1><p>Words</p></body></html>")

    manager, _, _ = service(tmp_path, response)
    assert run(manager.fetch("https://blog.example.com/post", {}))["title"] == "Social name"


def test_query_parameters_reach_the_server_and_key_the_cache(tmp_path):
    seen = []

    def response(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        seen.append(str(request.url.query, "ascii"))
        return httpx.Response(200, headers={"Content-Type": "text/html"},
                              text="<html><head><title>Results</title></head><body><p>hit</p></body></html>")

    manager, _, _ = service(tmp_path, response)

    async def exercise():
        await manager.fetch("https://search.example.com/find?q=solar&page=1", {})
        await manager.fetch("https://search.example.com/find?q=solar&page=2", {})
        again = await manager.fetch("https://search.example.com/find?q=solar&page=1", {})
        assert again["cached"] is True

    run(exercise())
    assert seen == ["q=solar&page=1", "q=solar&page=2"]


def test_robots_disallow_stops_before_page(tmp_path):
    manager, _, requests = service(tmp_path, lambda _: httpx.Response(200, text="User-agent: *\nDisallow: /\n"))
    with pytest.raises(WebError, match="robots"):
        run(manager.fetch("https://books.toscrape.com/", {}))
    assert len(requests) == 1
    assert requests[0][1].url.path == "/robots.txt"


def test_html_extraction_and_crawl_delay(tmp_path):
    def response(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /\nCrawl-delay: 25\n")
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text="<html><head><title>Books</title></head><body><nav>menu</nav><h1>Book title</h1><script>steal()</script><p>Price £5</p></body></html>")
    manager, _, requests = service(tmp_path, response)
    result = run(manager.fetch("https://books.toscrape.com/", {}))
    assert "Book title" in result["text"]
    assert "steal" not in result["text"] and "menu" not in result["text"]
    assert requests[1][0] - requests[0][0] >= 25


def test_cancellation_closes_upstream_and_releases_job(tmp_path):
    async def exercise():
        started, closed = asyncio.Event(), asyncio.Event()
        async def slow(request):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                closed.set()
        manager = WebAccess(tmp_path, httpx.MockTransport(slow), public_dns)
        job = manager.start(WIKI)
        await started.wait()
        with pytest.raises(WebError, match="Another"):
            manager.start(WIKI)
        result = await manager.cancel(job["id"])
        assert result["status"] == "cancelled"
        assert closed.is_set()
        assert not list((tmp_path / "cache").glob("*.json"))
    run(exercise())


def test_size_limit_and_api_error(tmp_path):
    manager, _, _ = service(tmp_path, lambda _: httpx.Response(200, content=b"x" * (5 * 1024 * 1024 + 1)))
    with pytest.raises(WebError, match="5 MB"):
        run(manager.fetch(WIKI, {}))
    manager.transport = httpx.MockTransport(lambda _: httpx.Response(200, json={"error": {"code": "maxlag"}}))
    with pytest.raises(WebError, match="pause"):
        run(manager.fetch(WIKI, {}))


def test_job_routes_remain_responsive_and_stop(tmp_path, monkeypatch):
    from routes import web
    async def exercise():
        entered = asyncio.Event()
        async def slow(request):
            entered.set()
            await asyncio.Event().wait()
        manager = WebAccess(tmp_path, httpx.MockTransport(slow), public_dns)
        monkeypatch.setattr(web, "manager", manager)
        app = FastAPI()
        app.include_router(web.router)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
            job = (await client.post("/web/jobs", json={"url": WIKI})).json()
            await entered.wait()
            assert (await client.get("/web/active")).json()["job"]["id"] == job["id"]
            assert (await client.get("/web/jobs/" + job["id"])).json()["status"] == "fetching"
            assert (await client.post("/web/jobs/" + job["id"] + "/stop")).json()["status"] == "cancelled"
            assert (await client.get("/web/active")).json()["job"] is None
            assert (await client.get("/web/jobs/missing")).status_code == 404
    run(exercise())
