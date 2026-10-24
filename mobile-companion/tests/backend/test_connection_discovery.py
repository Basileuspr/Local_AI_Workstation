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
