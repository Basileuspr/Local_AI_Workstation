import os
from pathlib import Path
import unittest
from unittest.mock import patch
from media_organizer import media_actions, scanner
from tests import test_custom_folders


class MediaActionTests(unittest.TestCase):
    setUp = test_custom_folders.CustomFolderTests.setUp

    def payload(self, row=None, **extra):
        row = row or self.state.library(self.run_id)['records'][0]
        return dict(runId=self.run_id, recordId=row['RecordId'], expectedPath=row['CurrentPath'], **extra)

    def perform(self, **extra):
        return media_actions.execute(self.state, self.payload(**extra), lambda **_: None)

    def test_rename_trash_restore_preserves_bytes_and_detects_collisions(self):
        original = self.state.library(self.run_id)['records'][0]
        content = Path(original['CurrentPath']).read_bytes()
        self.perform(action='rename', name='Renamed clip')
        row = self.state.library(self.run_id)['records'][0]
        self.assertEqual(row['OriginalFilename'], 'Renamed clip.mp4')
        self.assertEqual(Path(row['CurrentPath']).read_bytes(), content)
        with self.assertRaisesRegex(ValueError, 'location changed'):
            media_actions.execute(self.state, self.payload(original, action='rename', name='stale'), lambda **_: None)
        self.perform(action='delete', confirmation='DELETE')
        trashed = self.state.library(self.run_id)['records'][0]
        self.assertTrue(trashed['Trashed'])
        self.assertEqual(Path(trashed['CurrentPath']).read_bytes(), content)
        self.assertEqual(len(scanner.walk(str(self.root/'source')).candidates), 1)
        Path(trashed['RestorePath']).write_bytes(b'new occupant')
        with self.assertRaisesRegex(ValueError, 'already exists'): self.perform(action='restore')
        self.assertEqual(Path(trashed['RestorePath']).read_bytes(), b'new occupant')
        Path(trashed['RestorePath']).unlink()
        self.perform(action='restore')
        restored = self.state.library(self.run_id)['records'][0]
        self.assertFalse(restored['Trashed']); self.assertEqual(Path(restored['CurrentPath']).read_bytes(), content)

    def test_changed_content_is_not_renamed_or_deleted(self):
        row = self.state.library(self.run_id)['records'][0]
        path = Path(row['CurrentPath']); stamp = path.stat()
        data = bytearray(path.read_bytes()); data[-1] ^= 1; path.write_bytes(data)
        os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        with self.assertRaisesRegex(ValueError, 'SHA-256'): self.perform(action='delete', confirmation='DELETE')
        self.assertTrue(path.exists())

    def test_names_and_confirmation_are_validated(self):
        for name in ('../escape', 'CON', 'bad|name', 'trailing.', ''):
            with self.assertRaises(ValueError): self.perform(action='rename', name=name)
        with self.assertRaisesRegex(ValueError, 'DELETE'): self.perform(action='delete')
        self.assertTrue(Path(self.records[0]['CurrentPath']).exists())

    def test_tags_follow_hash_and_do_not_change_source(self):
        result = media_actions.tag_action(self.state, dict(action='create', name='Travel'))
        tag = result['tags'][0]
        self.assertEqual(len(media_actions.tag_action(self.state, dict(action='create', name='travel'))['tags']), 1)
        media_actions.tag_action(self.state, dict(action='assign',runId=self.run_id, recordIds=[self.records[0]['RecordId']],tagId=tag['id']))
        self.perform(action='rename',name='Tagged')
        row = self.state.library(self.run_id)['records'][0]
        self.assertEqual(row['Tags'], ['Travel'])
        self.assertEqual(Path(row['CurrentPath']).read_bytes(), self.originals[row['OriginalPath']])
        media_actions.tag_action(self.state, dict(action='remove',runId=self.run_id,recordIds=[row['RecordId']],tagId=tag['id']))
        self.assertEqual(self.state.library(self.run_id)['records'][0]['TagIds'], [])

    def test_bulk_delete_restore_and_permanent_delete_preserve_unselected(self):
        rows = self.state.library(self.run_id)['records']
        items = [dict(recordId=row['RecordId'], expectedPath=row['CurrentPath']) for row in rows]
        payload = dict(runId=self.run_id, items=items, action='delete', confirmation=f'DELETE {len(items)}')
        with self.assertRaises(ValueError): media_actions.validate_batch(self.state, dict(payload, confirmation='DELETE'))
        media_actions.execute_batch(self.state, payload, lambda **_: None)
        deleted = self.state.library(self.run_id)['records']; self.assertTrue(all(row['Trashed'] for row in deleted))
        first = deleted[0]; content = Path(first['CurrentPath']).read_bytes()
        media_actions.execute(self.state, self.payload(first, action='restore'), lambda **_: None)
        restored = self.state.library(self.run_id)['records'][0]
        self.assertEqual(Path(restored['CurrentPath']).read_bytes(), content)
        extra = next(row for row in self.state.library(self.run_id)['records'] if row['Trashed'])
        with self.assertRaisesRegex(ValueError, 'FOREVER'):
            media_actions.execute(self.state, self.payload(extra, action='purge', confirmation='DELETE'), lambda **_: None)
        media_actions.execute(self.state, self.payload(extra, action='purge', confirmation='DELETE FOREVER'), lambda **_: None)
        self.assertFalse(Path(extra['CurrentPath']).exists())
        self.assertEqual(Path(restored['CurrentPath']).read_bytes(), content)
        self.assertTrue(next(row for row in self.state.library(self.run_id)['records'] if row['RecordId'] == extra['RecordId'])['PermanentlyDeleted'])

    def test_bulk_hash_preflight_rejects_entire_changed_selection(self):
        rows = self.state.library(self.run_id)['records']
        path = Path(rows[-1]['CurrentPath']); stamp = path.stat(); data = bytearray(path.read_bytes()); data[-1] ^= 1
        path.write_bytes(data); os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        payload = dict(runId=self.run_id, items=[dict(recordId=row['RecordId'], expectedPath=row['CurrentPath']) for row in rows], action='delete', confirmation=f'DELETE {len(rows)}')
        with self.assertRaisesRegex(ValueError, 'SHA-256'): media_actions.execute_batch(self.state, payload, lambda **_: None)
        self.assertTrue(all(Path(row['CurrentPath']).exists() for row in rows))

    def test_windows_preview_lock_retries_with_hash_checks_then_preserves_other_copy(self):
        row = self.state.library(self.run_id)['records'][0]; content = Path(row['CurrentPath']).read_bytes()
        original_move = media_actions.mover.safe_move
        locked = PermissionError('Preview reader is active'); locked.winerror = 32
        calls = []; phases = []
        def transient_lock(*args, **kwargs):
            calls.append(args)
            if len(calls) == 1: raise locked
            return original_move(*args, **kwargs)
        with patch.object(media_actions.mover, 'safe_move', side_effect=transient_lock):
            media_actions.execute(self.state, self.payload(row, action='delete', confirmation='DELETE'), lambda **values: phases.append(values.get('phase')))
        self.assertEqual(len(calls), 2); self.assertIn('waiting for preview to finish', phases)
        deleted = self.state.library(self.run_id)['records'][0]
        self.assertTrue(deleted['Trashed']); self.assertEqual(Path(deleted['CurrentPath']).read_bytes(), content)
        other = self.state.library(self.run_id)['records'][1]
        self.assertEqual(Path(other['CurrentPath']).read_bytes(), self.originals[other['OriginalPath']])

    def test_changed_file_during_preview_wait_is_retained(self):
        row = self.state.library(self.run_id)['records'][0]; source = Path(row['CurrentPath'])
        locked = PermissionError('Preview reader is active'); locked.winerror = 32
        original_move = media_actions.mover.safe_move; calls = []
        def change_during_wait(*args, **kwargs):
            calls.append(args)
            if len(calls) == 1:
                stamp = source.stat(); data = bytearray(source.read_bytes()); data[-1] ^= 1
                source.write_bytes(data); os.utime(source, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
                raise locked
            return original_move(*args, **kwargs)
        with patch.object(media_actions.mover, 'safe_move', side_effect=change_during_wait):
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                media_actions.execute(self.state, self.payload(row, action='delete', confirmation='DELETE'), lambda **_: None)
        self.assertTrue(source.exists())
        self.assertFalse(any(path.is_file() for path in source.parent.glob('.media-manager-trash/**/*')))
