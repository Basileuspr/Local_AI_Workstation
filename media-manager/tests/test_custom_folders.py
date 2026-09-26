import os
from pathlib import Path
import tempfile
import time
import unittest

from media_organizer import custom_folders, mover, scan
from media_organizer.ui_server import UIState
from tests.mp4build import build


class CustomFolderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='organizer_custom_')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        source = self.root / 'source'
        self.originals = {}
        for index, name in enumerate(('A', 'B')):
            directory = source / name
            directory.mkdir(parents=True)
            path = directory / 'VID_20200615_120000.mp4'
            content = build(None, 1280, 720, mdat_size=100 + index)
            path.write_bytes(content)
            self.originals[str(path)] = content
        reports = self.root / 'runs'
        path, _ = scan.run_scan(scan.ScanOptions(str(source), str(self.root / 'archive'), str(reports),
                                                ffprobe='missing-test-tool', allow_missing_tools=True,
                                                use_exiftool=False, quiet=True), out=lambda *_: None)
        self.state = UIState(str(reports))
        self.run_id = Path(path).name
        self.folder = custom_folders.add_folder(reports, str(self.root / 'Favorites'), 'Favorites')
        self.records = self.state.library(self.run_id)['records']

    def preview(self, ids=None, folder=None):
        return custom_folders.prepare(self.state, self.run_id, (folder or self.folder)['id'],
                                      ids or [self.records[0]['RecordId']])

    def execute(self, preview):
        self.state.start('custom-move', dict(runId=self.run_id, planId=preview['planId'], confirmation='MOVE'))
        for _ in range(300):
            if self.state.job['status'] != 'running':
                return self.state.job
            time.sleep(.01)
        self.fail('Custom move did not finish')

    def test_preview_is_read_only_and_confirmation_is_required(self):
        plan = self.preview()
        self.assertEqual(len(plan['files']), 1)
        self.assertFalse(Path(plan['files'][0]['destination']).exists())
        for path, content in self.originals.items():
            self.assertEqual(Path(path).read_bytes(), content)
        with self.assertRaisesRegex(ValueError, 'Type MOVE'):
            self.state.start('custom-move', dict(runId=self.run_id, planId=plan['planId']))
        with self.assertRaises(ValueError):
            self.preview(['unknown-id'])

    def test_only_selection_moves_and_catalog_and_locations_survive_restart(self):
        plan = self.preview()
        self.assertEqual(self.execute(plan)['status'], 'complete')
        fresh = UIState(str(self.state.reports))
        records = fresh.library(self.run_id)['records']
        moved, untouched = records
        self.assertEqual(moved['CustomFolderId'], self.folder['id'])
        self.assertEqual(fresh.media_path(self.run_id, moved['RecordId']).read_bytes(), self.originals[moved['OriginalPath']])
        self.assertEqual(untouched['CurrentPath'], untouched['OriginalPath'])
        self.assertEqual(Path(untouched['OriginalPath']).read_bytes(), self.originals[untouched['OriginalPath']])
        self.assertEqual(custom_folders.folders(fresh.reports), [self.folder])
        with self.assertRaisesRegex(ValueError, 'already been used'):
            self.execute(plan)

    def test_same_names_and_new_collision_do_not_overwrite(self):
        plan = self.preview([row['RecordId'] for row in self.records])
        self.assertNotEqual(plan['files'][0]['destination'], plan['files'][1]['destination'])
        collision = Path(plan['files'][0]['destination'])
        collision.write_bytes(b'existing file')
        self.assertEqual(self.execute(plan)['status'], 'complete')
        self.assertEqual(collision.read_bytes(), b'existing file')
        rows = self.state.library(self.run_id)['records']
        self.assertNotEqual(rows[0]['CurrentPath'], str(collision))
        for row in rows:
            self.assertEqual(Path(row['CurrentPath']).read_bytes(), self.originals[row['OriginalPath']])

    def test_moves_from_archive_between_custom_folders_and_undo_restores_each_location(self):
        mover.run_move(mover.MoveOptions(str(self.state.run_path(self.run_id)), execute=True, yes=True, quiet=True), out=lambda *_: None)
        archived = self.state.library(self.run_id)['records'][0]['CurrentPath']
        self.execute(self.preview())
        first = self.state.library(self.run_id)['records'][0]['CurrentPath']
        other = custom_folders.add_folder(self.state.reports, str(self.root / 'Travel'), 'Travel')
        self.execute(self.preview(folder=other))
        self.assertEqual(self.state.library(self.run_id)['records'][0]['CustomFolderId'], other['id'])
        logs = sorted(self.state.run_path(self.run_id).glob('moves/*custom*/operations.jsonl'), key=lambda p: p.stat().st_mtime_ns)
        mover.run_undo(str(logs[-1]), execute=True, yes=True, quiet=True, out=lambda *_: None)
        self.assertEqual(self.state.library(self.run_id)['records'][0]['CurrentPath'], first)
        mover.run_undo(str(logs[0]), execute=True, yes=True, quiet=True, out=lambda *_: None)
        row = self.state.library(self.run_id)['records'][0]
        self.assertEqual(row['CurrentPath'], archived)
        self.assertEqual(row['CustomFolderId'], '')

    def test_same_size_changed_content_is_rejected_by_hash_check(self):
        plan = self.preview()
        path = Path(plan['files'][0]['source'])
        stat = path.stat()
        changed = bytearray(path.read_bytes()); changed[-1] ^= 1
        path.write_bytes(changed)
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        job = self.execute(plan)
        self.assertEqual(job['status'], 'error')
        self.assertEqual(path.read_bytes(), changed)
        self.assertFalse(Path(plan['files'][0]['destination']).exists())

    def test_file_changed_since_preview_is_skipped(self):
        plan = self.preview()
        path = Path(plan['files'][0]['source'])
        path.write_bytes(b'changed')
        job = self.execute(plan)
        self.assertIn('1 skipped', job['message'])
        self.assertEqual(path.read_bytes(), b'changed')
        self.assertFalse(Path(plan['files'][0]['destination']).exists())

    def test_nested_custom_folder_and_noop_are_handled(self):
        nested = custom_folders.add_folder(self.state.reports, str(self.root / 'source' / 'Selected'), 'Selected')
        self.execute(self.preview(folder=nested))
        with self.assertRaisesRegex(ValueError, 'Already in this folder'):
            self.preview(folder=nested)
        self.assertEqual(custom_folders.add_folder(self.state.reports, nested['path'], 'Same location')['id'], nested['id'])


if __name__ == '__main__':
    unittest.main()
