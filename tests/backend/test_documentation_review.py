"""Documentation moves must not rewrite historical observations or expose private links."""
import importlib.util
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("documentation_capture", ROOT / "scripts/capture-app-review.py")
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def test_shared_document_moves_resolve_to_existing_public_guides():
    moves = capture.document_moves()
    assert capture.included("docs/development/document-moves.json")
    for old, target in moves.items():
        if target is not None:
            assert (ROOT / target.split("#")[0]).is_file(), (old, target)
            assert not any(word in target.upper() for word in ("HANDOFF", "ARCHITECTURE_CURRENT"))
    assert capture.source_markdown("HANDOFF.md", moves) == "`HANDOFF.md` (private historical record)"
    assert "../../docs/chat/CHAT_GUIDE.md#second-chat" in capture.source_markdown("DUAL_CHAT.md", moves)


def test_render_preserves_snapshot_and_routes_both_public_outputs(tmp_path, monkeypatch):
    source = tmp_path / "source"
    output = tmp_path / "output"
    source.mkdir()
    (output / "snapshots").mkdir(parents=True)
    review = json.loads((capture.DOCS / "review.json").read_text(encoding="utf-8"))
    review["findings"][0]["files"] = ["DUAL_CHAT.md", "HANDOFF.md"]
    (source / "review.json").write_text(json.dumps(review), encoding="utf-8")
    (source / "reader-template.html").write_text((capture.DOCS / "reader-template.html").read_text(encoding="utf-8"), encoding="utf-8")
    snapshot = {"id": "test", "label": "Historical </script> source", "captured_at": "2026-10-01T00:00:00+00:00",
                "timezone": "UTC", "app_version": "old", "git": {"branch": "main", "head": "a" * 40},
                "files": {"DUAL_CHAT.md": {"comparison_sha256": "unchanged"}}, "committed_baseline": {"files": {}},
                "commits": [{"hash": "b" * 40, "committed_at": "2026-10-01", "author_at": "2026-09-30",
                             "subject": "Record | old paths", "paths": [f"old/{i}.py" for i in range(500)]}]}
    record = output / "snapshots/test.json"
    original = json.dumps(snapshot).encode()
    record.write_bytes(original)
    monkeypatch.setattr(capture, "DOCS", source)
    capture.render(output)
    assert record.read_bytes() == original
    audit = (output / "AUDIT.md").read_text(encoding="utf-8")
    assert "[DUAL_CHAT.md](../../docs/chat/CHAT_GUIDE.md#second-chat)" in audit
    assert "[HANDOFF.md]" not in audit
    html = (output / "index.html").read_text(encoding="utf-8")
    assert "__DOCUMENT_MOVES__" not in html
    assert '"HANDOFF.md": null' in html
    payload = re.search(r'<script id="review-data" type="application/json">(.*?)</script>', html, re.S).group(1)
    assert "</script>" not in payload
    assert json.loads(payload)["snapshots"] == [snapshot]
    history = (output / "HISTORY.md").read_text(encoding="utf-8")
    assert "old/499.py" not in history
    assert "Record &#124; old paths" in history
