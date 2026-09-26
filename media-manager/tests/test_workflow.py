"""End-to-end workflow on synthetic files (built-in parser only, so no external tools needed).

scan (dry run) -> source unchanged -> move preview -> move -> undo -> source restored.
Also covers scanner edge cases: junction loops, >260-character paths, Unicode
names, recycle-bin folders and 'x.mp4.part'-style names.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone

from media_organizer import constants as C
from media_organizer import mover, scan, snapshot, winfs
from tests import mp4build as B


def noop(*_a, **_k):
    pass


def put(path: str, data: bytes, mtime: float | None = None):
    os.makedirs(winfs.long_path(os.path.dirname(path)), exist_ok=True)
    with open(winfs.long_path(path), "wb") as f:
        f.write(data)
    if mtime is not None:
        os.utime(winfs.long_path(path), (mtime, mtime))


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="mo_test_")
        self.src = os.path.join(self.tmp, "TestMedia")
        self.dest = os.path.join(self.tmp, "Organized")
        self.reports = os.path.join(self.tmp, "runs")
        s = self.src
        cam = B.build(datetime(2019, 6, 15, 0, 30, 5, tzinfo=timezone.utc), 1920, 1080, B.ROTATE_90,
                      meta=B.mdta_meta({"com.android.version": "9", "com.android.capture.fps": 30.0}))
        put(os.path.join(s, "PhoneA", "DCIM", "Camera", "VID_20190614_183005.mp4"), cam)
        put(os.path.join(s, "Old Backup", "DCIM", "Camera", "VID_20190614_183005.mp4"), cam)   # duplicate, same name
        put(os.path.join(s, "PhoneB", "Download", "video.mp4"), B.build(None, 1280, 720, mdat_size=5000),
            mtime=datetime(2020, 3, 5, 12, 0).timestamp())
        put(os.path.join(s, "PhoneA", "Download", "video.mp4"), B.build(None, 1280, 720, mdat_size=6000),
            mtime=datetime(2020, 4, 5, 12, 0).timestamp())                                     # different file, same name
        put(os.path.join(s, "Nested", "A", "B", "C", "D", "E", "F", "test.mp4"),
            B.build(datetime(2021, 2, 2, 12, 0, tzinfo=timezone.utc), 640, 480))
        put(os.path.join(s, "PhoneB", "Download", "Vidéo d'été \U0001F389 #1 & more.mp4"),
            B.build(datetime(2018, 8, 1, 12, 0, tzinfo=timezone.utc), 1280, 720, mdat_size=7000))
        self.long_dir = os.path.join(s, "Deep", *[f"level_{i:02d}_folder_name_padding" for i in range(9)])
        put(os.path.join(self.long_dir, "long_path_video.mp4"),
            B.build(datetime(2017, 5, 5, 12, 0, tzinfo=timezone.utc), 640, 360, mdat_size=3000))
        put(os.path.join(s, "PhoneB", "fake.mp4"), b"This is a text file pretending to be a video.\n" * 10)
        put(os.path.join(s, "PhoneB", "empty.mp4"), b"")
        put(os.path.join(s, "PhoneB", "clip.mp4.part"), b"partial download")
        put(os.path.join(s, "PhoneA", "DCIM", "Camera", "IMG_20190614_183010.jpg"), b"\xff\xd8\xff\xe0 not really")
        put(os.path.join(s, "PhoneA", "readme.txt"), b"keep me")
        put(os.path.join(s, "$RECYCLE.BIN", "S-1-5-21", "$RABC123.mp4"), B.build(None))
        self.junction = os.path.join(s, "PhoneA", "LoopBackToRoot")
        self.has_junction = False
        if winfs.IS_WINDOWS:
            r = subprocess.run(["cmd", "/c", "mklink", "/J", self.junction, s], capture_output=True)
            self.has_junction = r.returncode == 0

    def tearDown(self):
        if self.has_junction and os.path.lexists(self.junction):
            os.rmdir(self.junction)  # removes only the junction, never its target
        shutil.rmtree(winfs.long_path(self.tmp), ignore_errors=True)

    def records_by_name(self, data):
        return {r["OriginalPath"][len(self.src) + 1:]: r for r in data["records"]}

    def test_scan_move_undo(self):
        before = snapshot.take(self.src, quiet=True)
        opts = scan.ScanOptions(source=self.src, dest=self.dest, reports=self.reports, workers=3,
                                ffprobe=os.path.join(self.tmp, "no-ffprobe.exe"), use_exiftool=False,
                                allow_missing_tools=True, quiet=True)
        run_dir, data = scan.run_scan(opts, out=noop)

        # --- dry run changed nothing ---
        self.assertTrue(snapshot.is_identical(snapshot.compare(before, snapshot.take(self.src, quiet=True))))
        self.assertFalse(os.path.exists(self.dest), "a dry run must not create the destination")
        for name in ("manifest.json", "manifest.csv", "duplicates.csv", "invalid_files.csv", "summary.txt"):
            self.assertTrue(os.path.isfile(os.path.join(run_dir, name)), name)

        recs = self.records_by_name(data)
        self.assertEqual(len(recs), 9, sorted(recs))  # recycle bin skipped, junction not followed
        self.assertIn(os.path.join("Nested", "A", "B", "C", "D", "E", "F", "test.mp4"), recs)
        long_rec = next(r for k, r in recs.items() if k.endswith("long_path_video.mp4"))
        self.assertGreater(len(long_rec["OriginalPath"]), 260)
        self.assertEqual(long_rec["IntegrityStatus"], C.OK)
        kinds = {s["Kind"] for s in data["skipped"]}
        self.assertIn("system folder", kinds)
        if self.has_junction:
            self.assertIn("link (not followed)", kinds)
        self.assertEqual(len(data["name_contains_mp4"]), 1)

        cam1 = recs[os.path.join("PhoneA", "DCIM", "Camera", "VID_20190614_183005.mp4")]
        cam2 = recs[os.path.join("Old Backup", "DCIM", "Camera", "VID_20190614_183005.mp4")]
        self.assertEqual(cam1["SHA256"], cam2["SHA256"])
        self.assertEqual((cam1["DuplicateStatus"], cam2["DuplicateStatus"]), ("Duplicate", "Duplicate"))
        self.assertEqual(cam1["ResolvedYear"], "2019")
        self.assertEqual(cam1["Classification"], C.CAMERA)
        self.assertNotEqual(cam1["ProposedDestination"], cam2["ProposedDestination"])
        self.assertEqual(recs[os.path.join("PhoneB", "fake.mp4")]["IntegrityStatus"], C.NOT_MP4)
        self.assertEqual(recs[os.path.join("PhoneB", "empty.mp4")]["IntegrityStatus"], C.EMPTY)
        v1 = recs[os.path.join("PhoneA", "Download", "video.mp4")]
        v2 = recs[os.path.join("PhoneB", "Download", "video.mp4")]
        self.assertEqual({v1["ResolvedYear"], v2["ResolvedYear"]}, {"2020"})
        self.assertNotEqual(v1["ProposedDestination"].lower(), v2["ProposedDestination"].lower())
        dests = [r["ProposedDestination"].lower() for r in data["records"] if r["ProposedDestination"]]
        self.assertEqual(len(dests), len(set(dests)), "proposed destinations must be unique")

        # --- move preview changes nothing ---
        self.assertEqual(mover.run_move(mover.MoveOptions(target=run_dir, quiet=True), out=noop), 0)
        self.assertTrue(snapshot.is_identical(snapshot.compare(before, snapshot.take(self.src, quiet=True))))
        self.assertFalse(os.path.exists(self.dest))

        # --- execute ---
        rc = mover.run_move(mover.MoveOptions(target=run_dir, execute=True, yes=True, quiet=True), out=noop)
        self.assertEqual(rc, 0)
        approved = [r for r in data["records"] if r["Approved"] == "yes"]
        for r in approved:
            self.assertFalse(os.path.exists(winfs.long_path(r["OriginalPath"])), r["OriginalPath"])
            self.assertTrue(os.path.exists(winfs.long_path(r["ProposedDestination"])), r["ProposedDestination"])
        for keep in ("PhoneB\\fake.mp4", "PhoneB\\empty.mp4", "PhoneB\\clip.mp4.part",
                     "PhoneA\\readme.txt", "PhoneA\\DCIM\\Camera\\IMG_20190614_183010.jpg"):
            self.assertTrue(os.path.exists(os.path.join(self.src, keep)), keep)
        move_dir = next(os.path.join(run_dir, "moves", d) for d in os.listdir(os.path.join(run_dir, "moves"))
                        if d.startswith("move_"))
        with open(os.path.join(move_dir, "operations.jsonl"), encoding="utf-8") as f:
            entries = [json.loads(line) for line in f]
        ends = [e for e in entries if e.get("type") == "op" and e.get("phase") == "end"]
        self.assertEqual(len(ends), len(approved))
        self.assertTrue(all(e["status"] == "success" and e["sha256"] for e in ends))
        self.assertTrue(os.path.isdir(os.path.join(self.dest, C.LOGS_FOLDER)))

        # --- re-running the same move is harmless ---
        rc = mover.run_move(mover.MoveOptions(target=run_dir, execute=True, yes=True, quiet=True), out=noop)
        self.assertEqual(rc, 0)

        # --- undo restores the original tree exactly ---
        self.assertEqual(mover.run_undo(move_dir, execute=True, yes=True, quiet=True, out=noop), 0)
        restored = snapshot.take(self.src, quiet=True)
        diff = snapshot.compare(before, restored)
        self.assertTrue(snapshot.is_identical(diff), snapshot.format_diff(diff))


if __name__ == "__main__":
    unittest.main()
