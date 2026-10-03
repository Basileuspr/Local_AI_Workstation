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


def test_converter_accepts_and_downloads_an_image_larger_than_24_mb(converted, tmp_path):
    source = tmp_path / "large-source.bmp"
    Image.new("RGB", (3072, 3072), (12, 70, 220)).save(source, "BMP")
    original = source.read_bytes()
    assert len(original) > 24 * 1024 * 1024
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client, source.open("rb") as upload:
        response = client.post("/workspaces/convert", files={"file": (source.name, upload, "image/bmp")}, data={"target": "png"})
        assert response.status_code == 200, response.text
        result = response.json()
        assert (result["width"], result["height"]) == (3072, 3072)
        downloaded = client.get("/workspaces/converted/" + result["id"])
        assert downloaded.status_code == 200
        assert downloaded.headers["content-type"] == "image/png"
        with Image.open(io.BytesIO(downloaded.content)) as image:
            assert image.size == (3072, 3072)
            assert image.convert("RGB").getpixel((0, 0)) == (12, 70, 220)
    assert source.read_bytes() == original


def test_converter_accepts_exact_file_limit_and_rejects_one_byte_over(converted, monkeypatch):
    # Exercise the upload read boundary with a small temporary limit.
    monkeypatch.setattr(conversion, "MAX_BYTES", len(converted))
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        accepted = client.post("/workspaces/convert", files={"file": ("boundary.png", converted, "image/png")}, data={"target": "png"})
        assert accepted.status_code == 200
        rejected = client.post("/workspaces/convert", files={"file": ("too-large.png", converted + b"\0", "image/png")}, data={"target": "png"})
        assert rejected.status_code == 400
        assert "100 MB" in rejected.json()["detail"]
    assert len(list(conversion.ROOT.glob("*.json"))) == 1


def test_converter_explains_pixel_limit_separately_from_file_size(converted):
    raw = io.BytesIO(); Image.new("1", (5000, 5000)).save(raw, "PNG")
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        response = client.post("/workspaces/convert", files={"file": ("too-many-pixels.png", raw.getvalue(), "image/png")}, data={"target": "png"})
        assert response.status_code == 400
        assert response.json()["detail"] == "Choose an image up to 24 megapixels."
    assert not conversion.ROOT.exists()


@pytest.mark.parametrize('dimensions,side', [((1200,600),256), ((30,8),24), ((8,6),16)])
def test_ico_has_square_frames_and_transparent_padding_without_changing_source(converted, dimensions, side, tmp_path):
    raw = io.BytesIO(); Image.new('RGBA', dimensions, (255,0,0,255)).save(raw,'PNG')
    source = tmp_path / 'original.png'; source.write_bytes(raw.getvalue())
    result = conversion.convert(source.read_bytes(), 'original.png', 'ico', icon_size=side)
    value, path = conversion.read(result['id'])
    assert result['format'] == 'ico' and value['name'] == 'original.ico'
    assert (value['width'],value['height']) == (side,side)
    assert path.read_bytes().startswith(b'\x00\x00\x01\x00')
    with Image.open(path) as output:
        assert output.format == 'ICO' and output.size == (side,side)
        assert output.ico.sizes() == {(size,size) for size in conversion.ICON_SIZES if size <= side}
        for size in output.ico.sizes():
            frame = output.ico.getimage(size).convert('RGBA')
            assert frame.size == size
            assert frame.getpixel((size[0]//2,size[1]//2))[0] > 240
            assert frame.getpixel((0,0))[3] == 0
    assert source.read_bytes() == raw.getvalue()


def test_small_image_ico_defaults_to_all_windows_sizes_and_fill_can_remove_padding(converted):
    raw = io.BytesIO(); Image.new('RGBA', (30, 8), (12, 70, 220, 255)).save(raw, 'PNG')
    result = conversion.convert(raw.getvalue(), 'small.png', 'ico')
    assert result['icon_sizes'] == list(conversion.ICON_SIZES)
    with Image.open(conversion.read(result['id'])[1]) as icon:
        assert icon.size == (256, 256)
        assert icon.ico.sizes() == {(size, size) for size in conversion.ICON_SIZES}
        assert icon.convert('RGBA').getpixel((0, 0))[3] == 0
    result = conversion.convert(raw.getvalue(), 'filled.png', 'ico', icon_size=48, icon_fit='cover')
    with Image.open(conversion.read(result['id'])[1]) as icon:
        assert icon.size == (48, 48)
        assert icon.convert('RGBA').getpixel((0, 0))[3] == 255
    with pytest.raises(ValueError): conversion.convert(converted, 'bad.png', 'ico', icon_size=42)


def test_ico_download_and_preview_are_usable_images(converted):
    raw=io.BytesIO();Image.new('RGBA',(512,256),(0,128,255,128)).save(raw,'PNG')
    app=FastAPI();app.include_router(router)
    with TestClient(app) as client:
        response=client.post('/workspaces/convert',files={'file':('transparent.png',raw.getvalue(),'image/png')},data={'target':'ico'})
        assert response.status_code == 200
        url='/workspaces/converted/'+response.json()['id']
        downloaded=client.get(url)
        assert downloaded.status_code == 200
        assert downloaded.headers['content-type'] == 'image/vnd.microsoft.icon'
        assert 'transparent.ico' in downloaded.headers['content-disposition']
        with Image.open(io.BytesIO(downloaded.content)) as icon:
            assert icon.size == (256,256)
            assert icon.convert('RGBA').getpixel((128,128))[3] == 128
        preview=client.get(url+'?thumbnail=true')
        assert preview.status_code == 200 and preview.headers['content-type'] == 'image/png'
        with Image.open(io.BytesIO(preview.content)) as image: assert image.size == (256,256)
    assert conversion.conversion_target('Convert this to .ico') == 'ico'
    assert conversion.conversion_target('How do I convert to ICO?') is None


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
