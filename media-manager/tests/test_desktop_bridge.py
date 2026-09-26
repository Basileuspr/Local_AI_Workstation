"""Parent-pipe lifecycle uses only temporary report folders and simulated work."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from media_organizer.ui_server import make_server, serve_desktop


class DesktopBridgeTests(unittest.TestCase):
    def test_ready_and_parent_eof_exit(self):
        with tempfile.TemporaryDirectory() as reports:
            process = subprocess.Popen([sys.executable, '-m', 'media_organizer.ui_server', '--desktop-bridge', '--reports', reports],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                       cwd=Path(__file__).resolve().parents[1])
            try:
                ready = json.loads(process.stdout.readline())
                self.assertEqual(ready['mediaManagerReady'], 1)
                self.assertRegex(ready['url'], r'^http://127\.0\.0\.1:\d+$')
                self.assertNotIn('token', ready)
                process.communicate('', timeout=10)
                self.assertEqual(process.returncode, 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()

    def test_parent_exit_waits_for_active_operation(self):
        with tempfile.TemporaryDirectory() as reports:
            server = make_server(reports=reports)
            server.state.job['status'] = 'running'
            with patch('sys.stdin', io.StringIO('')), patch('sys.stdout', io.StringIO()):
                worker = threading.Thread(target=serve_desktop, args=(server,))
                worker.start()
                deadline = time.monotonic() + 3
                while not server.state.closing and time.monotonic() < deadline:
                    time.sleep(.01)
                try:
                    self.assertTrue(server.state.closing)
                    with self.assertRaisesRegex(ValueError, 'closing'):
                        server.state.start('scan', {})
                    time.sleep(.6)
                    self.assertTrue(worker.is_alive(), 'Must not interrupt a file operation')
                finally:
                    with server.state.lock:
                        server.state.job['status'] = 'complete'
                    worker.join(3)
                self.assertFalse(worker.is_alive())
