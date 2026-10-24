import json
import subprocess
from types import SimpleNamespace

import pytest
from mobile_companion import connection_discovery as discovery


def config(host='desktop.example.ts.net:443', proxy='http://127.0.0.1:8766'):
    return {'TCP': {'443': {'HTTPS': True}}, 'Web': {host: {'Handlers': {'/': {'Proxy': proxy}}}}}


def test_discovers_only_existing_private_proxy_for_requested_port():
    result = discovery.serve_connections(config(), 8766)
    assert len(result) == 1 and result[0]['origin'] == 'https://desktop.example.ts.net:443'
    assert result[0]['port'] == 8766 and result[0]['address'] == '127.0.0.1'
    assert discovery.serve_connections(config(), 9000) == []
    assert discovery.serve_connections({'Foreground': {'id': config()}}, 8766) == result


@pytest.mark.parametrize('proxy', ['http://127.0.0.1:8000', 'http://192.168.1.4:8766', 'https://127.0.0.1:8766',
    'http://name:8766', 'http://user:pass@127.0.0.1:8766', 'http://127.0.0.1:8766/private', 'http://127.0.0.1:8766/?key=secret'])
def test_rejects_other_services_and_unexpected_proxy_targets(proxy):
    assert discovery.serve_connections(config(proxy=proxy), 8766) == []


def test_rejects_funnel_non_https_and_untrusted_origins():
    value = config()
    value['AllowFunnel'] = {'desktop.example.ts.net:443': True}
    assert discovery.serve_connections(value, 8766) == []
    assert discovery.serve_connections({'AllowFunnel': value['AllowFunnel'], 'Foreground': {'id': config()}}, 8766) == []
    value = config()
    value['TCP']['443'] = {'HTTP': True}
    assert discovery.serve_connections(value, 8766) == []
    assert discovery.serve_connections(config(host='public.example.com:443'), 8766) == []
    assert discovery.serve_connections(None, 8766) == []
    assert discovery.serve_connections({'Web': []}, 8766) == []


def test_lookup_is_bounded_read_only_and_does_not_return_raw_status(monkeypatch):
    calls = []
    monkeypatch.setattr(discovery.shutil, 'which', lambda _: '/fixture/tailscale')
    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(returncode=0, stdout=json.dumps(config()).encode())
    monkeypatch.setattr(discovery.subprocess, 'run', run)
    assert len(discovery.discover_connection()['connections']) == 1
    assert calls[0][0] == ['/fixture/tailscale', 'serve', 'status', '--json']
    assert calls[0][1]['timeout'] == 6
    monkeypatch.setattr(discovery.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stdout=b'private error'))
    with pytest.raises(ValueError, match='Could not read'):
        discovery.discover_connection()
    monkeypatch.setattr(discovery.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout=b'{}'))
    with pytest.raises(ValueError, match='No private HTTPS'):
        discovery.discover_connection()


def mock_status(monkeypatch, status=None, serve=None):
    monkeypatch.setattr(discovery, 'tailscale_executable', lambda: '/fixture/tailscale')
    calls = []
    def run(args, **kwargs):
        calls.append((args, kwargs))
        value = status if args[1] == 'status' else serve or {}
        return SimpleNamespace(returncode=0, stdout=json.dumps(value).encode())
    monkeypatch.setattr(discovery.subprocess, 'run', run)
    return calls


def online(host='desktop.example.ts.net.'):
    return {'BackendState': 'Running', 'Self': {'Online': True, 'DNSName': host},
            'Peer': {'private': 'not returned'}, 'AuthURL': 'private-login', 'User': {'private': 'not returned'}}


def test_watches_current_device_without_claiming_unconfigured_https_is_ready(monkeypatch):
    calls = mock_status(monkeypatch, online())
    result = discovery.tailscale_status()
    assert result['state'] == 'connected'
    assert result['suggested_origin'] == 'https://desktop.example.ts.net'
    assert result['serve_ready'] is False and result['connections'] == []
    assert 'still needs setup' in result['message']
    assert calls[0][0] == ['/fixture/tailscale', 'status', '--json', '--peers=false']
    assert calls[1][0] == ['/fixture/tailscale', 'serve', 'status', '--json']
    assert all(call[1]['timeout'] == 6 for call in calls)
    assert set(result) == {'state', 'message', 'connections', 'suggested_origin', 'serve_ready'}
    mock_status(monkeypatch, online('renamed.example.ts.net.'))
    assert discovery.tailscale_status()['suggested_origin'] == 'https://renamed.example.ts.net'


@pytest.mark.parametrize('state', ['NeedsLogin', 'NeedsMachineAuth', 'Stopped', 'Starting'])
def test_disconnection_never_reuses_a_saved_address(monkeypatch, state):
    calls = mock_status(monkeypatch, {**online(), 'BackendState': state}, config())
    result = discovery.tailscale_status()
    assert result['state'] == ('login_required' if state.startswith('Needs') else 'disconnected')
    assert not result['suggested_origin'] and not result['connections']
    assert len(calls) == 1


@pytest.mark.parametrize('host', ['', 'public.example.com', 'user@desktop.example.ts.net', 'desktop.example.ts.net/path',
                                 '-desktop.example.ts.net', 'desktop..example.ts.net', None])
def test_invalid_device_names_never_become_https_origins(monkeypatch, host):
    mock_status(monkeypatch, online(host))
    result = discovery.tailscale_status()
    assert not result['suggested_origin'] and not result['connections']


def test_current_private_serve_route_and_alternate_https_port(monkeypatch):
    value = {'TCP': {'8443': {'HTTPS': True}}, 'Web': {'desktop.example.ts.net:8443': {'Handlers': {'/': {'Proxy': 'http://127.0.0.1:9000'}}}}}
    mock_status(monkeypatch, online(), value)
    result = discovery.tailscale_status(9000)
    assert result['serve_ready'] is True
    assert result['connections'][0]['origin'] == 'https://desktop.example.ts.net:8443'
    assert result['connections'][0]['port'] == 9000
    assert not result['suggested_origin']


@pytest.mark.parametrize('value', [config(proxy='http://127.0.0.1:8000'), config(host='old.example.ts.net:443'),
    {**config(), 'AllowFunnel': {'desktop.example.ts.net:443': True}},
    {'AllowFunnel': {'desktop.example.ts.net:443': True}, 'Foreground': {'id': config()}},
    {**config(), 'Foreground': {'id': {'AllowFunnel': {'DESKTOP.example.ts.net': True}}}},
    {'Foreground': {'id': config(proxy='http://127.0.0.1:8000')}}])
def test_no_fallback_to_public_conflicting_or_old_serve_origin(monkeypatch, value):
    mock_status(monkeypatch, online(), value)
    result = discovery.tailscale_status()
    assert not result['connections'] and not result['suggested_origin']
    assert not result['serve_ready']


def test_missing_offline_and_failed_status_are_safe_and_retryable(monkeypatch):
    monkeypatch.setattr(discovery, 'tailscale_executable', lambda: None)
    assert discovery.tailscale_status()['state'] == 'missing'
    mock_status(monkeypatch, {**online(), 'Self': {'Online': False, 'DNSName': 'desktop.example.ts.net'}})
    assert discovery.tailscale_status()['state'] == 'disconnected'
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('tailscale', 6)
    monkeypatch.setattr(discovery.subprocess, 'run', timeout)
    assert discovery.tailscale_status()['state'] == 'unavailable'
    for output in (b'private invalid output', b'[]', b'{' + b' ' * 262144):
        monkeypatch.setattr(discovery.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=0, stdout=output))
        assert discovery.tailscale_status()['state'] == 'unavailable'


def test_status_route_is_desktop_authenticated_bounded_and_does_not_initialize_gateway(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from mobile_companion import routes
    from services.session_guard import SessionGuard
    monkeypatch.setattr(routes, '_instance', None)
    calls = mock_status(monkeypatch, online())
    app = FastAPI()
    app.include_router(routes.router)
    app.add_middleware(SessionGuard)
    with TestClient(app, base_url='http://127.0.0.1:8000') as client:
        assert client.get('/mobile/tailscale-status').status_code == 403
        assert not calls
        headers = {'X-LAW-Session': 'test-session-token'}
        for port in ('0', '65536', 'not-a-port'):
            assert client.get('/mobile/tailscale-status?port=' + port, headers=headers).status_code == 422
        response = client.get('/mobile/tailscale-status?port=9000', headers=headers)
        assert response.status_code == 200 and response.headers['cache-control'] == 'no-store'
        assert '9000' in response.json()['message']
        assert routes._instance is None
