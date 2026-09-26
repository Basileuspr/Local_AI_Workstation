import asyncio
import io
import json
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import image_conversion as conversion, image_vault, knowledge_base as kb
from services.chat_canvas import CanvasContext, CanvasEdit, validate_edit, stream_canvas
from routes.workspaces import router


@pytest.fixture
def converted(tmp_path, monkeypatch):
    monkeypatch.setattr(conversion, "ROOT", tmp_path / "converted")
    monkeypatch.setattr(image_vault, "ROOT", tmp_path / "vault")
    raw = io.BytesIO(); Image.new("RGBA", (8, 6), (255, 0, 0, 0)).save(raw, "PNG")
    return raw.getvalue()


@pytest.mark.parametrize("target", ["png", "jpg", "webp", "bmp", "tiff"])
def test_convert_real_file(converted, target):
    result = conversion.convert(converted, "../source.png", target)
    value, path = conversion.read(result["id"])
    assert value["name"] == "source." + target
    with Image.open(path) as output:
        assert output.size == (8, 6)
        if target in ("jpg", "bmp"): assert output.convert("RGB").getpixel((0, 0)) == (255, 255, 255)


def test_conversion_download_is_image_and_not_sidecar(converted):
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        response = client.post("/workspaces/convert", files={"file": ("test.png", converted, "image/png")}, data={"target": "jpg"})
        assert response.status_code == 200
        result = response.json()
        downloaded = client.get("/workspaces/converted/" + result["id"])
        assert downloaded.headers["content-type"] == "image/jpeg"
        assert 'test.jpg' in downloaded.headers['content-disposition']
        Image.open(io.BytesIO(downloaded.content)).verify()
        assert client.get('/workspaces/converted/not-an-id').status_code == 404


def test_conversion_rejects_invalid_animated_and_future_locked_source(converted, monkeypatch):
    with pytest.raises(ValueError): conversion.convert(b'not an image', 'bad.png', 'png')
    animated=io.BytesIO();Image.new('RGB',(4,4),'red').save(animated,'GIF',save_all=True,append_images=[Image.new('RGB',(4,4),'blue')])
    with pytest.raises(ValueError,match='Animated'): conversion.convert(animated.getvalue(),'animated.gif','png')
    result=conversion.convert(converted,'a.png','jpg')
    import hashlib
    monkeypatch.setattr(image_vault,'locked_hashes',lambda:{hashlib.sha256(converted).hexdigest()})
    with pytest.raises(image_vault.LockedImageError): conversion.read(result['id'])


def test_knowledge_empty_selection_does_not_open_or_query_index(monkeypatch):
    monkeypatch.setattr(kb,'_get_collection',lambda:pytest.fail('Unselected library must not be searched'))
    assert kb.query_knowledge_base('question',doc_ids=[]) == []


def test_conversion_download_blocks_a_locked_output_even_when_source_is_public(converted, monkeypatch):
    import hashlib
    result = conversion.convert(converted, 'source.png', 'jpg')
    _, file = conversion.read(result['id'])
    output_hash = hashlib.sha256(file.read_bytes()).hexdigest()
    assert output_hash != hashlib.sha256(converted).hexdigest()
    monkeypatch.setattr(image_vault, 'locked_hashes', lambda: {output_hash})
    with pytest.raises(image_vault.LockedImageError):
        conversion.read(result['id'])
    with pytest.raises(image_vault.LockedImageError):
        conversion.convert(converted, 'source.png', 'jpg')


def test_knowledge_scope_filters_inside_vector_query(monkeypatch):
    received={}
    class Collection:
        def count(self):return 1000
        def query(self,**kwargs):
            received.update(kwargs)
            return {'ids':[['a']], 'documents':[['Selected document excerpt']], 'metadatas':[[{'filename':'a.txt','doc_id':'selected','chunk_index':0}]], 'distances':[[0.1]]}
    monkeypatch.setattr(kb,'_get_collection',lambda:Collection())
    monkeypatch.setattr(kb,'_create_embedding',lambda *_:[1,2])
    result=kb.query_knowledge_base('question',5,doc_ids=['selected'])
    assert received['where']=={'doc_id':{'$in':['selected']}}
    assert received['n_results']==5
    assert result[0]['doc_id']=='selected'


def test_canvas_rejects_out_of_scope_edits():
    context=CanvasContext(revision='v1')
    edit=CanvasEdit(summary='delete',operations=[{'op':'remove','id':'outside'}])
    with pytest.raises(ValueError,match='outside'):validate_edit(edit,context)


def test_canvas_stream_returns_real_validated_operations():
    spec={'summary':'Added a label','operations':[{'op':'add','item':{'type':'text','x':50,'y':50,'width':150,'height':30,'text':'Start','color':'#234878'}}]}
    async def run():
        def respond(request):
            body=json.loads(request.content)
            assert body['format']['title']=='CanvasEdit'
            return httpx.Response(200,text=json.dumps({'message':{'content':json.dumps(spec)},'done':True})+'\n')
        request=SimpleNamespace(canvas_context=CanvasContext(revision='v1'))
        class ClientRequest:
            async def is_disconnected(self):return False
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return ''.join([part async for part in stream_canvas(client,{'messages':[]},request,ClientRequest())])
    output=asyncio.run(run());assert 'canvas_edit' in output;assert 'Start' in output;assert 'v1' in output
