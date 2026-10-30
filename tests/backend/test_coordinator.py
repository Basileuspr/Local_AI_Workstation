import asyncio
import copy
import json
import threading
from functools import wraps

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import coordinator as module
from services import coordinator_harnesses as harnesses
from services.coordinator import Coordinator
from services.web_retrieval import Document


def sync_test(fn):
    @wraps(fn)
    def execute(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))
    return execute


class Research:
    def __init__(self):
        self.discarded = []
        self.started = []

    def start(self, *args):
        self.started.append(args)
        return {'id': 'source-job', 'status': 'PENDING', 'stage': 'queued'}

    def state(self, ident):
        return {'id': ident, 'status': 'COMPLETED', 'stage': 'answered', 'answer': [{'text': 'Evidence supports this.', 'citations': ['S1']}],
                'sources': [{'id': 'S1', 'url': 'https://example.org/source', 'title': 'Source', 'retrieved_at': 123}], 'failures': [], 'queries': ['question'], 'provider': 'test'}

    def document(self, *args):
        return Document('https://example.org/source', 'Source', 'Captured evidence.', 123, 'hash')

    async def discard(self, ident):
        self.discarded.append(ident)


async def finish(owner, run):
    await owner.tasks[run['id']]
    return owner.get(run['id'])


@sync_test
async def test_research_is_durable_and_does_not_implicitly_index(tmp_path):
    source = Research()
    owner = Coordinator(tmp_path, research_adapter=source)
    run = owner.start('research', 'Question', 'local-model', {'urls': [], 'max_pages': 2, 'media_ids': []})
    result = await finish(owner, run)
    assert result['status'] == 'completed'
    assert result['harness_version'] == 1
    assert not result['receipts'] and 'documents' not in result
    assert source.discarded == ['source-job']
    restored = Coordinator(tmp_path)
    assert restored.document(run['id'], 'S1').text == 'Captured evidence.'
    with pytest.raises(ValueError): restored.document(run['id'], 'S2')
    restored.knowledge_receipt(run['id'], 'S1', {'doc_id': 'saved'})
    assert restored.get(run['id'])['receipts'][0]['action'] == 'knowledge'


@sync_test
async def test_restart_never_replays_interrupted_actions(tmp_path):
    async def pending(run, cancel):
        await asyncio.Event().wait()
    owner = Coordinator(tmp_path, media_adapter=pending)
    run = owner.start('media', 'Organize', 'local', {'media_ids': ['library:a']})
    with pytest.raises(ValueError, match='active'): owner.start('research', 'Another', 'local', {})
    await owner.stop(run['id'])
    assert owner.get(run['id'])['status'] == 'cancelled'
    interrupted = owner.get(run['id'], private=True)
    interrupted['status'] = 'applying'
    owner.save(interrupted)
    restored = Coordinator(tmp_path)
    assert restored.get(run['id'])['status'] == 'interrupted'
    assert not restored.tasks


def media_run(owner):
    ident = 'a' * 32
    baseline = {'media_id': 'library:a', 'tags': ['existing'], 'category': 'before'}
    run = {'id': ident, 'harness_id': 'media', 'harness_version': 1, 'status': 'needs_review', 'goal': 'Organize', 'model': 'local', 'created_at': 123,
           'inputs': {'media_ids': ['library:a']}, 'baseline': [baseline], 'documents': {}, 'receipts': [], 'transfer': None,
           'result': {'proposals': [{'media_id': 'library:a', 'tags': ['new'], 'category': 'after', 'reason': 'metadata'}]}}
    owner.save(run)
    return ident, baseline


def test_metadata_checks_staleness_and_single_use_preserves_tags(tmp_path, monkeypatch):
    owner = Coordinator(tmp_path)
    ident, baseline = media_run(owner)
    monkeypatch.setattr(module, 'snapshot', lambda _: {**baseline, 'category': 'external'})
    mutations = []
    monkeypatch.setattr(module.media, 'patch', lambda ident, changes: mutations.append(changes) or changes)
    with pytest.raises(ValueError, match='changed'): owner.apply_metadata(ident, ['library:a'])
    assert not mutations
    monkeypatch.setattr(module, 'snapshot', lambda _: copy.deepcopy(baseline))
    result = owner.apply_metadata(ident, ['library:a'])
    assert mutations == [{'tags': ['existing', 'new'], 'category': 'after'}]
    assert result['status'] == 'completed'
    with pytest.raises(ValueError, match='unapplied'): owner.apply_metadata(ident, ['library:a'])
    assert len(mutations) == 1


def test_transfer_requires_exact_plan_and_retains_receipt(tmp_path, monkeypatch):
    owner = Coordinator(tmp_path)
    ident, _ = media_run(owner)
    calls = []
    plan = {'id': 'b' * 32, 'mode': 'copy', 'status': 'ready', 'destination_preset_id': '0', 'entries': []}
    monkeypatch.setattr(module.media, 'prepare', lambda *args: copy.deepcopy(plan))
    monkeypatch.setattr(module.media, 'approve', lambda key: calls.append(('approve', key)))
    monkeypatch.setattr(module.media, 'coordinator_transfer', lambda *args: calls.append(args) or {**plan, 'status': 'complete'})
    with pytest.raises(ValueError): owner.prepare_transfer(ident, ['library:foreign'], 'copy', '0', 'rename')
    owner.prepare_transfer(ident, ['library:a'], 'copy', '0', 'rename')
    with pytest.raises(ValueError): owner.transfer(ident, 'c' * 32)
    assert not calls
    result = owner.transfer(ident, plan['id'])
    assert calls == [('approve', plan['id']), ('copy', plan['id'], '0')]
    assert result['receipts'][0]['action'] == 'transfer'
    assert result['status'] == 'needs_review'  # Metadata remains unapplied.
    with pytest.raises(ValueError): owner.transfer(ident, plan['id'])


def test_recovery_retains_unknown_version_and_corrupt_files(tmp_path):
    (tmp_path / ('a' * 32 + '.json')).write_text('{bad', encoding='utf-8')
    owner = Coordinator(tmp_path)
    assert owner.warnings and (tmp_path / ('a' * 32 + '.json')).exists()
    with pytest.raises(ValueError): owner.get('../outside')
    ident, _ = media_run(owner)
    with pytest.raises(ValueError): owner.document(ident, 'S1')
    row = owner.get(ident, private=True)
    row['harness_version'] = 99
    owner.save(row)
    with pytest.raises(ValueError, match='version'): owner.get(ident)


def test_routes_forbid_unconfirmed_and_foreign_actions(tmp_path, monkeypatch):
    from routes import coordinator as route
    owner = Coordinator(tmp_path)
    ident, _ = media_run(owner)
    monkeypatch.setattr(route, 'manager', lambda: owner)
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        assert client.post(f'/coordinator/runs/{ident}/metadata', json={'media_ids': ['library:a']}).status_code == 422
        assert client.post(f'/coordinator/runs/{ident}/metadata', json={'media_ids': ['library:a'], 'confirmed': False}).status_code == 422
        assert client.post(f'/coordinator/runs/{ident}/transfer', json={'reviewed_plan_id': 'b' * 32, 'confirmed': True, 'path': 'outside'}).status_code == 422
        assert client.post('/coordinator/runs', json={'harness_id': 'coding', 'goal': 'Edit', 'model': 'local'}).status_code == 422
        assert client.post('/coordinator/runs', json={'harness_id': 'media', 'goal': 'Edit', 'model': 'local', 'media_ids': ['library:a', 'library:a']}).status_code == 422
        assert client.post(f'/coordinator/runs/{ident}/knowledge', json={'source_ref': 'S1', 'confirmed': True}).status_code == 409


@sync_test
async def test_media_model_cannot_invent_ids_or_mutate_files(monkeypatch):
    run = {'id': 'a' * 32, 'goal': 'Tag', 'model': 'local', 'inputs': {'media_ids': ['library:a']}}
    monkeypatch.setattr(harnesses, 'snapshot', lambda ident: {'media_id': ident, 'tags': [], 'category': '', 'sha256': 'hash', 'file_state': 'present'})
    async def limit(*args): return 8192
    async def ready(*args): pass
    monkeypatch.setattr(harnesses, 'model_limit', limit)
    monkeypatch.setattr(harnesses, 'prepare_runtime', ready)
    monkeypatch.setattr(harnesses.queue, 'wait', ready)
    async def invalid(*args, **kwargs): return json.dumps({'summary': 'Done', 'proposals': [{'media_id': 'library:other', 'tags': ['tag'], 'category': 'test', 'reason': 'test'}]})
    with pytest.raises(ValueError, match='unknown'): await harnesses.plan_media(run, threading.Event(), invalid)
    async def valid(*args, **kwargs): return json.dumps({'summary': 'Proposed', 'proposals': [{'media_id': 'library:a', 'tags': ['tag'], 'category': 'test', 'reason': 'test'}]})
    result = await harnesses.plan_media(run, threading.Event(), valid)
    assert result['proposals'][0]['media_id'] == 'library:a'
    assert 'Metadata only' in result['coverage']


def test_duplicate_candidates_require_present_recorded_hashes():
    values = [{'media_id': name, 'sha256': 'same', 'file_state': state} for name, state in [('a', 'present'), ('b', 'present'), ('c', 'missing')]]
    assert harnesses.duplicates(values) == [['a', 'b']]


def test_actual_media_apply_copy_and_replay_guard(tmp_path, monkeypatch):
    from dataclasses import replace
    from io import BytesIO
    from pathlib import Path
    from PIL import Image
    from services import image_library, image_manager, visual_review, image_vault
    monkeypatch.setattr(image_library, 'ROOT', tmp_path / 'data/library')
    monkeypatch.setattr(visual_review, 'ROOT', tmp_path / 'data/review')
    monkeypatch.setattr(image_vault, 'ROOT', tmp_path / 'data/vault')
    catalog = image_manager.ImageManager(tmp_path / 'data/manager')
    monkeypatch.setattr(image_manager, 'manager', catalog)
    monkeypatch.setattr(module.media, 'manager', catalog)
    monkeypatch.setattr(module.media, 'settings', replace(module.media.settings, data_dir=tmp_path / 'data', models_dir=tmp_path / 'models'))
    raw = BytesIO()
    Image.new('RGB', (8, 8), 'blue').save(raw, 'PNG')
    image = image_library.import_image(raw.getvalue(), 'reference.png', {'kind': 'test'})
    media_id = 'library:' + image['id']
    module.media.patch(media_id, {'tags': ['keep'], 'category': 'Before'})
    owner = Coordinator(tmp_path / 'runs')
    ident, _ = media_run(owner)
    run = owner.get(ident, private=True)
    run['inputs']['media_ids'] = [media_id]
    run['baseline'] = [harnesses.snapshot(media_id)]
    run['result']['proposals'][0]['media_id'] = media_id
    owner.save(run)
    owner.apply_metadata(ident, [media_id])
    changed = module.media.media(media_id)
    assert changed['tags'] == ['keep', 'new'] and changed['category'] == 'after'
    original = Path(changed['path']).read_bytes()
    module.media.set_preset('0', str(tmp_path / 'organized'))
    planned = owner.prepare_transfer(ident, [media_id], 'copy', '0', 'rename')['transfer']
    assert not (tmp_path / 'organized').exists()
    result = owner.transfer(ident, planned['id'])
    assert result['transfer']['status'] == 'complete'
    assert Path(result['transfer']['entries'][0]['target']).read_bytes() == original
    assert Path(changed['path']).read_bytes() == original
    with pytest.raises(ValueError): owner.transfer(ident, planned['id'])


@sync_test
async def test_cancelled_http_action_waits_for_file_worker(tmp_path, monkeypatch):
    from routes import coordinator as route
    owner = Coordinator(tmp_path)
    monkeypatch.setattr(route, 'manager', lambda: owner)
    entered, release = threading.Event(), threading.Event()
    def operation():
        entered.set()
        release.wait(3)
        return {'complete': True}
    task = asyncio.create_task(route.action(operation))
    try:
        while not entered.is_set(): await asyncio.sleep(.01)
        task.cancel()
        await asyncio.sleep(.02)
        assert owner.actions == 1 and not task.done()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError): await task
    assert owner.actions == 0
