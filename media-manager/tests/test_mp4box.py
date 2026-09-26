"""Container validation and fallback metadata from the built-in MP4 parser."""
import os
import tempfile
import unittest
from datetime import datetime, timezone

from media_organizer import constants as C
from media_organizer import mp4box
from tests import mp4build as B


class ParserTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, data: bytes) -> str:
        path = os.path.join(self.tmp.name, name)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def test_valid_android_camera_file(self):
        created = datetime(2020, 7, 15, 3, 43, 18, tzinfo=timezone.utc)
        udta = B.box(b"udta", B.udta_text(b"\xa9xyz", "+40.7128-074.0060/"))
        meta = B.mdta_meta({"com.android.version": "10", "com.android.capture.fps": 30.0})
        path = self.write("VID.mp4", B.build(created, 1920, 1080, B.ROTATE_90, udta=udta, meta=meta))
        info = mp4box.inspect_file(path)
        self.assertEqual(info["status"], C.OK, info["problems"])
        self.assertEqual(info["mvhd"]["creation_time"], created.isoformat())
        video = next(t for t in info["tracks"] if t["handler"] == "vide")
        self.assertEqual(video["handler_name"], "VideoHandle")
        self.assertEqual(video["rotation"], 90)
        self.assertEqual((video["sample_width"], video["sample_height"]), (1920, 1080))
        self.assertAlmostEqual(video["fps"], 30.0, places=3)
        self.assertEqual(info["tags"]["location"], "+40.7128-074.0060/")
        self.assertEqual(info["tags"]["com.android.version"], "10")
        self.assertAlmostEqual(info["tags"]["com.android.capture.fps"], 30.0)

    def test_moov_first_and_itunes_tags(self):
        udta = B.itunes_udta({b"\xa9too": "Lavf58.76.100", b"\xa9cmt": "vid:v0d00fg10000abc"})
        info = mp4box.inspect_file(self.write("tt.mp4", B.build(udta=udta, moov_first=True)))
        self.assertEqual(info["status"], C.OK, info["problems"])
        self.assertTrue(info["moov_before_mdat"])
        self.assertEqual(info["tags"]["encoder"], "Lavf58.76.100")
        self.assertEqual(info["tags"]["comment"], "vid:v0d00fg10000abc")

    def test_text_file_named_mp4(self):
        info = mp4box.inspect_file(self.write("fake.mp4", b"This is not a video, just text.\r\n" * 20))
        self.assertEqual(info["status"], C.NOT_MP4)
        self.assertIn("text", info["format_description"])

    def test_jpeg_named_mp4(self):
        info = mp4box.inspect_file(self.write("photo.mp4", b"\xff\xd8\xff\xe0" + b"\0" * 500))
        self.assertEqual(info["status"], C.NOT_MP4)
        self.assertEqual(info["format"], "jpeg")

    def test_matroska_named_mp4(self):
        info = mp4box.inspect_file(self.write("clip.mp4", b"\x1a\x45\xdf\xa3" + b"\x93\x42\x82\x88matroska" + b"\0" * 100))
        self.assertEqual(info["status"], C.NOT_MP4)
        self.assertEqual(info["format"], "matroska")

    def test_empty_and_zero_filled(self):
        self.assertEqual(mp4box.inspect_file(self.write("e.mp4", b""))["status"], C.EMPTY)
        info = mp4box.inspect_file(self.write("z.mp4", b"\0" * 100000))
        self.assertEqual(info["status"], C.NOT_MP4)
        self.assertEqual(info["format"], "zeros")

    def test_truncated_copy(self):
        data = B.build(mdat_size=200000)  # ftyp, mdat, moov
        info = mp4box.inspect_file(self.write("cut.mp4", data[: len(data) // 2]))
        self.assertIn(info["status"], (C.NO_MOOV, C.TRUNCATED))
        self.assertTrue(info["problems"])
        data2 = B.build(mdat_size=200000, moov_first=True)
        info2 = mp4box.inspect_file(self.write("cut2.mp4", data2[: len(data2) - 50000]))
        self.assertEqual(info2["status"], C.TRUNCATED)

    def test_interrupted_recording_without_moov(self):
        data = B.ftyp() + B.box(b"mdat", b"\x01" * 5000)
        info = mp4box.inspect_file(self.write("rec.mp4", data))
        self.assertEqual(info["status"], C.NO_MOOV)

    def test_audio_only(self):
        info = mp4box.inspect_file(self.write("a.mp4", B.build(include_video=False, audio=True)))
        self.assertEqual(info["status"], C.AUDIO_ONLY)

    def test_heif_image_is_not_video(self):
        data = B.ftyp(b"heic", 0, (b"mif1", b"heic")) + B.box(b"meta", b"\0" * 40) + B.box(b"mdat", b"\0" * 100)
        info = mp4box.inspect_file(self.write("img.mp4", data))
        self.assertEqual(info["status"], C.NOT_MP4)

    def test_garbage_after_complete_file_is_only_a_warning(self):
        data = B.build() + b"SEFH\x01\x02\x03garbage-trailer-data" * 3
        info = mp4box.inspect_file(self.write("samsung.mp4", data))
        self.assertEqual(info["status"], C.OK_WARNINGS)
        self.assertTrue(any("non-box data" in w for w in info["warnings"]))

    def test_damaged_structure(self):
        data = B.ftyp() + b"\x00\x00\x00\x10\x01\x02\x03\x04" + b"\0" * 64
        info = mp4box.inspect_file(self.write("bad.mp4", data))
        self.assertEqual(info["status"], C.CORRUPT)

    def test_quicktime_container_flagged(self):
        info = mp4box.inspect_file(self.write("IMG_0001.mp4", B.build(major=b"qt  ", handler_name="Core Media Video")))
        self.assertEqual(info["status"], C.OK_WARNINGS)
        self.assertEqual(info["container"], "QuickTime MOV")


if __name__ == "__main__":
    unittest.main()
