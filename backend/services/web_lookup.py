"""Model-independent search and selected-page previews with bounded job state."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import threading
import time
from urllib.parse import urlsplit
from uuid import uuid4

from services import image_store, web_state
from services.request_queue import queue, QueueCancelled
from services.web_access import WebError
from services.web_retrieval import Retriever, digest
from services.web_sanitize import clean
from services.web_search import plain, search, search_config

TTL = 1800
TERMINAL = {'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'}


class Lookup:
    def __init__(self, retriever=None, clock=time.time):
        self.retriever = retriever or Retriever()
        self.clock = clock
        self.jobs, self.tasks = {}, {}
        self.reaper = None

    def prune(self):
        for ident, job in list(self.jobs.items()):
            if job['status'] in TERMINAL and job['expires_at'] <= self.clock():
                self.jobs.pop(ident, None)
                self.tasks.pop(ident, None)

    async def startup(self):
        async def sweep():
            while True:
                self.prune()
                await asyncio.sleep(30)
        if not self.reaper or self.reaper.done():
            self.reaper = asyncio.create_task(sweep())

    def state(self, ident):
        self.prune()
        if ident not in self.jobs:
            raise WebError('This search or preview expired. Start a new request.')
        return deepcopy(self.jobs[ident])

    def active(self):
        self.prune()
        return next((self.state(uid) for uid, task in self.tasks.items() if not task.done()), None)

    def start(self, kind, value, include_image=False):
        self.prune()
        if self.active():
            raise WebError('A search or page preview is active. Wait or stop it first.')
        if len(self.jobs) >= 20:
            oldest = min(self.jobs, key=lambda uid: self.jobs[uid]['created_at'])
            self.jobs.pop(oldest); self.tasks.pop(oldest, None)
        value = value.strip()
        if kind == 'search':
            if not 2 <= len(value) <= 300 or clean(value) != value:
                raise WebError('Enter 2–300 characters without credentials.')
        elif kind == 'preview':
            value = web_state.public_url(value)
        else:
            raise WebError('Unsupported web operation.')
        config = search_config()
        ident = uuid4().hex
        self.jobs[ident] = {'id': ident, 'kind': kind, 'value': value, 'status': 'PENDING', 'stage': 'queued',
                            'provider': config['provider'], 'results': [], 'source': None, 'warnings': [],
                            'created_at': self.clock(), 'expires_at': self.clock() + TTL}
        self.tasks[ident] = asyncio.create_task(self.run(ident, include_image, config))
        return self.state(ident)

    async def run(self, ident, include_image, config):
        job = self.jobs[ident]
        cancel = threading.Event()
        q = queue.enqueue('web-lookup', 'Web search / selected page', requires_gpu=False, cpu_lane='web',
                          request_id=ident, cancel=cancel.set)
        worker = None
        try:
            async with asyncio.timeout(300):
                await queue.wait(q)
                job.update(status='RUNNING', stage='searching' if job['kind'] == 'search' else 'reading')
                worker = asyncio.create_task(self.collect(job, include_image, config))
                while not worker.done():
                    if cancel.is_set():
                        raise asyncio.CancelledError()
                    await asyncio.wait({worker}, timeout=.15)
                await worker
                if cancel.is_set():
                    raise asyncio.CancelledError()
                job.update(status='PARTIAL' if job['warnings'] else 'COMPLETED', stage='ready')
        except (asyncio.CancelledError, QueueCancelled):
            job.update(status='CANCELLED', stage='stopped')
            await queue.cancel(q)
        except TimeoutError:
            job.update(status='PARTIAL' if job['source'] else 'FAILED', stage='stopped',
                       error='The request reached its time limit. Captured page text, if available, is retained.')
        except WebError as exc:
            job.update(status='PARTIAL' if job['source'] else 'FAILED', stage='stopped', error=clean(str(exc)))
        except Exception:
            job.update(status='PARTIAL' if job['source'] else 'FAILED', stage='stopped',
                       error='This web request could not complete. Try another source or check the provider settings.')
        finally:
            cancel.set()
            if worker and not worker.done():
                worker.cancel()
            if worker:
                await asyncio.gather(worker, return_exceptions=True)
            queue.finish(q, error=job.get('error'))
            job['expires_at'] = self.clock() + TTL

    async def collect(self, job, include_image, config):
        if job['kind'] == 'search':
            job['results'] = await search(job['value'], self.retriever, config)
            return
        doc = await self.retriever.retrieve(job['value'])
        text = clean(doc.text)
        if not text.strip() and not doc.image_candidates:
            raise WebError('No readable text was returned. This page may require JavaScript or a login; try a public source.')
        metadata_description = plain(doc.description, 500)
        description = metadata_description or ' '.join(text.split())[:500]
        source = {'id': digest(doc.url + str(doc.retrieved_at)), 'url': doc.url, 'requested_url': doc.requested_url,
                  'title': plain(doc.title, 300), 'domain': urlsplit(doc.url).hostname, 'text': text,
                  'description': description, 'description_kind': 'page_metadata' if metadata_description else 'page_excerpt',
                  'char_count': len(text), 'truncated': doc.truncated, 'content_hash': digest(text),
                  'fetched_at': datetime.fromtimestamp(doc.retrieved_at, timezone.utc).isoformat(),
                  'published_at': doc.published_at, 'images': [], 'image_warnings': [],
                  'attribution': 'Retrieved from ' + urlsplit(doc.url).hostname + '. Rights remain with the original publisher.'}
        job['source'] = source  # Publish usable text before attempting any image.
        if doc.truncated:
            job['warnings'].append('The page exceeded the text limit; this is an excerpt.')
        if include_image:
            job['stage'] = 'image'
            for candidate in doc.image_candidates[:3]:
                try:
                    # An image cannot consume the whole page deadline or erase captured text.
                    async with asyncio.timeout(60):
                        body, url, metadata = await self.retriever.image(candidate['url'])
                    reference = image_store.put_bytes(body)
                    source['images'].append({'id': 'preview-image', 'src': reference,
                        'name': plain(candidate.get('alt'), 200) or source['title'], 'source': 'web',
                        'source_url': candidate['url'], 'url': url, 'size': len(body), 'order': 1, **metadata})
                    break
                except (WebError, TimeoutError):
                    source['image_warnings'].append('A page image could not be safely retrieved; the page text is still available.')
            if not source['images']:
                job['warnings'].append('No supported page image was available.')

    async def cancel(self, ident):
        self.state(ident)
        task = self.tasks.get(ident)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        # Cancellation before the coroutine starts must also become terminal.
        if self.jobs[ident]['status'] not in TERMINAL:
            self.jobs[ident].update(status='CANCELLED', stage='stopped')
        return self.state(ident)

    async def discard(self, ident):
        await self.cancel(ident)
        self.jobs.pop(ident, None); self.tasks.pop(ident, None)
        return {'discarded': True}

    async def close(self):
        if self.reaper:
            self.reaper.cancel()
            await asyncio.gather(self.reaper, return_exceptions=True)
        # Shutdown must not look jobs up through state(): pruning an expired
        # result there could remove another ID while the close loop runs.
        tasks = list(self.tasks.values())
        for task in tasks:
            if not task.done():task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.jobs.clear(); self.tasks.clear()


manager = Lookup()
