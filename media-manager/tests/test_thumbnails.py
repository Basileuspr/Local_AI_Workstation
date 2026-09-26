from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from media_organizer.thumbnails import ThumbnailCache, ThumbnailUnavailable
from media_organizer.tools import ToolInfo


class ThumbnailTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='organizer_thumbs_')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'video.mp4'
        self.path.write_bytes(b'video fixture')
        self.tool = patch('media_organizer.thumbnails.tools.find_tool', return_value=ToolInfo('ffmpeg', 'ffmpeg', status='ok'))
        self.tool.start()
        self.addCleanup(self.tool.stop)

    def test_reuses_cached_frame_but_regenerates_if_file_changes(self):
        jpeg = b'\xff\xd8frame\xff\xd9'
        with patch('media_organizer.thumbnails.subprocess.run', return_value=subprocess.CompletedProcess([], 0, jpeg, b'')) as run:
            cache = ThumbnailCache()
            self.assertEqual(cache.get(self.path), jpeg)
            self.assertEqual(cache.get(self.path), jpeg)
            self.assertEqual(run.call_count, 1)
            self.path.write_bytes(b'changed and larger video fixture')
            cache.get(self.path)
            self.assertEqual(run.call_count, 2)

    def test_short_clip_retries_first_frame_and_preserves_source(self):
        before = self.path.read_bytes()
        with patch('media_organizer.thumbnails.subprocess.run', side_effect=[
                subprocess.CompletedProcess([], 0, b'', b''),
                subprocess.CompletedProcess([], 0, b'\xff\xd8frame', b'')]) as run:
            self.assertTrue(ThumbnailCache().get(self.path).startswith(b'\xff\xd8'))
            arguments = run.call_args.args[0]
            self.assertEqual(arguments[arguments.index('-ss') + 1], '0')
        self.assertEqual(self.path.read_bytes(), before)

    def test_timeout_and_decode_failure_are_cached_and_bounded(self):
        with patch('media_organizer.thumbnails.subprocess.run', side_effect=subprocess.TimeoutExpired('ffmpeg', 12)) as run:
            cache = ThumbnailCache(capacity=1)
            with self.assertRaises(ThumbnailUnavailable):
                cache.get(self.path)
            with self.assertRaises(ThumbnailUnavailable):
                cache.get(self.path)
            self.assertEqual(run.call_count, 1)
            other = self.path.with_name('other.mp4')
            other.write_bytes(b'other')
            with self.assertRaises(ThumbnailUnavailable):
                cache.get(other)
            self.assertEqual(len(cache._cache), 1)

    def test_missing_decoder_is_a_clear_fallback(self):
        with patch('media_organizer.thumbnails.tools.find_tool', return_value=ToolInfo('ffmpeg')):
            with self.assertRaisesRegex(ThumbnailUnavailable, 'FFmpeg is unavailable'):
                ThumbnailCache().get(self.path)

    def test_large_previews_have_separate_cache_keys_and_bounded_dimensions(self):
        with patch('media_organizer.thumbnails.subprocess.run', return_value=subprocess.CompletedProcess([], 0, b'\xff\xd8frame', b'')) as run:
            cache = ThumbnailCache()
            cache.get(self.path)
            cache.get(self.path, 'large')
            cache.get(self.path, 'full')
            cache.get(self.path, 'full')
            self.assertEqual(run.call_count, 3)
            args = run.call_args.args[0]
            self.assertIn('1920', args[args.index('-vf') + 1])
            with self.assertRaisesRegex(ValueError, 'Unknown thumbnail size'):
                cache.get(self.path, 'unlimited')
