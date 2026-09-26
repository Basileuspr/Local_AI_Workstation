"""HTTP adapter checks on disposable media, never on the user's archive."""
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from media_organizer import mover, scan
from media_organizer.ui_server import make_server
from tests.mp4build import build


class UIServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="organizer_ui_")
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / "source"
        cls.source.mkdir()
        cls.content = build(None, 1280, 720, mdat_size=100)
        cls.scan_events = []
        (cls.source / "VID_20200615_120000.mp4").write_bytes(cls.content)
        cls.run_path, _ = scan.run_scan(scan.ScanOptions(str(cls.source), str(cls.root / "archive"),
                                                        str(cls.root / "runs"), ffprobe="missing-test-tool",
                                                        allow_missing_tools=True, use_exiftool=False, quiet=True), out=lambda *_: None,
                                        on_progress=lambda **event: cls.scan_events.append(event))
        cls.run_id = Path(cls.run_path).name
        cls.server = make_server(reports=str(cls.root / "runs"))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def test_saved_rotation_does_not_rewrite_media_or_manifest(self):
        state = self.server.state
        data = state.library(self.run_id)
        row = data['records'][0]
        source = Path(row['OriginalPath'])
        before = source.read_bytes()
        plan = Path(self.run_path) / 'manifest.json'
        manifest_before = plan.read_bytes()
        status, _, _ = self.request('/api/rotate', dict(runId=self.run_id, recordId=row['RecordId'], direction=1), token=False)
        self.assertEqual(status, 403)
        for value in (True, 0, 2, 'right'):
            status, _, _ = self.request('/api/rotate', dict(runId=self.run_id, recordId=row['RecordId'], direction=value))
            self.assertEqual(status, 400)
        status, raw, _ = self.request('/api/rotate', dict(runId=self.run_id, recordId=row['RecordId'], direction=1))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)['rotation'], 90)
        from media_organizer.ui_server import UIState
        reopened = UIState(str(state.reports))
        self.assertEqual(reopened.library(self.run_id)['records'][0]['ViewRotation'], 90)
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(plan.read_bytes(), manifest_before)
        self.assertEqual(state.rotate(self.run_id, row['RecordId'], -1)['rotation'], 0)

    def request(self, path, body=None, token=True, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        request_headers = {"X-Organizer-Token": self.server.state.token} if token else {}
        request_headers.update(headers or {})
        connection.request("GET" if body is None else "POST", path, json.dumps(body) if body is not None else None, request_headers)
        response = connection.getresponse()
        raw = response.read()
        result = response.status, raw, dict(response.getheaders())
        connection.close()
        return result

    def test_static_and_session(self):
        code, raw, headers = self.request("/", token=False)
        self.assertEqual(code, 200)
        self.assertIn(self.server.state.token.encode(), raw)
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])

    def test_scan_reports_real_progress_in_quiet_mode(self):
        phases = [event['phase'] for event in self.scan_events]
        self.assertEqual(phases[0], 'preparing')
        self.assertIn('discovering', phases)
        analyzed = [event for event in self.scan_events if event['phase'] == 'analyzing']
        self.assertEqual(analyzed[-1]['completed'], 1)
        self.assertEqual(analyzed[-1]['total'], 1)
        self.assertEqual(phases[-1], 'finalizing')

    def test_auth_and_origin(self):
        self.assertEqual(self.request("/api/state", token=False)[0], 403)
        self.assertEqual(self.request("/api/state", headers={"Origin": "https://example.com"})[0], 403)
        self.assertEqual(self.request("/api/state", headers={"Host": "example.com"})[0], 403)
        self.assertEqual(self.request("/", headers={"Sec-Fetch-Site": "cross-site"})[0], 403)

    def test_library_and_unknown_run(self):
        code, raw, _ = self.request(f"/api/library?runId={self.run_id}")
        self.assertEqual(code, 200)
        self.assertTrue(json.loads(raw)["records"][0]["Available"])
        self.assertEqual(self.request("/api/library?runId=../source")[0], 400)
        self.assertEqual(self.request("/../README.md")[0], 404)

    def test_range_playback(self):
        record = self.server.state.library(self.run_id)["records"][0]
        url = f"/api/media?runId={self.run_id}&recordId={record['RecordId']}"
        code, raw, headers = self.request(url, headers={"Range": "bytes=3-10"})
        self.assertEqual(code, 206)
        self.assertEqual(raw, self.content[3:11])
        self.assertEqual(headers["Content-Range"], f"bytes 3-10/{len(self.content)}")
        self.assertEqual(self.request(url, headers={"Range": "bytes=-7"})[1], self.content[-7:])
        self.assertEqual(self.request(url, headers={"Range": "bytes=99999999-"})[0], 416)
        self.assertEqual(self.request(url + "&token=" + self.server.state.token, token=False)[0], 200)

    def test_thumbnail_route_requires_session_and_known_media(self):
        record = self.server.state.library(self.run_id)['records'][0]
        url = f"/api/thumbnail?runId={self.run_id}&recordId={record['RecordId']}"
        with patch.object(self.server.state.thumbnails, 'get', return_value=b'\xff\xd8test') as decoder:
            self.assertEqual(self.request(url, token=False)[0], 403)
            self.assertEqual(self.request(f'/api/thumbnail?runId={self.run_id}&recordId=missing')[0], 400)
            decoder.assert_not_called()
            code, raw, headers = self.request(url)
            self.assertEqual(code, 200)
            self.assertEqual(headers['Content-Type'], 'image/jpeg')
            self.assertEqual(raw, b'\xff\xd8test')

    def test_reject_unconfirmed_move_and_bad_scan(self):
        self.assertEqual(self.request("/api/move", {"runId": self.run_id})[0], 400)
        self.assertEqual(self.request("/api/scan", {"source": "", "destination": ""})[0], 400)
        self.assertEqual(self.request("/api/scan", {"source": str(self.source), "destination": str(self.source / "inside")})[0], 400)
        self.assertEqual(self.request("/api/scan", {"source": str(self.source), "destination": str(self.root)})[0], 400)

    def test_native_actions_are_explicit_and_use_actual_paths(self):
        with patch("media_organizer.ui_server.choose_folder", return_value="") as picker:
            self.assertEqual(json.loads(self.request("/api/pick-folder", {"kind": "source"})[1]), {"path": ""})
            picker.assert_called_once_with("Choose source folder")
        with patch("media_organizer.ui_server.os.startfile", create=True) as opener:
            self.assertEqual(self.request("/api/open-folder", {"path": str(self.source)})[0], 200)
            opener.assert_called_once_with(str(self.source.resolve()))
            self.assertEqual(self.request("/api/open-folder", {"path": str(self.root / "not-created")})[0], 400)
        row = self.server.state.library(self.run_id)["records"][0]
        with patch("media_organizer.ui_server.subprocess.Popen") as explorer:
            self.assertEqual(self.request("/api/open-folder", {"runId": self.run_id, "recordId": row["RecordId"]})[0], 200)
            explorer.assert_called_once_with(["explorer.exe", "/select,", str(Path(row["CurrentPath"]).resolve())])

    def test_z_move_tracks_collision_and_undo(self):
        row = self.server.state.library(self.run_id)["records"][0]
        planned = Path(row["ProposedDestination"])
        planned.parent.mkdir(parents=True)
        planned.write_bytes(b"existing file that must survive")
        self.assertEqual(self.request("/api/move", {"runId": self.run_id, "confirmation": "MOVE"})[0], 202)
        for _ in range(200):
            if self.server.state.job["status"] != "running":
                break
            time.sleep(.02)
        self.assertEqual(self.server.state.job["status"], "complete")
        progress = json.loads(self.request('/api/state')[1])['job']['progress']
        self.assertEqual(progress['percent'], 100)
        self.assertEqual(progress['completed'], 1)
        self.assertEqual(progress['total'], 1)
        row = self.server.state.library(self.run_id)["records"][0]
        self.assertTrue(row["Moved"])
        self.assertNotEqual(row["CurrentPath"], str(planned))
        self.assertEqual(Path(row["CurrentPath"]).read_bytes(), self.content)
        self.assertEqual(planned.read_bytes(), b"existing file that must survive")
        move_dir = next((Path(self.run_path) / "moves").iterdir())
        mover.run_undo(str(move_dir), execute=True, yes=True, quiet=True, out=lambda *_: None)
        restored = self.server.state.library(self.run_id)["records"][0]
        self.assertFalse(restored["Moved"])
        self.assertEqual(restored["CurrentPath"], row["OriginalPath"])
        self.assertTrue(restored["Available"])


if __name__ == "__main__":
    unittest.main()
