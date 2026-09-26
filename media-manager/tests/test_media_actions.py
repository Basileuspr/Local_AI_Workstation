import os
from pathlib import Path
import unittest
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
