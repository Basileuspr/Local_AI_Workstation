import asyncio
import json
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import app_integrations as service
from routes.app_integrations import router


def test_official_embeds_are_normalized_and_arbitrary_origins_rejected():
    ident = '0123456789ABCDEFGHIJKL'
    assert service.embed_url('spotify', 'spotify:track:'+ident) == 'https://open.spotify.com/embed/track/'+ident
    assert service.embed_url('spotify', 'https://open.spotify.com/intl-en/playlist/'+ident+'?si=x').endswith('/playlist/'+ident)
    assert service.embed_url('discord', '123456789012345678').startswith('https://discord.com/widget?id=')
    for value in ['https://open.spotify.com.evil.test/track/'+ident, 'file:///C:/secret', 'https://user@open.spotify.com/track/'+ident]:
        with pytest.raises(ValueError): service.embed_url('spotify', value)
    with pytest.raises(ValueError): service.embed_url('discord', '<iframe>')


def test_preview_suppresses_mentions_and_never_contacts_discord():
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        result = client.post('/integrations/discord/preview', json={'content':'@everyone', 'title':'Review', 'description':'Files ready'}).json()
        assert result['allowed_mentions'] == {'parse': []}
        assert result['embeds'][0]['description'] == 'Files ready'


def test_discord_upload_uses_official_host_multipart_and_attachment_embed(monkeypatch):
    requests = []
    def handler(request):
        requests.append(request)
        body = request.read()
        assert b'files[0]' in body and b'attachment://0-picture.png' in body
        assert b'"allowed_mentions": {"parse": []}' in body
        return httpx.Response(200, json={'id':'123', 'channel_id':'456'})
    actual = httpx.AsyncClient
    monkeypatch.setattr(service.httpx, 'AsyncClient', lambda **kwargs: actual(transport=httpx.MockTransport(handler), **kwargs))
    value = {'method':'webhook','webhook':'https://discord.com/api/webhooks/123456789012345678/'+'x'*60,
             'content':'@everyone','title':'Picture','description':'','channel_id':'','bot_token':''}
    result = asyncio.run(service.send_discord(value, [('0-picture.png', b'image', 'image/png')]))
    assert result == {'ok':True, 'message_id':'123', 'channel_id':'456'}
    assert requests[0].url.host == 'discord.com' and requests[0].url.params['wait'] == 'true'
    for url in ['http://localhost/private','https://discord.com.evil.test/api/webhooks/123456789012345678/'+'x'*60]:
        with pytest.raises(ValueError): asyncio.run(service.send_discord({**value,'webhook':url}, []))
    assert len(requests) == 1


def test_invalid_payload_does_not_echo_secrets_and_audio_files_stay_owned(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'ROOT', tmp_path / 'playback')
    app=FastAPI();app.include_router(router)
    with TestClient(app) as client:
        response=client.post('/integrations/discord/send',data={'payload':json.dumps({'bot_token':'PRIVATE-SENTINEL','content':'x'*2100})})
        assert response.status_code == 400 and 'PRIVATE-SENTINEL' not in response.text
        recording=client.post('/integrations/spotify/recordings',files={'file':('capture.webm',b'\x1a\x45\xdf\xa3fixture','audio/webm')})
        assert recording.status_code == 200
        assert client.get('/integrations/spotify/recordings/'+recording.json()['id']).content.startswith(b'\x1a\x45\xdf\xa3')
        assert client.get('/integrations/spotify/recordings/not-an-id').status_code == 404
        assert client.post('/integrations/spotify/recordings',files={'file':('bad.webm',b'bad','audio/webm')}).status_code == 400
