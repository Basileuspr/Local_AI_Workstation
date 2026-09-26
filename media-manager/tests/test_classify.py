"""Classification: sensible evidence, honest confidence, metadata beating misleading names."""
import unittest

from media_organizer import constants as C
from media_organizer.classify import classify


def md(**kw):
    base = {"sources": ["mp4-parser", "ffprobe"],
            "container": {"label": "MP4", "major_brand": "isom", "compatible_brands": [], "fragmented": False},
            "duration": 15.0, "bit_rate": None, "video": None, "audio": {"codec": "aac"},
            "handler_video": None, "handler_audio": None, "encoder": None, "make": None, "model": None,
            "software": None, "gps": None, "comment": None, "title": None, "description": None,
            "android_version": None, "android_capture_fps": None, "signature_tags": {}, "embedded_dates": []}
    base.update(kw)
    return base


def video(w, h, rot=0, fps=30.0, br=None, codec="h264"):
    dw, dh = (h, w) if rot in (90, 270) else (w, h)
    return {"codec": codec, "width": w, "height": h, "rotation": rot, "display_width": dw,
            "display_height": dh, "fps": fps, "bit_rate": br}


GPS = {"text": "+40.7128-074.0060/", "lat": 40.7128, "lon": -74.006}


class ClassifyTests(unittest.TestCase):
    def check(self, parts, name, meta, expect_cls, allowed_conf):
        r = classify(parts, name, meta)
        self.assertEqual(r["Classification"], expect_cls, r["ClassificationEvidence"])
        self.assertIn(r["ClassificationConfidence"], allowed_conf, r["ClassificationEvidence"])
        self.assertTrue(r["ClassificationEvidence"])
        return r

    def test_android_camera(self):
        m = md(video=video(1920, 1080, 90, 30, 17e6), handler_video="VideoHandle", android_version="10",
               android_capture_fps=30.0, gps=GPS)
        self.check(("PhoneA", "DCIM", "Camera"), "VID_20190614_183005.mp4", m, C.CAMERA, {C.HIGH})

    def test_tiktok_in_tiktok_folder(self):
        m = md(video=video(1080, 1920, 0, 30, 1.2e6), encoder="Lavf58.76.100", handler_video="VideoHandler",
               comment="vid:v0d00fg10000c1a2b3c4d5e6f7")
        self.check(("PhoneA", "TikTok"), "7fa2c9e1b3d24f6a8e9c0b1a2d3e4f5a.mp4", m, C.SOCIAL, {C.HIGH})

    def test_tiktok_with_misleading_camera_name_and_folder(self):
        m = md(video=video(1080, 1920, 0, 30, 1.2e6), encoder="Lavf58.76.100", handler_video="VideoHandler",
               comment="vid:v0d00fg10000c1a2b3c4d5e6f7")
        r = self.check(("PhoneB", "DCIM", "Camera"), "VID_20200714_214318.mp4", m, C.SOCIAL, {C.MEDIUM, C.LOW})
        self.assertIn("Camera", r["ClassificationConflicts"])

    def test_camera_video_with_misleading_tiktok_name(self):
        m = md(video=video(1920, 1080, 90, 30, 16e6), handler_video="VideoHandle", android_version="11",
               android_capture_fps=30.0, gps=GPS, make="samsung", model="SM-G991B")
        r = self.check(("PhoneB", "Download"), "tiktok_dance.mp4", m, C.CAMERA, {C.MEDIUM, C.HIGH})
        self.assertIn("TikTok", r["ClassificationConflicts"])

    def test_screen_recording(self):
        m = md(video=video(1080, 2340, 0, 60, 8e6), audio=None, handler_video="VideoHandle", android_version="10")
        self.check(("PhoneB", "DCIM", "Screen recordings"), "Screen_Recording_20200509-213045_YouTube.mp4", m,
                   C.SCREEN, {C.HIGH})

    def test_screen_recording_by_dimensions_only_is_not_high(self):
        m = md(video=video(1080, 2340, 0, 60, 8e6), audio=None)
        r = classify(("Old",), "clip.mp4", m)
        self.assertEqual(r["Classification"], C.SCREEN)
        self.assertNotEqual(r["ClassificationConfidence"], C.HIGH)

    def test_whatsapp(self):
        m = md(video=video(848, 480, 0, 30, 0.9e6))
        self.check(("WhatsApp", "Media", "WhatsApp Video"), "VID-20170923-WA0004.mp4", m, C.MESSAGING, {C.HIGH})

    def test_youtube_download(self):
        m = md(video=video(1280, 720, 0, 30, 1.5e6), handler_video="ISO Media file produced by Google Inc.")
        self.check(("PhoneB", "Download"), "Funny Cats Compilation.mp4", m, C.DOWNLOAD, {C.HIGH})

    def test_generic_file_is_unknown(self):
        m = md(video=video(640, 480, 0, 30, 2e6), encoder="Lavf60.3.100")
        r = self.check(("Nested", "Folder", "Folder", "Folder"), "clip_final.mp4", m, C.UNKNOWN, {C.UNKNOWN_CONF})
        self.assertIn("Not enough evidence", r["ClassificationConflicts"])

    def test_path_only_evidence_is_low(self):
        self.check(("PhoneB", "Download"), "fake.mp4", None, C.DOWNLOAD, {C.LOW})

    def test_telegram_folder(self):
        m = md(video=video(1280, 720, 0, 30, 1.5e6))
        self.check(("Telegram", "Telegram Video"), "some_clip.mp4", m, C.MESSAGING, {C.MEDIUM, C.HIGH})

    def test_iphone_video(self):
        m = md(video=video(1920, 1080, 90, 30, 16e6), make="Apple", model="iPhone 8", software="13.5.1",
               handler_video="Core Media Video", gps=GPS,
               container={"label": "QuickTime MOV", "major_brand": "qt  ", "compatible_brands": [], "fragmented": False})
        self.check(("iPhone",), "IMG_4521.mp4", m, C.CAMERA, {C.HIGH})


if __name__ == "__main__":
    unittest.main()
