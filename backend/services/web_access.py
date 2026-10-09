"""Deliberate public-page imports. No autonomous browsing or authenticated access."""
import asyncio
import hashlib
import ipaddress
import io
import json
import re
import socket
import time
import uuid
import warnings
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.robotparser import RobotFileParser

import httpx
from PIL import Image, UnidentifiedImageError

from config import settings
from services import image_store

USER_AGENT = "LocalAIWorkstation/1.0 (+https://github.com/Basileuspr/Local_AI_Workstation)"
ACCEPT = "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.1"
ROOT = settings.data_dir / "web"
INTERVAL = 10.0
HOURLY_LIMIT = 30
CACHE_SECONDS = 86400
MAX_BYTES = 5 * 1024 * 1024
MAX_TEXT = 80000
MAX_REDIRECTS = 5
MAX_URL = 2000
MAX_IMAGES = 24
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_TOTAL = 50 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
READABLE_TYPES = {"text/html", "application/xhtml+xml", "text/plain"}
REDIRECT_STATUSES = {301, 302, 303, 307, 308}

# Hostnames that never belong to the public internet. A name with no dot is
# always a LAN, container, or search-domain name, which is why a missing dot is
# disqualifying on its own.
INTERNAL_NAMES = {"localhost"}
INTERNAL_SUFFIXES = (".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa",
                     ".corp", ".private", ".test", ".example", ".invalid", ".alt")
# RFC 6052 and RFC 8215. These embed an IPv4 address that a NAT64 gateway
# translates on the way out, so a globally-routable-looking prefix can still
# deliver a packet to 127.0.0.1 or a LAN host.
NAT64_NETWORKS = (ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("64:ff9b:1::/48"))
WIKIPEDIA_HOST = re.compile(r"^[a-z]{2,3}(-[a-z]+)?\.wikipedia\.org$")
META_CHARSET = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?\s*([\w.:+-]+)""", re.IGNORECASE)
HEADER_CHARSET = re.compile(r"charset\s*=\s*\"?([\w.:+-]+)", re.IGNORECASE)


class WebError(ValueError):
    pass


def address_rejection(value):
    """Why an address must not be contacted, or None when it is safely public.

    Python's ``is_global`` is necessary but not sufficient: it reports multicast
    and NAT64 addresses as global, and a NAT64 address is exactly how a public
    prefix reaches a loopback or LAN host.
    """
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return "is not a usable IP address"
    if ip.version == 6:
        if any(ip in network for network in NAT64_NETWORKS):
            return "is a NAT64 address that can be translated into a private network"
        if ip.ipv4_mapped is not None:
            # Judge the address actually reached, not the wrapper around it.
            ip = ip.ipv4_mapped
    for attribute, reason in (
        ("is_loopback", "is a loopback address"),
        ("is_link_local", "is a link-local address, where cloud metadata services live"),
        ("is_private", "is a private or internal network address"),
        ("is_multicast", "is a multicast address"),
        ("is_reserved", "is a reserved address"),
        ("is_unspecified", "is an unspecified address"),
    ):
        if getattr(ip, attribute, False):
            return reason
    if not ip.is_global:
        return "is not a public internet address"
    return None


def host_literal(host):
    """The literal IP inside a hostname, or None when the host is a name."""
    candidate = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return None
    return candidate


def normalize_url(value, *, allow_http=False):
    """Validate and canonicalize one public https:// address.

    This is the only gate a URL passes through, and every redirect target is
    sent back through it, so it rejects on hostname shape alone -- before any
    DNS answer is trusted.
    """
    raw = (value or "").strip()
    if not raw:
        raise WebError("Enter a public https:// web address.")
    if len(raw) > MAX_URL:
        raise WebError(f"That web address is longer than {MAX_URL} characters.")
    if "\\" in raw or any(ord(character) < 32 or ord(character) == 127 for character in raw):
        # A browser reads a backslash as a path separator. A validator that does
        # not would approve one hostname and then connect to a different one.
        raise WebError("That web address contains characters that are not allowed.")
    try:
        url = httpx.URL(raw)
    except (httpx.InvalidURL, UnicodeError, ValueError) as exc:
        raise WebError("That is not a valid web address.") from exc
    if url.scheme not in (("https", "http") if allow_http else ("https",)):
        raise WebError(f"Only https:// pages can be imported. This address uses '{url.scheme or 'no scheme'}'.")
    if url.userinfo:
        raise WebError("Web addresses that embed a username or password are not imported.")
    try:
        host = url.raw_host.decode("ascii").lower().rstrip(".")
    except (AttributeError, UnicodeDecodeError) as exc:
        raise WebError("That web address has an unusable hostname.") from exc
    if not host:
        raise WebError("That web address has no hostname.")
    literal = host_literal(host)
    if literal is not None:
        rejection = address_rejection(literal)
        if rejection:
            raise WebError(f"That address {rejection}. Only public internet pages can be imported.")
    elif host in INTERNAL_NAMES or host.endswith(INTERNAL_SUFFIXES) or "." not in host:
        raise WebError(f"'{host}' is a local or internal name, not a public website.")
    # A fragment is never sent to a server, so keeping it would only split the
    # cache into duplicate entries for one page.
    return str(url.copy_with(fragment=None))


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def retry_seconds(value, now):
    try:
        return max(0, float(value))
    except (ValueError, TypeError):
        try:
            return max(0, parsedate_to_datetime(value).timestamp() - now)
        except (ValueError, TypeError, OverflowError):
            return 60.0


def decode_page(body, content_type):
    """Honor the declared encoding, then the document's own, then UTF-8."""
    candidates = []
    header = HEADER_CHARSET.search(content_type or "")
    if header:
        candidates.append(header.group(1))
    sniffed = META_CHARSET.search(body[:4096])
    if sniffed:
        candidates.append(sniffed.group(1).decode("ascii", "ignore"))
    candidates.append("utf-8")
    for encoding in candidates:
        try:
            return body.decode(encoding)
        except (LookupError, UnicodeDecodeError, ValueError):
            continue
    return body.decode("utf-8", errors="replace")


class PageText(HTMLParser):
    """Extract inert text and image candidates; never execute website HTML."""

    SKIP = {"script", "style", "nav", "footer", "aside", "noscript", "button",
            "svg", "form", "iframe", "template", "select", "dialog"}
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
            "meta", "param", "source", "track", "wbr"}
    BREAK = {"p", "div", "li", "h1", "h2", "h3", "h4", "tr", "section", "article", "br"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.parts = []
        self.title = []
        self.social_title = ""
        self.heading = []
        self.images = []
        self.base = ""
        self.image_overflow = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "base" and not self.base:
            self.base = values.get("href") or ""
        if tag == "img" and not (set(self.stack) & (self.SKIP | {"head"})):
            if len(self.images) >= 200:
                self.image_overflow = True
            else:
                # Lazy loaders often put a tracking pixel/data URL in src.
                source = next((values.get(key) for key in ("data-src", "data-lazy-src", "data-original")
                               if values.get(key)), "")
                if not source:
                    srcset = values.get("data-srcset") or values.get("srcset") or ""
                    choices = []
                    for item in srcset.split(","):
                        fields = item.strip().split()
                        if fields:
                            weight = re.fullmatch(r"([0-9.]+)[wx]", fields[-1]) if len(fields) > 1 else None
                            try:
                                choices.append((float(weight[1]) if weight else 1, fields[0]))
                            except ValueError:
                                continue
                    source = max(choices, default=(0, ""))[1] or values.get("src") or ""
                if source:
                    self.images.append({"url": source.strip(), "alt": (values.get("alt") or "")[:300]})
        if tag not in self.VOID:
            self.stack.append(tag)
        elif tag == "meta":
            values = dict(attrs)
            key = (values.get("property") or values.get("name") or "").lower()
            if key in ("og:title", "twitter:title") and not self.social_title:
                self.social_title = " ".join((values.get("content") or "").split())[:300]
        if tag in self.BREAK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]
        if tag in self.BREAK:
            self.parts.append("\n")

    def handle_data(self, data):
        if "title" in self.stack:
            self.title.append(data)
        if set(self.stack) & self.SKIP:
            return
        if "h1" in self.stack and len(self.heading) < 40:
            self.heading.append(data)
        if "body" in self.stack:
            self.parts.append(data)

    def text(self):
        return "\n".join(line for raw in "".join(self.parts).splitlines() if (line := " ".join(raw.split())))

    def page_title(self):
        for candidate in (" ".join("".join(self.title).split()), self.social_title,
                          " ".join("".join(self.heading).split())):
            if candidate:
                return candidate[:300]
        return ""


class WebAccess:
    def __init__(self, root=None, transport=None, resolver=None, now=time.time, sleep=asyncio.sleep):
        self.root = root or ROOT
        self.transport = transport
        self.resolver = resolver
        self.now = now
        self.sleep = sleep
        self.jobs = {}
        self.tasks = {}
        self.robots = {}
        self.lock = asyncio.Lock()

    def start(self, value, include_images=True):
        url = normalize_url(value)
        if any(not task.done() for task in self.tasks.values()):
            raise WebError("Another web import is running. Wait or stop it first.")
        # Bound terminal-job memory; snapshots and attached chat text live on disk.
        if len(self.jobs) >= 50:
            oldest = next(iter(self.jobs))
            self.jobs.pop(oldest)
            self.tasks.pop(oldest, None)
        job_id = uuid.uuid4().hex
        self.jobs[job_id] = {"id": job_id, "url": url, "include_images": include_images,
                             "status": "queued", "message": "Queued"}
        self.tasks[job_id] = asyncio.create_task(self._run(job_id))
        return self.jobs[job_id].copy()

    async def cancel(self, job_id):
        task = self.tasks.get(job_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            self.jobs[job_id].update(status="cancelled", message="Stopped")
        return self.jobs.get(job_id)

    def _limits(self):
        path = self.root / "limits.json"
        if not path.exists():
            return {"requests": [], "next_at": 0, "blocked_until": 0}
        try:
            result = json.loads(path.read_text(encoding="utf-8"))
            assert isinstance(result["requests"], list)
            float(result["next_at"])
            float(result["blocked_until"])
            return result
        except (OSError, ValueError, KeyError, AssertionError, TypeError) as exc:
            raise WebError("Web rate-limit state is unreadable; network access paused.") from exc

    def _block(self, seconds):
        limits = self._limits()
        limits["blocked_until"] = max(limits["blocked_until"], self.now() + seconds)
        atomic_json(self.root / "limits.json", limits)

    async def _public_addresses(self, host, port):
        """Resolve once, and require every answer to be public.

        One private record is enough to make a name a rebinding vector, because
        the record this app happens to use is not the record it is offered next.
        """
        if self.resolver:
            addresses = await self.resolver(host)
        else:
            try:
                info = await asyncio.to_thread(socket.getaddrinfo, host, port, type=socket.SOCK_STREAM)
            except socket.gaierror as exc:
                raise WebError(f"'{host}' could not be found. Check the address or your connection.") from exc
            addresses = [item[4][0] for item in info]
        if not addresses:
            raise WebError(f"'{host}' did not resolve to any address.")
        for address in addresses:
            rejection = address_rejection(address)
            if rejection:
                raise WebError(f"'{host}' resolves to an address that {rejection}. That destination is blocked.")
        return addresses

    async def _request(self, url, job, delay=INTERVAL, space=True, *, max_bytes=MAX_BYTES, image=False, byte_budget=None,
                       conditional=None, allow_http=False, accepted_statuses=()):
        async with self.lock:
            limits = self._limits()
            now = self.now()
            limits["requests"] = [t for t in limits["requests"] if t > now - 3600]
            if limits["blocked_until"] > now:
                raise WebError(f"Site cooldown active. Try again in {int(limits['blocked_until'] - now) + 1} seconds.")
            if len(limits["requests"]) >= HOURLY_LIMIT:
                raise WebError(f"Hourly web limit reached ({HOURLY_LIMIT} requests). Try again later.")
            progress = f"Image {job['image_index']} of {job['image_total']} · " if job.get("image_total") else ""
            # A policy learned after robots.txt also applies to the first page.
            # next_at records at least INTERVAL seconds after completion.
            if space and limits.get('last_completed') is not None:
                limits['next_at']=max(limits['next_at'],limits['last_completed']+max(INTERVAL,delay))
            wait = max(0, limits["next_at"] - now) if space else 0
            if wait:
                job.update(status="waiting", message=f"{progress}Respecting request spacing ({wait:.0f}s)")
                await self.sleep(wait)
            original = httpx.URL(url)
            if original.scheme not in (("https", "http") if allow_http else ("https",)):
                raise WebError("Unapproved network destination.")
            hostname = original.raw_host.decode("ascii")
            addresses = await self._public_addresses(hostname, original.port or (443 if original.scheme=='https' else 80))
            # Pin the checked address; retain hostname for TLS verification/SNI.
            # Resolving again inside the client would reopen the gap between the
            # answer that was checked and the answer that is connected to.
            pinned = original.copy_with(host=addresses[0])
            limits["requests"].append(self.now())
            limits["next_at"] = self.now() + max(INTERVAL, delay)
            atomic_json(self.root / "limits.json", limits)
            authority=f'[{hostname}]' if ':' in hostname else hostname
            host_header = authority if original.port is None else f"{authority}:{original.port}"
            headers = {"Host": host_header, "User-Agent": USER_AGENT,
                       "Accept": "image/png,image/jpeg,image/webp,image/gif" if image else ACCEPT}
            for key,value in (conditional or {}).items():
                if key not in ("If-None-Match", "If-Modified-Since") or not isinstance(value,str) or len(value)>1000 or any(ord(c)<32 or ord(c)>126 for c in value):
                    raise WebError("Invalid conditional request metadata.")
                headers[key]=value
            job.update(status="fetching", message=f"{progress}Fetching {hostname}")
            try:
                async with asyncio.timeout(35):
                    async with httpx.AsyncClient(timeout=20, trust_env=False, follow_redirects=False,
                                                 transport=self.transport) as client:
                        async with client.stream("GET", pinned, headers=headers,
                                                 extensions={"sni_hostname": hostname}) as response:
                            if response.status_code in (429, 503):
                                seconds = max(60, retry_seconds(response.headers.get("retry-after"), self.now()))
                                self._block(seconds)
                                raise WebError(f"Site requested a pause ({seconds:.0f}s). No automatic retry.")
                            if response.status_code in (401, 403):
                                self._block(3600)
                                raise WebError("Site denied automated access. Stopped without trying another route.")
                            if response.status_code in REDIRECT_STATUSES or response.status_code == 404 or response.status_code in accepted_statuses:
                                return response.status_code, response.headers, b""
                            response.raise_for_status()
                            if image and response.headers.get("content-type", "").split(";")[0].strip().lower() not in IMAGE_TYPES:
                                raise WebError("Image URL did not return a supported raster image (PNG, JPEG, WebP or GIF).")
                            body = bytearray()
                            async for chunk in response.aiter_bytes():
                                if byte_budget is not None:
                                    byte_budget["remaining"] -= len(chunk)
                                    if byte_budget["remaining"] < 0:
                                        raise WebError("The 50 MB image download budget was reached.")
                                body.extend(chunk)
                                if len(body) > max_bytes:
                                    raise WebError(f"{'Image' if image else 'Page'} exceeds the {max_bytes // (1024 * 1024)} MB download limit.")
                            return response.status_code, response.headers, bytes(body)
            except httpx.TooManyRedirects as exc:
                raise WebError("That address redirects in a loop.") from exc
            except TimeoutError as exc:
                raise WebError(f"'{hostname}' exceeded the request deadline.") from exc
            except httpx.ConnectTimeout as exc:
                raise WebError(f"'{hostname}' did not answer in time.") from exc
            except httpx.ConnectError as exc:
                # A certificate failure arrives here; naming it beats a raw trace.
                detail = ("Its security certificate could not be verified."
                          if "CERTIFICATE" in str(exc).upper() or "SSL" in str(exc).upper()
                          else "The connection could not be established.")
                raise WebError(f"Could not connect to '{hostname}'. {detail}") from exc
            except httpx.HTTPStatusError as exc:
                raise WebError(f"'{hostname}' returned HTTP {exc.response.status_code}.") from exc
            except httpx.HTTPError as exc:
                raise WebError(f"The request to '{hostname}' failed ({type(exc).__name__}).") from exc
            finally:
                # Completion-to-start spacing also covers errors and cancellation.
                limits = self._limits()
                limits['last_completed']=self.now()
                limits["next_at"] = max(limits["next_at"], self.now() + max(INTERVAL, delay))
                atomic_json(self.root / "limits.json", limits)

    async def _check_robots(self, url, job, space=True):
        parts = httpx.URL(url)
        origin = "https://" + parts.raw_host.decode("ascii") + (f":{parts.port}" if parts.port else "")
        cached = self.robots.get(origin)
        if not cached or self.now() - cached[0] >= CACHE_SECONDS:
            try:
                status, _, body = await self._request(origin + "/robots.txt", job, space=space)
            except WebError as exc:
                # An unreachable robots.txt is not itself a refusal, but a real
                # refusal, budget stop, or cooldown must still surface unchanged.
                if any(word in str(exc) for word in ("cooldown", "Hourly", "denied", "pause")):
                    raise
                status, body = 404, b""
            parser = RobotFileParser()
            parser.parse([] if status == 404 else body.decode("utf-8", errors="replace").splitlines())
            self.robots[origin] = (self.now(), parser)
        parser = self.robots[origin][1]
        if not parser.can_fetch("LocalAIWorkstation", url):
            raise WebError("This page is disallowed by the site's robots.txt.")
        rate = parser.request_rate("LocalAIWorkstation")
        delay = max(INTERVAL, parser.crawl_delay("LocalAIWorkstation") or 0,
                    rate.seconds / rate.requests if rate and rate.requests else 0)
        # A newly learned Crawl-delay applies before the first page too.
        limits = self._limits()
        if limits["requests"]:
            limits["next_at"] = max(limits["next_at"], self.now() + delay)
            atomic_json(self.root / "limits.json", limits)
        return delay

    async def _run(self, job_id):
        job = self.jobs[job_id]
        try:
            async with asyncio.timeout(1200 if job["include_images"] else 240):
                result = await self.fetch(job["url"], job, include_images=job["include_images"])
            message = f"Imported · {len(result.get('images', []))} images saved"
            if result.get("image_warnings"):
                message += " · Some images could not be imported; see details below"
            job.update(status="complete", message=message, source=result)
        except asyncio.CancelledError:
            job.update(status="cancelled", message="Stopped")
        except WebError as exc:
            job.update(status="error", message=str(exc))
        except TimeoutError:
            job.update(status="error", message="The import reached its time limit. No source snapshot was saved.")
        except Exception as exc:
            job.update(status="error", message=f"Web import failed ({type(exc).__name__}). No automatic retry.")

    async def fetch(self, url, job, include_images=True):
        # ``start`` already normalizes, but this is the entry point a later
        # caller (RAG ingestion, a batch importer) would reach for, so it
        # validates its own input rather than trusting the caller to have done
        # it. Normalizing is idempotent and keeps the cache key canonical.
        url = normalize_url(url)
        key = hashlib.sha256((url + ("|images-v1" if include_images else "")).encode()).hexdigest()
        path = self.root / "cache" / (key + ".json")
        if path.exists():
            try:
                cached = json.loads(path.read_text(encoding="utf-8"))
                if (0 <= self.now() - cached["fetched_epoch"] < CACHE_SECONDS
                        and all(image_store.exists(item["src"]) for item in cached.get("images", []))):
                    return {**cached, "cached": True}
            except (OSError, ValueError, KeyError, TypeError):
                pass
        if not path.exists() and len(list((self.root / "cache").glob("*.json"))) >= 200:
            raise WebError("Web cache is full (200 pages). Existing chat snapshots remain available.")
        parts = httpx.URL(url)
        host = parts.raw_host.decode("ascii")
        if WIKIPEDIA_HOST.match(host) and parts.path.startswith("/wiki/") and ":" not in unquote(parts.path[6:]):
            result = await self._wikipedia(url, host, job)
        else:
            result = await self._page(url, job)
        candidates = result.pop("image_candidates", [])
        result.setdefault("image_warnings", [])
        result["images"] = []
        result["images_found"] = len(candidates)
        result["include_images"] = include_images
        if include_images:
            await self._import_images(result, candidates, job)
        if not result["text"] and not result["images"]:
            detail = " " + result["image_warnings"][0] if result["image_warnings"] else ""
            raise WebError("No readable page text or supported images were returned." + detail)
        text = result["text"][:MAX_TEXT]
        result.update({
            "id": key, "requested_url": url, "title": (result["title"] or host)[:300],
            "text": text, "char_count": len(text), "truncated": len(result["text"]) > MAX_TEXT,
            "fetched_at": datetime.now(timezone.utc).isoformat(), "fetched_epoch": self.now(),
            "content_hash": hashlib.sha256(text.encode()).hexdigest(), "cached": False,
        })
        atomic_json(path, result)
        return result

    async def _page(self, url, job):
        """Follow ordinary redirects, revalidating every hop before contacting it."""
        current, chain, seen = url, [], {url}
        for hop in range(MAX_REDIRECTS + 1):
            # Only the first request of an import waits out the inter-request
            # spacing. A redirect chain is one page view, not a second visit.
            space = hop == 0
            delay = await self._check_robots(current, job, space)
            status, headers, body = await self._request(current, job, delay, space)
            if status in REDIRECT_STATUSES:
                location = (headers.get("location") or "").strip()
                if not location:
                    raise WebError("That page sent a redirect without a destination.")
                try:
                    target = normalize_url(str(httpx.URL(current).join(location)))
                except (WebError, httpx.InvalidURL, ValueError) as exc:
                    raise WebError(f"That page redirects somewhere this importer will not follow. {exc}") from exc
                if target in seen:
                    raise WebError("That address redirects in a loop.")
                seen.add(target)
                chain.append(current)
                current = target
                job.update(status="fetching", message=f"Following redirect {len(chain)} of {MAX_REDIRECTS}")
                continue
            if status == 404:
                raise WebError("That page was not found (404).")
            media = (headers.get("content-type") or "").split(";")[0].strip().lower()
            if media not in READABLE_TYPES:
                raise WebError(f"That link returned '{media or 'an unknown type'}', which this importer cannot read. "
                               "It imports web pages, not files such as PDFs, images, or downloads.")
            decoded = decode_page(body, headers.get("content-type"))
            candidates, image_warnings = [], []
            if media == "text/plain":
                text, title = decoded.strip(), ""
            else:
                parser = PageText()
                try:
                    parser.feed(decoded)
                except (AssertionError, ValueError) as exc:
                    raise WebError("That page's HTML could not be read as text.") from exc
                text, title = parser.text(), parser.page_title()
                base = current
                if parser.base:
                    try:
                        base = normalize_url(str(httpx.URL(current).join(parser.base)))
                    except (WebError, httpx.InvalidURL):
                        image_warnings.append("The page's unsupported image base URL was ignored.")
                seen_images = set()
                for candidate in parser.images:
                    try:
                        image_url = normalize_url(str(httpx.URL(base).join(candidate["url"])))
                    except (WebError, httpx.InvalidURL, ValueError):
                        image_warnings.append("An image with an unsafe or unsupported address was skipped.")
                        continue
                    if image_url not in seen_images:
                        seen_images.add(image_url)
                        candidates.append({**candidate, "url": image_url})
                if parser.image_overflow:
                    image_warnings.append("Image discovery stopped after 200 candidates.")
            host = httpx.URL(current).raw_host.decode("ascii")
            return {
                "url": current, "title": title, "text": text, "status_code": status,
                "content_type": media, "redirect_chain": chain,
                "attribution": f"Retrieved from {host}. Rights remain with the original publisher.",
                "license_url": None, "revision": None,
                "image_candidates": candidates, "image_warnings": image_warnings,
            }
        raise WebError(f"That address redirected more than {MAX_REDIRECTS} times.")

    async def _import_images(self, result, candidates, job):
        byte_budget = {"remaining": MAX_IMAGE_TOTAL}
        if len(candidates) > MAX_IMAGES:
            result["image_warnings"].append(f"Only the first {MAX_IMAGES} images are imported per page.")
        for index, candidate in enumerate(candidates[:MAX_IMAGES]):
            job.update(image_index=index + 1, image_total=min(len(candidates), MAX_IMAGES),
                       images_saved=len(result["images"]))
            if byte_budget["remaining"] <= 0:
                result["image_warnings"].append("The 50 MB image budget was reached; remaining images were skipped.")
                break
            try:
                body, final_url = await self._image(candidate["url"], job, min(MAX_IMAGE_BYTES, byte_budget["remaining"]), byte_budget)
                metadata = await asyncio.to_thread(self._validate_image, body)
                reference = image_store.put_bytes(body)
                result["images"].append({
                    "id": f"web-{index + 1}", "src": reference,
                    "name": candidate["alt"] or f"Image {index + 1}", "source": "web",
                    "source_url": candidate["url"], "url": final_url, "order": index + 1,
                    "size": len(body), **metadata,
                })
            except WebError as exc:
                result["image_warnings"].append(f"Image {index + 1}: {exc}")
                limits = self._limits()
                if limits["blocked_until"] > self.now() or len([t for t in limits["requests"] if t > self.now() - 3600]) >= HOURLY_LIMIT:
                    result["image_warnings"].append("Remaining images were skipped because requests are paused or the hourly budget was reached.")
                    break

    @staticmethod
    def _validate_image(body):
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(body)) as image:
                    media = Image.MIME.get(image.format)
                    if media not in IMAGE_TYPES or image.width * image.height > MAX_IMAGE_PIXELS:
                        raise WebError("Unsupported image format or image exceeds the 40-million-pixel limit.")
                    metadata = {"width": image.width, "height": image.height, "type": media}
                    image.verify()
                    return metadata
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
            raise WebError("Image data is invalid, unsupported or too large to display safely.") from exc

    async def _image(self, url, job, max_bytes, byte_budget):
        current, seen = url, {url}
        for hop in range(MAX_REDIRECTS + 1):
            delay = await self._check_robots(current, job)
            status, headers, body = await self._request(current, job, delay, max_bytes=max_bytes, image=True, byte_budget=byte_budget)
            if status in REDIRECT_STATUSES:
                if hop == MAX_REDIRECTS:
                    raise WebError("Image redirected too many times.")
                location = headers.get("location")
                if not location:
                    raise WebError("Image redirect has no destination.")
                try:
                    current = normalize_url(str(httpx.URL(current).join(location)))
                except (httpx.InvalidURL, ValueError) as exc:
                    raise WebError(f"Image redirect is not allowed: {exc}") from exc
                if current in seen:
                    raise WebError("Image redirects in a loop.")
                seen.add(current)
                continue
            if status == 404:
                raise WebError("Image was not found (404).")
            return body, current

    async def _wikipedia(self, url, host, job):
        # Public read-only API adapter follows Wikimedia's API etiquette;
        # HTML robots rules are not repurposed as API authorization.
        title = unquote(urlsplit(url).path[len("/wiki/"):]).replace("_", " ")
        api_url = str(httpx.URL(f"https://{host}/w/api.php", params={
            "action": "query", "format": "json", "formatversion": "2", "prop": "extracts|info",
            "explaintext": "1", "inprop": "url", "redirects": "1", "titles": title, "maxlag": "5",
        }))
        status, headers, body = await self._request(api_url, job)
        if status == 404:
            raise WebError("Wikipedia API page not found.")
        if "json" not in headers.get("content-type", ""):
            raise WebError("Wikipedia did not return article data.")
        try:
            data = json.loads(body)
        except ValueError as exc:
            raise WebError("Wikipedia returned an unexpected response.") from exc
        if data.get("error"):
            self._block(60)
            raise WebError("Wikipedia API requested a pause or rejected the request. Try later.")
        try:
            page = data["query"]["pages"][0]
        except (KeyError, IndexError, TypeError) as exc:
            raise WebError("Wikipedia returned an unexpected response.") from exc
        if "missing" in page:
            raise WebError("Wikipedia article not found.")
        return {
            "url": normalize_url(page.get("fullurl", url)), "title": page["title"],
            "text": page.get("extract", "").strip(), "status_code": status,
            "content_type": "text/x-wiki", "redirect_chain": [],
            "attribution": "Wikipedia contributors; CC BY-SA 4.0 (additional terms may apply).",
            "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
            "revision": page.get("lastrevid"),
        }


manager = WebAccess()
