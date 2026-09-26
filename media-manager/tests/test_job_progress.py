import unittest
from unittest.mock import patch

from media_organizer.progress import JobProgress


class JobProgressTests(unittest.TestCase):
    def test_estimate_uses_measured_phase_rate_and_resets_for_reports(self):
        with patch('media_organizer.progress.time.monotonic', return_value=100) as clock:
            progress = JobProgress()
            progress.update(phase='analyzing', completed=0, total=10)
            self.assertIsNone(progress.snapshot()['etaSeconds'])
            clock.return_value = 110
            progress.update(phase='analyzing', completed=2, total=10)
            state = progress.snapshot()
            self.assertEqual(state['percent'], 20)
            self.assertEqual(state['elapsedSeconds'], 10)
            self.assertEqual(state['etaSeconds'], 40)
            progress.update(phase='finalizing', completed=10, total=10)
            self.assertIsNone(progress.snapshot()['percent'])
            self.assertIsNone(progress.snapshot()['etaSeconds'])

    def test_discovery_and_zero_file_jobs_never_guess_an_estimate(self):
        with patch('media_organizer.progress.time.monotonic', return_value=100) as clock:
            progress = JobProgress()
            progress.update(phase='discovering', completed=57)
            clock.return_value = 130
            self.assertIsNone(progress.snapshot()['percent'])
            self.assertIsNone(progress.snapshot()['etaSeconds'])
            progress.update(phase='analyzing', total=0)
            self.assertIsNone(progress.snapshot()['etaSeconds'])
            progress.finish(True)
            self.assertEqual(progress.snapshot()['percent'], 100)

    def test_completion_freezes_elapsed_and_failure_does_not_claim_success(self):
        with patch('media_organizer.progress.time.monotonic', return_value=100) as clock:
            progress = JobProgress()
            progress.update(phase='moving', completed=1, total=4)
            clock.return_value = 110
            progress.finish(False)
            clock.return_value = 200
            state = progress.snapshot()
            self.assertEqual(state['elapsedSeconds'], 10)
            self.assertEqual(state['percent'], 25)
            self.assertIsNone(state['etaSeconds'])
            self.assertNotEqual(state['phase'], 'complete')

    def test_waits_for_a_sample_and_preserves_overall_elapsed_across_phases(self):
        with patch('media_organizer.progress.time.monotonic', return_value=100) as clock:
            progress = JobProgress()
            clock.return_value = 110
            progress.update(phase='moving', completed=1, total=4)
            clock.return_value = 111
            self.assertIsNone(progress.snapshot()['etaSeconds'])
            clock.return_value = 112
            self.assertEqual(progress.snapshot()['etaSeconds'], 6)
            self.assertEqual(progress.snapshot()['elapsedSeconds'], 12)


if __name__ == '__main__':
    unittest.main()
