"""Date candidates, plausibility checks, cross-checks and confidence."""
import unittest
from datetime import datetime, timezone

from media_organizer import constants as C
from media_organizer import dates


def utc_iso_for_local(local: datetime) -> str:
    """The UTC ISO string a phone would store for a given local wall-clock time on this machine."""
    return local.astimezone().astimezone(timezone.utc).isoformat()


def ts(local: datetime) -> float:
    return local.timestamp()


class FilenameTests(unittest.TestCase):
    def one(self, stem):
        c = dates.filename_candidates(stem)
        return c[0] if c else None

    def test_camera_patterns(self):
        for stem, expect in [("VID_20200714_214318", datetime(2020, 7, 14, 21, 43, 18)),
                             ("20210802_101530", datetime(2021, 8, 2, 10, 15, 30)),
                             ("PXL_20200714_214318123", datetime(2020, 7, 14, 21, 43, 18)),
                             ("VID20200714214318", datetime(2020, 7, 14, 21, 43, 18)),
                             ("Screenrecorder-2018-11-02-20-15-33-412", datetime(2018, 11, 2, 20, 15, 33)),
                             ("Screen_Recording_20200509-213045_YouTube", datetime(2020, 5, 9, 21, 30, 45)),
                             ("signal-2020-07-14-214318", datetime(2020, 7, 14, 21, 43, 18)),
                             ("WhatsApp Video 2020-07-14 at 21.43.18", datetime(2020, 7, 14, 21, 43, 18))]:
            c = self.one(stem)
            self.assertIsNotNone(c, stem)
            self.assertEqual(c.local, expect, stem)
            self.assertFalse(c.date_only, stem)

    def test_date_only_whatsapp(self):
        c = self.one("VID-20190304-WA0001")
        self.assertEqual(c.local, datetime(2019, 3, 4))
        self.assertTrue(c.date_only)

    def test_unix_and_tiktok_ids(self):
        c = self.one("mmexport1596482211231")
        self.assertEqual(c.local, datetime.fromtimestamp(1596482211.231))
        self.assertFalse(c.weak)
        tik = dates.filename_candidates("7106543210987654321")
        self.assertEqual(len(tik), 1)
        self.assertTrue(tik[0].weak)
        self.assertEqual(tik[0].field, "filename.tiktok_id")

    def test_no_false_dates(self):
        for stem in ("7fa2c9e1b3d24f6a8e9c0b1a20200714", "received_1234567890123456", "video (1)",
                     "IMG_20251301_000000", "VID_20990101_000000", "clip_final", "Funny Cats Compilation 2019"):
            self.assertEqual(dates.filename_candidates(stem), [], stem)


class EmbeddedParseTests(unittest.TestCase):
    def test_utc_container_time_is_converted_to_local(self):
        local = datetime(2020, 7, 14, 21, 43, 18)
        c = dates.parse_embedded(dates.DateCandidate(2, "mvhd", "mvhd", utc_iso_for_local(local)))
        self.assertTrue(c.usable)
        self.assertEqual(c.local, local)
        self.assertFalse(c.has_offset)

    def test_apple_creationdate_keeps_its_own_wall_clock(self):
        c = dates.parse_embedded(dates.DateCandidate(1, "apple", "apple", "2020-12-31T23:30:00-0500"))
        self.assertTrue(c.has_offset)
        self.assertEqual(c.local, datetime(2020, 12, 31, 23, 30))
        self.assertEqual(c.utc, datetime(2021, 1, 1, 4, 30, tzinfo=timezone.utc))

    def test_exiftool_style_and_zero_values(self):
        c = dates.parse_embedded(dates.DateCandidate(2, "q", "q", "2020:07:14 21:43:18"))
        self.assertEqual(c.utc, datetime(2020, 7, 14, 21, 43, 18, tzinfo=timezone.utc))
        z = dates.parse_embedded(dates.DateCandidate(2, "q", "q", "0000:00:00 00:00:00"))
        self.assertFalse(z.usable)

    def test_epoch_and_future_values_rejected(self):
        now = datetime.now()
        for raw in ("1970-01-01T00:00:00Z", "1904-01-01T00:00:00Z", "2099-01-01T00:00:00Z"):
            c = dates.parse_embedded(dates.DateCandidate(2, "mvhd", "mvhd", raw))
            dates.assess(c, now)
            self.assertFalse(c.usable, raw)


class ResolveTests(unittest.TestCase):
    def resolve(self, embedded, stem, mtime=None, created=None, **kw):
        cands = dates.build_candidates(embedded, stem, mtime, created)
        return dates.resolve(cands, **kw)

    def mvhd(self, local):
        return [{"field": "mvhd.creation_time", "label": "MP4 movie header creation_time (mvhd)", "tier": 2,
                 "raw": utc_iso_for_local(local)}]

    def test_embedded_corroborated_by_filename_is_high(self):
        start = datetime(2020, 7, 14, 21, 43, 18)
        r = self.resolve(self.mvhd(datetime(2020, 7, 14, 21, 44, 5)), "VID_20200714_214318", duration=47)
        self.assertEqual(r["ResolvedYear"], "2020")
        self.assertEqual(r["DateConfidence"], C.HIGH)
        self.assertIn("mvhd", r["DateSource"])
        self.assertEqual(r["ResolvedDate"], "2020-07-14 21:44:05")
        self.assertTrue(start)

    def test_filesystem_date_differs_but_embedded_wins(self):
        r = self.resolve(self.mvhd(datetime(2016, 7, 4, 20, 15)), "VID_20160704_201500",
                         mtime=ts(datetime(2023, 2, 11, 9, 0)), created=ts(datetime(2023, 2, 11, 9, 0)))
        self.assertEqual(r["ResolvedYear"], "2016")
        self.assertEqual(r["DateConfidence"], C.HIGH)
        self.assertEqual(r["DateConflict"], "")

    def test_time_zone_offset_uses_filename_clock(self):
        # device wrote local time into the UTC field: stored instant is off by the zone offset
        local = datetime(2021, 1, 1, 0, 30)
        wrong = [{"field": "mvhd.creation_time", "label": "mvhd", "tier": 2, "raw": local.isoformat() + "Z"}]
        r = self.resolve(wrong, "VID_20210101_003000")
        self.assertEqual(r["ResolvedDate"], "2021-01-01 00:30:00")
        self.assertEqual(r["ResolvedYear"], "2021")
        self.assertEqual(r["DateConfidence"], C.HIGH)

    def test_year_conflict_lowers_confidence(self):
        r = self.resolve(self.mvhd(datetime(2019, 8, 8, 12, 0)), "VID_20150101_120000")
        self.assertEqual(r["ResolvedYear"], "2019")  # user-specified priority: embedded first
        self.assertEqual(r["DateConfidence"], C.LOW)
        self.assertIn("2015", r["DateConflict"])

    def test_filename_only(self):
        r = self.resolve([], "VID-20170923-WA0004")
        self.assertEqual((r["ResolvedDate"], r["ResolvedYear"], r["DateConfidence"]), ("2017-09-23", "2017", C.MEDIUM))
        r2 = self.resolve([], "VID-20170923-WA0004", mtime=ts(datetime(2017, 9, 23, 18, 0)))
        self.assertEqual(r2["DateConfidence"], C.HIGH)

    def test_filesystem_only_and_unknown(self):
        r = self.resolve([], "clip_final", mtime=ts(datetime(2021, 5, 1, 10, 0)))
        self.assertEqual((r["ResolvedYear"], r["DateConfidence"]), ("2021", C.LOW))
        self.assertIn("modified", r["DateSource"])
        r2 = self.resolve([], "clip_final", mtime=ts(datetime(1980, 1, 1, 0, 0)), created=ts(datetime(1980, 1, 1)))
        self.assertEqual((r2["ResolvedYear"], r2["DateConfidence"]), ("Unknown", C.UNKNOWN_CONF))

    def test_default_clock_value_is_low(self):
        r = self.resolve([{"field": "mvhd", "label": "mvhd", "tier": 2, "raw": "2012-01-01T00:00:00Z"}], "clip")
        self.assertEqual(r["DateConfidence"], C.LOW)

    def test_new_years_eve_apple(self):
        emb = [{"field": "apple.creationdate", "label": "Apple CreationDate", "tier": 1,
                "raw": "2020-12-31T23:30:00-0500"},
               {"field": "mvhd.creation_time", "label": "mvhd", "tier": 2, "raw": "2021-01-01T04:30:00+00:00"}]
        r = self.resolve(emb, "IMG_4521")
        self.assertEqual(r["ResolvedYear"], "2020")
        self.assertEqual(r["DateConfidence"], C.HIGH)

    def test_processed_file_without_corroboration_is_medium(self):
        r = self.resolve(self.mvhd(datetime(2022, 1, 15, 10, 0)), "7fa2c9e1b3d24f6a8e9c0b1a2d3e4f5a",
                         processed_by="FFmpeg (Lavf58)")
        self.assertEqual(r["DateConfidence"], C.MEDIUM)

    def test_device_written_is_high(self):
        r = self.resolve(self.mvhd(datetime(2019, 6, 14, 18, 30)), "clip",
                         device_written=["Android recorder track handler ('VideoHandle')"])
        self.assertEqual(r["DateConfidence"], C.HIGH)


if __name__ == "__main__":
    unittest.main()
