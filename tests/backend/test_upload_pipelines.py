from io import BytesIO
import hashlib
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.testclient import TestClient
from PIL import Image
import pytest
from services.upload_routes import UploadRoute
from services import image_store, image_vault, session_store
from routes.sessions import router


def test_multipart_does_not_reject_file_count_or_manifest_size():
    app = FastAPI()
    app.router.route_class = UploadRoute

    @app.post('/upload')
    async def upload(files: list[UploadFile] = File(...), manifest: str = Form(...)):
        sizes = [len(await file.read()) for file in files]
        return {'files': len(sizes), 'bytes': sum(sizes), 'manifest': len(manifest)}

    with TestClient(app) as client:
        manifest = 'x' * (1024 * 1024 + 1)
        result = client.post('/upload', data={'manifest': manifest},
                             files=[('files', (f'{index}.txt', b'x')) for index in range(1001)])
        assert result.status_code == 200
        assert result.json() == {'files': 1001, 'bytes': 1001, 'manifest': len(manifest)}


@pytest.fixture
def chat_uploads(sessions_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(image_store, 'BLOBS_DIR', tmp_path / 'blobs')
    monkeypatch.setattr(image_vault, 'ROOT', tmp_path / 'vault')
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client, session_store.create_session()['id']


def png():
    output = BytesIO()
    Image.new('RGB', (4, 4), 'red').save(output, 'PNG')
    return output.getvalue()


def test_chat_image_larger_than_old_ceiling_preserves_bytes_and_only_stores_references(chat_uploads):
    client, ident = chat_uploads
    original = png() + b'\0' * (11 * 1024 * 1024)
    response = client.post(f'/sessions/{ident}/images', files={'file': ('large.png', original, 'image/png')})
    assert response.status_code == 200
    value = response.json()
    assert len(value['messages']) == 1
    message = value['messages'][0]
    assert value['uploaded_message_id'] == message['id']
    assert message['images'] == ['blob:' + hashlib.sha256(original).hexdigest()]
    assert message['imagePreviews'][0]['src'] == message['images'][0]
    assert message['imagePreviews'][0]['size'] == len(original)
    assert image_store.get_bytes(message['images'][0])[0] == original
    assert len(response.content) < 2048


def test_upload_keeps_format_destination_and_vault_validation(chat_uploads, monkeypatch):
    client, ident = chat_uploads
    assert client.post(f'/sessions/{ident}/images', files={'file': ('bad.png', b'not an image')}).status_code == 400
    assert client.post('/sessions/missing/images', files={'file': ('a.png', png())}).status_code == 404
    monkeypatch.setattr(image_vault, 'require_public', lambda *_: (_ for _ in ()).throw(image_vault.LockedImageError()))
    assert client.post(f'/sessions/{ident}/images', files={'file': ('locked.png', png())}).status_code == 403
    assert session_store.get_session(ident)['messages'] == []


def test_upload_has_no_generic_pixel_veto_and_preserves_global_decoder_policy(chat_uploads, monkeypatch):
    client, ident = chat_uploads
    original = png()
    monkeypatch.setattr(Image, 'MAX_IMAGE_PIXELS', 1)
    result = client.post(f'/sessions/{ident}/images', files={'file': ('large-pixels.png', original)})
    assert result.status_code == 200
    assert Image.MAX_IMAGE_PIXELS == 1


def test_streamed_blob_write_is_chunked_and_atomic(tmp_path, monkeypatch):
    monkeypatch.setattr(image_store, 'BLOBS_DIR', tmp_path / 'blobs')

    class GrowingInput(BytesIO):
        def read(self, size=-1):
            assert 0 <= size <= 1024 * 1024
            return super().read(size)

    raw = png() + b'padding' * 200000
    reference = image_store.put_stream(GrowingInput(raw))
    assert image_store.get_bytes(reference)[0] == raw
    assert not list(image_store.BLOBS_DIR.glob('.upload-*'))


def test_folder_review_can_select_unlimited_or_large_owner_chosen_coverage(tmp_path):
    from routes.folder_review import ReviewRequest
    from services.folder_review_reader import read_source, extract
    defaults = ReviewRequest(root=str(tmp_path))
    assert defaults.max_entries == defaults.max_bytes == defaults.max_chars == 0
    assert ReviewRequest(root=str(tmp_path), max_bytes=10 * 1024**3, max_entries=500000, max_chars=2000000)
    source = tmp_path / 'notes.txt'
    source.write_text('complete source text')
    raw = read_source(source, tmp_path, 0, lambda: None)
    assert extract(raw, source.name, 0)['text'] == 'complete source text'


def test_local_image_consumers_have_no_generic_pixel_veto(tmp_path, monkeypatch):
    from services import image_conversion
    from services.folder_review_reader import extract
    monkeypatch.setattr(image_conversion, 'ROOT', tmp_path / 'conversions')
    monkeypatch.setattr(Image, 'MAX_IMAGE_PIXELS', 1)
    raw = png()
    assert image_conversion.convert(raw, 'image.png', 'png')['size'] > 0
    assert extract(raw, 'image.png', 0)['metadata']['width'] == 4
    assert Image.MAX_IMAGE_PIXELS == 1
