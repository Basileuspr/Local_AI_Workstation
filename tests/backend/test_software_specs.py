import io
import json
import zipfile
from types import SimpleNamespace

from services import software_specs


def test_software_inventory_reports_actual_versions_and_groups_files(tmp_path, monkeypatch):
    (tmp_path / "src" / "components").mkdir(parents=True)
    (tmp_path / "src" / "components" / "Example.jsx").write_text("secret source text")
    (tmp_path / "backend" / "routes").mkdir(parents=True)
    (tmp_path / "backend" / "routes" / "example.py").write_text("secret source text")
    (tmp_path / "electron").mkdir()
    (tmp_path / "node_modules" / "react").mkdir(parents=True)
    (tmp_path / "node_modules" / "react" / "package.json").write_text('{"version":"19.2.8"}')
    (tmp_path / "package.json").write_text('{"name":"fixture","version":"1","dependencies":{"react":"^19"}}')
    monkeypatch.setattr(software_specs.importlib.metadata, "distributions", lambda: [SimpleNamespace(metadata={"Name": "Pillow"}, version="12.0")])
    def endpoint(): pass
    routes = [SimpleNamespace(path="/fixture", methods={"GET"}, name="fixture", endpoint=endpoint)]
    result = software_specs.snapshot(routes, tmp_path)
    assert result['dependencies']['javascript'][0]['installed'] == '19.2.8'
    assert result['frontend']['folders'][0]['folder'] == 'components'
    assert result['tool_calls']['operations'][0]['path'] == '/fixture'
    assert 'secret source text' not in json.dumps(result)


def test_log_export_is_bounded_allowlisted_and_redacts_credentials(tmp_path, monkeypatch):
    monkeypatch.setenv('LAW_SESSION_TOKEN', 'private-session-value')
    (tmp_path / 'backend.log').write_text('request ?law_token=abc&x=1\nAuthorization: Bearer secret123\nprivate-session-value\napiToken="hidden"\nregular error\n')
    (tmp_path / 'electron.log.1').write_text('startup record')
    (tmp_path / 'backend.log.2').write_bytes(b'x' * 2_100_000 + b'\nlast line\n')
    (tmp_path / 'private-data.json').write_text('do not export')
    archive = software_specs.log_archive(tmp_path)
    with archive, zipfile.ZipFile(archive) as zipped:
        text = zipped.read('backend.log').decode()
        for secret in ['abc', 'secret123', 'private-session-value', 'hidden']:
            assert secret not in text
        assert 'regular error' in text and 'REDACTED' in text
        assert 'private-data.json' not in zipped.namelist()
        assert zipped.read('backend.log.2') == b'last line\n'
        assert any(item.get('tail_only') for item in json.loads(zipped.read('manifest.json'))['files'])
