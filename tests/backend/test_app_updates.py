import asyncio
import json

import httpx
import pytest

from services import app_updates


def check(tmp_path, monkeypatch, response, *, env=None):
    (tmp_path / 'package.json').write_text(json.dumps({'version': '1.0.1-dev'}))
    if env is None:
        monkeypatch.delenv('LAW_UPDATE_MANIFEST_URL', raising=False)
    else:
        monkeypatch.setenv('LAW_UPDATE_MANIFEST_URL', env)
    requests = []

    def serve(request):
        requests.append(str(request.url))
        return response(request)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(serve)) as client:
            return await app_updates.check_updates(tmp_path, client=client)

    return asyncio.run(run()), requests


@pytest.mark.parametrize('version,status', [
    ('1.0.1-dev', 'up_to_date'), ('1.0.1', 'update_available'),
    ('1.0.2-dev', 'update_available'), ('1.0.0', 'up_to_date'),
])
def test_builtin_feed_without_machine_configuration(tmp_path, monkeypatch, version, status):
    result, requests = check(tmp_path, monkeypatch, lambda _: httpx.Response(
        200, json={'name': 'local_ai_workstation', 'version': version}))
    assert requests == [app_updates.DEFAULT_UPDATE_MANIFEST_URL]
    assert result['source'] == requests[0]
    assert result['latest_version'] == version
    assert result['status'] == status
    assert result['automatic_update'] is False


def test_operator_override_uses_generic_version_manifest(tmp_path, monkeypatch):
    url = 'https://updates.example/release.json'
    result, requests = check(tmp_path, monkeypatch,
        lambda _: httpx.Response(200, json={'version': '2.0.0'}), env=url)
    assert requests == [url]
    assert result['status'] == 'update_available'


@pytest.mark.parametrize('setting', ['', '   ', 'http://updates.example/release.json',
    'https://user:password@updates.example/release.json', 'https://updates.example/release.json#fragment'])
def test_disabled_or_unsafe_settings_make_no_request(tmp_path, monkeypatch, setting):
    result, requests = check(tmp_path, monkeypatch,
        lambda _: pytest.fail('No request should be made'), env=setting)
    assert requests == []
    assert result['status'] == 'unable_to_check'
    assert result['latest_version'] is None


@pytest.mark.parametrize('manifest', [
    {'name': 'different_app', 'version': '9.0.0'}, {'version': '9.0.0'},
    {'name': 'local_ai_workstation', 'version': 'bad version'},
    {'name': 'local_ai_workstation', 'version': True}, [], None,
])
def test_invalid_project_feed_never_claims_up_to_date(tmp_path, monkeypatch, manifest):
    result, _ = check(tmp_path, monkeypatch, lambda _: httpx.Response(200, json=manifest))
    assert result['status'] == 'unable_to_check'
    assert result['latest_version'] is None


@pytest.mark.parametrize('status', [302, 404, 500])
def test_http_failures_and_redirects_do_not_claim_success(tmp_path, monkeypatch, status):
    result, requests = check(tmp_path, monkeypatch,
        lambda _: httpx.Response(status, headers={'Location': 'https://other.example/manifest'}))
    assert requests == [app_updates.DEFAULT_UPDATE_MANIFEST_URL]
    assert result['status'] == 'unable_to_check'


def test_offline_project_feed(tmp_path, monkeypatch):
    def offline(request):
        raise httpx.ConnectError('offline', request=request)
    result, _ = check(tmp_path, monkeypatch, offline)
    assert result['status'] == 'unable_to_check'


def test_oversized_feed(tmp_path, monkeypatch):
    result, _ = check(tmp_path, monkeypatch, lambda _: httpx.Response(200, content=b' ' * 65537))
    assert result['status'] == 'unable_to_check'
