"""Destination planning, collision handling, duplicate policies and the move primitive."""
import os
import tempfile
import unittest
from unittest import mock

from media_organizer import constants as C
from media_organizer import hashing, mover, planner


def rec(path, sha, year="2020", cls=C.CAMERA, conf=C.HIGH, status=C.OK, score=80, dconf=C.HIGH):
    return {"RecordId": os.path.basename(path), "OriginalPath": path, "OriginalFilename": os.path.basename(path),
            "SHA256": sha, "FileSize": 10, "IntegrityStatus": status, "ResolvedYear": year,
            "Classification": cls, "ClassificationConfidence": conf, "ClassificationScore": score,
            "ClassificationRunnerUp": "", "ResolvedDate": f"{year}-01-02", "DateSource": "x", "DateConfidence": dconf,
            "ClassificationEvidence": "e", "DateNotes": ""}


class PlannerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = os.path.join(self.tmp.name, "Organized")

    def tearDown(self):
        self.tmp.cleanup()

    def plan(self, records, policy="all", min_conf=C.LOW):
        groups = planner.assign_duplicates(records)
        stats = planner.plan_destinations(records, self.dest, policy, min_conf)
        return groups, stats

    def test_year_then_category_layout(self):
        a = rec(r"D:\s\DCIM\Camera\a.mp4", "A" * 64, "2020", C.CAMERA)
        b = rec(r"D:\s\x\b.mp4", "B" * 64, "Unknown", C.UNKNOWN, C.UNKNOWN_CONF)
        c = rec(r"D:\s\TikTok\c.mp4", "C" * 64, "2021", C.SOCIAL)
        self.plan([a, b, c])
        self.assertEqual(a["ProposedDestination"], os.path.join(self.dest, "2020", "Camera Recording", "a.mp4"))
        self.assertEqual(b["ProposedDestination"], os.path.join(self.dest, "Unknown Year", "Unknown", "b.mp4"))
        self.assertEqual(c["ProposedDestination"], os.path.join(self.dest, "2021", "TikTok - Social Media", "c.mp4"))
        self.assertTrue(all(r["Approved"] == "yes" for r in (a, b, c)))

    def test_collision_between_different_files_gets_hash_suffix(self):
        a = rec(r"D:\s\A\video.mp4", "4C01A52F" + "0" * 56)
        b = rec(r"D:\s\B\VIDEO.mp4", "9ABCDEF0" + "1" * 56)
        _, stats = self.plan([a, b])
        self.assertEqual(a["DestinationFilename"], "video.mp4")
        self.assertEqual(b["DestinationFilename"], "VIDEO__9ABCDEF0.mp4")  # case-insensitive clash on Windows
        self.assertEqual(b["NameChanged"], "yes")
        self.assertIn(a["OriginalPath"], b["NameChangeReason"])
        self.assertEqual(stats["collisions"], 1)

    def test_existing_destination_file_is_never_targeted(self):
        folder = os.path.join(self.dest, "2020", "Camera Recording")
        os.makedirs(folder)
        open(os.path.join(folder, "a.mp4"), "wb").close()
        a = rec(r"D:\s\a.mp4", "ABCDEF12" + "0" * 56)
        _, stats = self.plan([a])
        self.assertEqual(a["DestinationFilename"], "a__ABCDEF12.mp4")
        self.assertEqual(stats["existing_conflicts"], 1)

    def test_duplicates_share_primary_result_and_are_never_dropped(self):
        sha = "D" * 64
        good = rec(r"D:\s\DCIM\Camera\v.mp4", sha, "2019", C.CAMERA, C.HIGH, score=120)
        copy = rec(r"D:\s\Download\v (1).mp4", sha, "2023", C.DOWNLOAD, C.LOW, score=30, dconf=C.LOW)
        groups, _ = self.plan([copy, good])
        self.assertEqual(len(groups), 1)
        self.assertEqual(good["DuplicatePrimary"], "yes")
        self.assertEqual(copy["DuplicatePrimary"], "no")
        self.assertEqual((copy["ResolvedYear"], copy["Classification"]), ("2019", C.CAMERA))
        self.assertEqual(copy["OwnAnalysis"]["Classification"], C.DOWNLOAD)
        self.assertEqual(copy["Approved"], "yes")
        self.assertEqual(os.path.dirname(copy["ProposedDestination"]), os.path.dirname(good["ProposedDestination"]))

    def test_duplicate_policies(self):
        sha = "E" * 64
        a, b = rec(r"D:\s\1\v.mp4", sha), rec(r"D:\s\2\v.mp4", sha)
        self.plan([a, b], policy="separate")
        self.assertIn(C.DUPLICATES_FOLDER, b["ProposedDestination"])
        a, b = rec(r"D:\s\1\v.mp4", sha), rec(r"D:\s\2\v.mp4", sha)
        self.plan([a, b], policy="leave")
        self.assertEqual((b["ProposedDestination"], b["Approved"]), ("", "no"))
        self.assertEqual(a["Approved"], "yes")

    def test_invalid_and_unreadable(self):
        t = rec(r"D:\s\t.mp4", "F" * 64, status=C.TRUNCATED)
        u = rec(r"D:\s\u.mp4", "", status=C.UNREADABLE)
        self.plan([t, u])
        self.assertIn(C.INVALID_FOLDER, t["ProposedDestination"])
        self.assertEqual(t["Approved"], "no")
        self.assertEqual((u["ProposedDestination"], u["Approved"]), ("", "no"))

    def test_min_confidence_routes_low_to_unknown(self):
        a = rec(r"D:\s\a.mp4", "1" * 64, cls=C.SOCIAL, conf=C.LOW)
        self.plan([a], min_conf=C.MEDIUM)
        self.assertIn(os.path.join("2020", "Unknown"), a["ProposedDestination"])


class SafeMoveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.src = os.path.join(self.tmp.name, "src", "clip.mp4")
        os.makedirs(os.path.dirname(self.src))
        with open(self.src, "wb") as f:
            f.write(os.urandom(300_000))
        os.utime(self.src, (1_500_000_000, 1_500_000_000))
        self.sha = hashing.sha256_file(self.src)[0]
        self.dst = os.path.join(self.tmp.name, "dest", "2017", "Camera Recording", "clip.mp4")

    def tearDown(self):
        self.tmp.cleanup()

    def test_same_drive_rename(self):
        detail = mover.safe_move(self.src, self.dst, self.sha)
        self.assertIn("rename", detail["method"])
        self.assertFalse(os.path.exists(self.src))
        self.assertEqual(hashing.sha256_file(self.dst)[0], self.sha)
        self.assertEqual(int(os.stat(self.dst).st_mtime), 1_500_000_000)

    def test_never_overwrites(self):
        os.makedirs(os.path.dirname(self.dst))
        with open(self.dst, "wb") as f:
            f.write(b"existing")
        with self.assertRaises(FileExistsError):
            mover.safe_move(self.src, self.dst, self.sha)
        self.assertTrue(os.path.exists(self.src))
        with open(self.dst, "rb") as f:
            self.assertEqual(f.read(), b"existing")

    def test_cross_drive_copy_verify_delete(self):
        with mock.patch.object(mover, "_same_volume", return_value=False):
            detail = mover.safe_move(self.src, self.dst, self.sha)
        self.assertIn("copy", detail["method"])
        self.assertFalse(os.path.exists(self.src))
        self.assertEqual(hashing.sha256_file(self.dst)[0], self.sha)
        self.assertEqual(int(os.stat(self.dst).st_mtime), 1_500_000_000)  # timestamps preserved
        self.assertEqual([n for n in os.listdir(os.path.dirname(self.dst)) if n.endswith(".partial")], [])

    def test_cross_drive_hash_mismatch_keeps_source(self):
        with mock.patch.object(mover, "_same_volume", return_value=False):
            with self.assertRaises(ValueError):
                mover.safe_move(self.src, self.dst, "0" * 64)
        self.assertTrue(os.path.exists(self.src))
        self.assertFalse(os.path.exists(self.dst))
        self.assertEqual(os.listdir(os.path.dirname(self.dst)), [])


if __name__ == "__main__":
    unittest.main()
