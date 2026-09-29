import io
import json

import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import character_resources as resources, image_library, image_vault
from services.faces import bank
from services.character_parts import store as parts


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(bank, 'ROOT', tmp_path/'bank')
    monkeypatch.setattr(parts, 'ROOT', tmp_path/'parts')
    monkeypatch.setattr(image_library, 'ROOT', tmp_path/'images')
    monkeypatch.setattr(image_vault, 'ROOT', tmp_path/'vault')


def png():
    stream=io.BytesIO();Image.new('RGB',(8,8),'red').save(stream,format='PNG');return stream.getvalue()


def test_old_profiles_gain_optional_fields_without_rewriting_or_losing_faces():
    profile=bank.create_character('Existing')
    path=bank._path(profile['id'])
    profile.pop('bio');profile.pop('resources');path.write_text(json.dumps(profile))
    original=path.read_bytes()
    loaded=bank.get_character(profile['id'])
    assert loaded['bio']=='' and loaded['resources']==[]
    assert path.read_bytes()==original
    bank.update_character(profile['id'],bio='An explorer',notes='Likes tea')
    assert bank.get_character(profile['id'])['bio']=='An explorer'


def test_links_are_idempotent_shared_and_removal_preserves_sources():
    first=bank.create_character('A');second=bank.create_character('B');dataset=parts.create('Hands')
    link=resources.add(first['id'],'parts',dataset['id'],'Left hand')
    assert resources.add(first['id'],'parts',dataset['id'],'replacement')==link
    resources.add(second['id'],'parts',dataset['id'])
    resources.edit(first['id'],link['id'],'Both hands')
    resources.unlink(first['id'],link['id'])
    assert parts.read(dataset['id'])['id']==dataset['id']
    assert resources.list_resources(first['id'])==[]
    assert resources.list_resources(second['id'])[0]['available']


def test_missing_source_keeps_association_and_notes():
    owner=bank.create_character('A');target=bank.create_character('B')
    resources.add(owner['id'],'character',target['id'],'Sibling')
    bank.delete_character(target['id'])
    item=resources.list_resources(owner['id'])[0]
    assert not item['available'] and item['resource'] is None and item['note']=='Sibling'
    with pytest.raises(ValueError):resources.add(owner['id'],'character',owner['id'])
    with pytest.raises(ValueError):resources.add(owner['id'],'shell','whoami')
    with pytest.raises(ValueError):resources.add(owner['id'],'parts','../outside')


def test_uploads_deduplicate_across_characters_and_survive_unlink_and_delete():
    first=bank.create_character('A');second=bank.create_character('B');payload=png()
    link=resources.upload(first['id'],'portrait.png',payload,'Reference')
    again=resources.upload(second['id'],'renamed.png',payload)
    assert link['target_id']==again['target_id']
    assert len(list((bank.ROOT/'assets').glob('*.blob')))==1
    resources.unlink(first['id'],link['id']);bank.delete_character(second['id'])
    assert resources.asset(link['target_id'])['category']=='image'
    assert resources.asset_path(link['target_id'],'blob').read_bytes()==payload
    assert len(resources.catalog('file'))==1
    resources.add(first['id'],'file',link['target_id'])
    assert resources.list_resources(first['id'])[0]['available']


def test_locked_sources_are_unavailable_in_all_character_paths(monkeypatch):
    profile=bank.create_character('A');payload=png()
    image=image_library.import_image(payload,'Private.png')
    resources.add(profile['id'],'image',image['id'])
    link=resources.upload(profile['id'],'Private.png',payload)
    monkeypatch.setattr(image_vault,'locked_hashes',lambda:{image['sha256']})
    assert resources.catalog('image')==[] and resources.catalog('file')==[]
    assert all(not item['available'] for item in resources.list_resources(profile['id']))
    for action in [lambda:resources.asset(link['target_id']),lambda:resources.upload(profile['id'],'changed.wav',payload),lambda:resources.add(profile['id'],'image',image['id'])]:
        with pytest.raises(ValueError):action()


def test_catalogs_do_not_export_local_model_paths(lora_paths):
    from services import lora_store
    project=lora_store.create_project('Identity',output_location='private-local-folder')
    owner=bank.create_character('A')
    resources.add(owner['id'],'lora_project',project['id'])
    assert resources.catalog('lora_project')==[{'id':project['id'],'name':'Identity'}]
    assert 'private-local-folder' not in json.dumps(resources.list_resources(owner['id']))


def test_upload_limits_and_invalid_ids_do_not_create_files(monkeypatch):
    profile=bank.create_character('A');monkeypatch.setattr(resources,'MAX_FILE_BYTES',10)
    for payload in [b'',b'x'*11]:
        with pytest.raises(ValueError):resources.upload(profile['id'],'file.txt',payload)
    with pytest.raises(ValueError):resources.upload('f'*32,'file.txt',b'abc')
    with pytest.raises(ValueError):resources.asset_path('../private','blob')
    assert not (bank.ROOT/'assets').exists()


def test_routes_round_trip_binary_and_do_not_execute_html():
    from routes import faces
    app=FastAPI();app.include_router(faces.router)
    with TestClient(app) as client:
        created=client.post('/faces/characters',json={'name':'Test','bio':'Background'}).json()
        base='/faces/characters/'+created['id']
        upload=client.post(base+'/files',files={'file':('sample.html',b'<script>bad()</script>','text/html')},data={'note':'Costume notes'})
        assert upload.status_code==201
        link=upload.json()
        full=client.get(base).json()
        assert full['bio']=='Background' and full['resources'][0]['resource']['name']=='sample.html'
        result=client.get('/faces/character-resources/files/'+link['target_id'])
        assert result.headers['content-type']=='application/octet-stream'
        assert result.headers['content-disposition'].startswith('attachment;')
        assert result.content==b'<script>bad()</script>'
        assert client.put(base+'/resources/'+link['id'],json={'note':'Updated'}).status_code==200
        assert client.delete(base+'/resources/'+link['id']).status_code==200
        assert client.get('/faces/character-resources/files/'+link['target_id']).status_code==200


@pytest.mark.parametrize('format,suffix',[('PNG','png'),('JPEG','jpg'),('WEBP','webp'),('BMP','bmp'),('TIFF','tiff'),('GIF','gif')])
def test_image_files_keep_their_original_bytes_and_type(format,suffix):
    output=io.BytesIO()
    image=Image.new('RGB',(16,16),'red')
    options={'save_all':True,'append_images':[Image.new('RGB',(16,16),'blue')],'duration':100} if format=='GIF' else {}
    image.save(output,format=format,**options)
    profile=bank.create_character('Image reference')
    link=resources.upload(profile['id'],f'portrait.{suffix}',output.getvalue())
    assert resources.asset(link['target_id'])['category']=='image'
    assert resources.asset_path(link['target_id'],'blob').read_bytes()==output.getvalue()


@pytest.mark.parametrize('suffix,video,expected_type',[('.mp4',True,'video/mp4'),('.webm',True,'video/webm'),('.webm',False,'audio/webm'),('.mp4',False,'audio/mp4')])
def test_video_classification_preserves_audio_only_recordings_and_upgrades_old_uploads(tmp_path,suffix,video,expected_type):
    from test_audio_extraction import media
    source=tmp_path/f'clip{suffix}';media(source,video=video)
    payload=source.read_bytes()
    profile=bank.create_character('Media reference')
    link=resources.upload(profile['id'],source.name,payload)
    assert resources.asset(link['target_id'])['media_type']==expected_type
    metadata_path=resources.asset_path(link['target_id'],'json')
    metadata=json.loads(metadata_path.read_text());metadata.pop('media_version')
    metadata.update(category='audio' if suffix=='.webm' else 'file',media_type='audio/webm' if suffix=='.webm' else 'application/octet-stream')
    metadata_path.write_text(json.dumps(metadata))
    assert resources.asset(link['target_id'])['media_type']==expected_type
    assert resources.asset(link['target_id'])['category']==('video' if video else 'audio')
    assert resources.asset_path(link['target_id'],'blob').read_bytes()==payload==source.read_bytes()


def test_video_range_requests_support_seeking_and_download_preserves_original(tmp_path):
    from test_audio_extraction import media
    from routes import faces
    source=tmp_path/'scene.mp4';media(source)
    payload=source.read_bytes()
    profile=bank.create_character('Video reference')
    link=resources.upload(profile['id'],source.name,payload)
    app=FastAPI();app.include_router(faces.router)
    with TestClient(app) as client:
        url='/faces/character-resources/files/'+link['target_id']
        result=client.get(url,headers={'Range':'bytes=0-31'})
        assert result.status_code==206 and result.content==payload[:32]
        assert result.headers['content-type']=='video/mp4'
        assert result.headers['content-range']==f'bytes 0-31/{len(payload)}'
        assert result.headers['content-disposition'].startswith('inline;')
        download=client.get(url+'?download=true')
        assert download.headers['content-disposition'].startswith('attachment;') and download.content==payload
    resources.unlink(profile['id'],link['id'])
    assert resources.asset_path(link['target_id'],'blob').read_bytes()==payload


def test_unpreviewable_video_is_retained_and_html_cannot_masquerade_as_an_image():
    profile=bank.create_character('References')
    link=resources.upload(profile['id'],'old-video.avi',b'unsupported clip bytes')
    assert resources.asset(link['target_id'])['category']=='video'
    assert resources.asset_path(link['target_id'],'blob').read_bytes()==b'unsupported clip bytes'
    with pytest.raises(ValueError,match='unreadable'):
        resources.upload(profile['id'],'unsafe.png',b'<html>not an image</html>')
