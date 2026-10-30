"""Durable Coordinator runs; coding retains its existing storage and native controls."""
import asyncio
from contextlib import suppress
from dataclasses import asdict
import json
from pathlib import Path
import re
import tempfile
import threading
import time
from uuid import uuid4

from config import settings
from services.coordinator_harnesses import plan_media, snapshot
from services import review_workflow as media
from services.request_queue import QueueCancelled
from services.web_research import manager as research
from services.web_retrieval import Document

ACTIVE = {'queued', 'running'}


class Coordinator:
    def __init__(self, root, research_adapter=None, media_adapter=None):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.research = research_adapter or research
        self.media_adapter = media_adapter or plan_media
        self.tasks, self.cancels = {}, {}
        self.lock = threading.RLock()
        self.actions = 0
        self.warnings = []
        for path in self.root.glob('*.json'):
            try:
                value = self.get(path.stem, private=True)
                if value['status'] in ACTIVE or value['status'] == 'applying':
                    value.update(status='interrupted', phase='App restarted. Inspect saved receipts; actions are not replayed.')
                    self.save(value)
            except (ValueError, OSError, KeyError, TypeError):
                self.warnings.append('A saved Coordinator task needs recovery; its file was retained.')

    def path(self, ident):
        if not re.fullmatch(r'[a-f0-9]{32}', ident):
            raise ValueError('Invalid Coordinator task ID.')
        return self.root / (ident + '.json')

    def save(self, run):
        with self.lock:
            run['updated_at'] = time.time()
            data = json.dumps(run, ensure_ascii=False)
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=self.root, suffix='.tmp', delete=False) as handle:
                handle.write(data)
            Path(handle.name).replace(self.path(run['id']))

    def get(self, ident, private=False):
        with self.lock:
            path = self.path(ident)
            if not path.exists():
                raise ValueError('Coordinator task is unavailable.')
            if path.stat().st_size > 8 * 1024 * 1024:
                raise ValueError('Coordinator task exceeds the recovery size limit.')
            run = json.loads(path.read_text(encoding='utf-8'))
            if run['id'] != ident or run['harness_id'] not in {'research', 'media'} or run['harness_version'] != 1:
                raise ValueError('This task needs a compatible harness version.')
            if not private:
                run.pop('documents', None)
                run.pop('baseline', None)
            return run

    def listing(self):
        runs = []
        for path in self.root.glob('*.json'):
            try:
                row = self.get(path.stem)
                runs.append({key: row[key] for key in ('id', 'harness_id', 'harness_version', 'goal', 'model', 'status', 'created_at')})
            except (ValueError, OSError, KeyError, TypeError):
                continue
        return sorted(runs, key=lambda row: row['created_at'], reverse=True)

    def busy(self):
        return bool(self.actions or any(not task.done() for task in self.tasks.values()))

    def start(self, harness, goal, model, inputs):
        if self.busy():
            raise ValueError('Finish or stop the active research or media task first.')
        if len(list(self.root.glob('*.json'))) >= 100:
            raise ValueError('Remove older Coordinator runs before starting another (100 saved runs maximum).')
        if harness not in {'research', 'media'}:
            raise ValueError('Use the native Coding controls for coding tasks.')
        run = {'id': uuid4().hex, 'harness_id': harness, 'harness_version': 1, 'goal': goal,
               'model': model, 'inputs': inputs, 'status': 'queued', 'phase': 'Queued', 'created_at': time.time(),
               'plan': (['Find and read bounded public sources', 'Verify answer citations', 'Review selected sources for Knowledge'] if harness == 'research'
                        else ['Inspect selected registered metadata', 'Propose tags and categories', 'Review metadata and file plans']),
               'events': [], 'receipts': [], 'result': None, 'documents': {}, 'baseline': [], 'transfer': None}
        self.save(run)
        cancel = threading.Event()
        self.cancels[run['id']] = cancel
        self.tasks[run['id']] = asyncio.create_task(self.execute(run, cancel))
        return self.get(run['id'])

    async def execute(self, run, cancel):
        research_id = None
        try:
            run.update(status='running', phase='Researching public evidence' if run['harness_id'] == 'research' else 'Planning from registered metadata')
            self.save(run)
            if run['harness_id'] == 'research':
                job = self.research.start(run['goal'], run['model'], run['inputs']['urls'], run['inputs']['max_pages'], True)
                research_id = job['id']
                while job['status'] in {'PENDING', 'RUNNING'}:
                    if cancel.is_set():
                        raise asyncio.CancelledError()
                    if run['phase'] != job['stage']:
                        run['phase'] = job['stage']
                        self.save(run)
                    await asyncio.sleep(.25)
                    job = self.research.state(research_id)
                if job['status'] == 'CANCELLED':
                    raise asyncio.CancelledError()
                if job['status'] not in {'COMPLETED', 'PARTIAL'}:
                    raise ValueError(job.get('error', 'Research did not produce verified evidence.'))
                run['result'] = {key: job.get(key) for key in ('answer', 'sources', 'failures', 'queries', 'provider')}
                run['documents'] = {source['id']: asdict(self.research.document(research_id, source['id'])) for source in job['sources']}
                run.update(status='needs_review' if job['status'] == 'PARTIAL' else 'completed', phase='Cited answer ready; saving to Knowledge is separate')
            else:
                run['result'] = await self.media_adapter(run, cancel)
                run.update(status='needs_review', phase='Metadata proposals ready; no changes applied')
            if cancel.is_set():
                raise asyncio.CancelledError()
            run['events'].append('Harness finished with checked source IDs and bounded results.')
        except (asyncio.CancelledError, QueueCancelled):
            cancel.set()
            run.update(status='cancelled', phase='Stopped; no pending actions will run')
        except Exception as error:
            run.update(status='failed', phase='Task failed', error=str(error) if isinstance(error, ValueError) else 'The harness could not complete. Check the local model and source availability.')
        finally:
            if research_id:
                with suppress(ValueError):
                    await self.research.discard(research_id)
            self.save(run)

    async def stop(self, ident):
        self.get(ident)
        task = self.tasks.get(ident)
        if task and not task.done():
            self.cancels[ident].set()
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            # A just-created task can be cancelled before execute enters its finally.
            run = self.get(ident, private=True)
            if run['status'] in ACTIVE:
                run.update(status='cancelled', phase='Stopped before starting')
                self.save(run)
        return self.get(ident)

    def ready(self, ident, harness):
        run = self.get(ident, private=True)
        if run['harness_id'] != harness or run['status'] not in {'completed', 'needs_review'}:
            raise ValueError('Choose a finished task from the matching harness.')
        return run

    def apply_metadata(self, ident, ids):
        with self.lock, media.LOCK:
            run = self.ready(ident, 'media')
            proposals = {item['media_id']: item for item in run['result']['proposals']}
            baseline = {item['media_id']: item for item in run['baseline']}
            done = {item['media_id'] for item in run['receipts'] if item['action'] == 'metadata'}
            if not ids or len(set(ids)) != len(ids) or any(item not in proposals or item in done for item in ids):
                raise ValueError('Choose unapplied proposals from this exact task.')
            for item in ids:
                if snapshot(item) != baseline[item]:
                    raise ValueError('Selected metadata changed after planning. Start a new review before applying.')
            run.update(status='applying', phase='Applying reviewed metadata')
            self.save(run)
            try:
                for item in ids:
                    proposal = proposals[item]
                    tags = list(dict.fromkeys([*baseline[item]['tags'], *proposal['tags']]))
                    receipt = media.patch(item, {'tags': tags, 'category': proposal['category']})
                    run['receipts'].append({'action': 'metadata', 'media_id': item, 'result': receipt})
                    self.save(run)
                run.update(status='completed' if len(done) + len(ids) == len(proposals) else 'needs_review', phase='Reviewed metadata applied')
            except Exception:
                run.update(status='needs_review', phase='Some metadata could not be applied; inspect receipts before retrying')
                raise
            finally:
                self.save(run)
            return self.get(ident)

    def prepare_transfer(self, ident, ids, mode, preset, collision):
        with self.lock:
            run = self.ready(ident, 'media')
            if any(item not in run['inputs']['media_ids'] for item in ids):
                raise ValueError('Choose media from this task.')
            plan = media.prepare(ids, mode, preset, collision)
            run['transfer'] = plan
            self.save(run)
            return self.get(ident)

    def transfer(self, ident, plan_id):
        with self.lock, media.LOCK:
            run = self.ready(ident, 'media')
            plan = run.get('transfer')
            if not plan or plan['id'] != plan_id or plan['status'] != 'ready':
                raise ValueError('Review a fresh exact transfer plan before confirming.')
            # Only the human confirmation route calls this; the model cannot approve plans.
            media.approve(plan_id)
            run.update(status='applying', phase='Executing reviewed transfer')
            self.save(run)
            try:
                receipt = media.coordinator_transfer(plan['mode'], plan_id, plan['destination_preset_id'])
                run['transfer'] = receipt
                run['receipts'].append({'action': 'transfer', 'result': receipt})
                applied = {item['media_id'] for item in run['receipts'] if item['action'] == 'metadata'}
                outstanding = any(item['media_id'] not in applied for item in run['result']['proposals'])
                run.update(status='needs_review' if receipt['status'] != 'complete' or outstanding else 'completed', phase='Inspect transfer receipt')
            except Exception:
                run['transfer'] = media.get('plan', plan_id)
                run.update(status='needs_review', phase='Transfer stopped; inspect the retained plan')
                raise
            finally:
                self.save(run)
            return self.get(ident)

    def document(self, ident, source):
        run = self.ready(ident, 'research')
        if source not in run['documents']:
            raise ValueError('Choose a captured source from this research task.')
        return Document(**run['documents'][source])

    def knowledge_receipt(self, ident, source, result):
        with self.lock:
            run = self.ready(ident, 'research')
            run['receipts'].append({'action': 'knowledge', 'source_ref': source, 'result': result})
            self.save(run)
            return self.get(ident)

    def delete(self, ident):
        with self.lock:
            self.get(ident)
            if self.actions or (ident in self.tasks and not self.tasks[ident].done()):
                raise ValueError('Stop the task before removing its history.')
            self.path(ident).unlink()
            self.tasks.pop(ident, None)
            self.cancels.pop(ident, None)
            return {'removed': True}

    async def close(self):
        for ident in list(self.tasks):
            await self.stop(ident)


_manager = None


def manager():
    global _manager
    if _manager is None:
        _manager = Coordinator(settings.data_dir / 'coordinator')
    return _manager


def is_busy():
    return bool(_manager and _manager.busy())
