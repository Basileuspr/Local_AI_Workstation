import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from media_organizer import frames, scan
from media_organizer.ui_server import UIState


class FrameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try: cls.binary = frames.binaries()
        except ValueError as error: raise unittest.SkipTest(str(error))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='frame_parser_'); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); source = self.root/'source'; source.mkdir()
        self.video = source/'source.mp4'
        subprocess.run([self.binary['ffmpeg'],'-v','error','-f','lavfi','-i','testsrc2=size=160x120:rate=12:duration=2',
                        '-c:v','libx264','-crf','0',str(self.video)],check=True,creationflags=frames.FLAGS)
        self.original = self.video.read_bytes()
        run,_=scan.run_scan(scan.ScanOptions(str(source),str(self.root/'archive'),str(self.root/'runs'),use_exiftool=False,quiet=True),out=lambda *_:None)
        self.state=UIState(str(self.root/'runs')); self.run=Path(run).name
        row=self.state.library(self.run)['records'][0]
        self.payload=dict(runId=self.run,recordId=row['RecordId'],expectedPath=row['CurrentPath'])
        self.info=frames.inspect(self.state,self.payload,lambda **_:None,threading.Event())['frameInfo']

    def test_count_and_every_nth_frame_match_decoded_source_ordinals(self):
        self.assertEqual(self.info['frames'],24);self.assertEqual(self.info['fps'],12)
        self.assertEqual(self.info['intervals'],list(range(1,11))+list(range(15,51,5)))
        result=frames.extract(self.state,dict(self.payload,probeId=self.info['id'],interval=3,start=2,end=8,destination=str(self.root/'exports')),
                              lambda **_:None,threading.Event())
        output=Path(result['frameOutput']['output']);self.assertEqual(len(list(output.glob('*.png'))),3)
        # First parsed image must be source frame 2, not a time-resampled approximation.
        expected=subprocess.check_output([self.binary['ffmpeg'],'-v','error','-i',str(self.video),'-vf',r'select=eq(n\,1)',
                                         '-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],creationflags=frames.FLAGS)
        actual=subprocess.check_output([self.binary['ffmpeg'],'-v','error','-i',str(output/'frame_000000001.png'),
                                       '-f','rawvideo','-pix_fmt','rgb24','pipe:1'],creationflags=frames.FLAGS)
        self.assertEqual(actual,expected);self.assertEqual(self.video.read_bytes(),self.original)
        self.assertFalse((output/'frames.json').exists());record=json.loads((self.state.run_path(self.run)/'frame-exports'/(output.name+'.json')).read_text());self.assertEqual(record['status'],'complete');self.assertEqual(record['settings']['start'],2)

    def test_frame_timeline_matches_presentation_order_and_cancellation(self):
        result=frames.timeline(self.state,self.payload,lambda **_:None,threading.Event())
        times=self.state.frame_timelines[result['timelineId']]
        self.assertEqual(result['frameCount'],24)
        self.assertEqual(len(times),24)
        for i,time in enumerate(times): self.assertAlmostEqual(time,i/12,places=5)
        self.assertNotIn('frameTimeline',result)  # regular status polling stays compact
        cancelled=threading.Event();cancelled.set()
        with self.assertRaises(ValueError): frames.timeline(self.state,self.payload,lambda **_:None,cancelled)
        self.assertEqual(self.video.read_bytes(),self.original)

    def test_variable_rate_timeline_keeps_each_actual_frame(self):
        varied=self.video.with_name('variable.mp4')
        subprocess.run([self.binary['ffmpeg'],'-v','error','-i',str(self.video),'-vf',r'select=lt(n\,6)+not(mod(n\,3))',
                        '-fps_mode','vfr','-c:v','libx264',str(varied)],check=True,creationflags=frames.FLAGS)
        run,_=scan.run_scan(scan.ScanOptions(str(varied.parent),str(self.root/'archive'),str(self.root/'runs'),use_exiftool=False,quiet=True),out=lambda *_:None)
        row=next(r for r in self.state.library(Path(run).name)['records'] if r['OriginalFilename']=='variable.mp4')
        result=frames.timeline(self.state,dict(runId=Path(run).name,recordId=row['RecordId'],expectedPath=row['CurrentPath']),lambda **_:None,threading.Event())
        times=self.state.frame_timelines[result['timelineId']]
        self.assertEqual(len(times),12)
        self.assertAlmostEqual(times[1]-times[0],1/12,places=5)
        self.assertAlmostEqual(times[-1]-times[-2],3/12,places=5)

    def test_output_options_and_no_overwrite(self):
        payload=dict(self.payload,probeId=self.info['id'],interval=1,format='jpg',width=640,rotation=90,destination=str(self.root/'exports'))
        result=frames.extract(self.state,payload,lambda **_:None,threading.Event())
        output=Path(result['frameOutput']['output']);self.assertEqual(len(list(output.glob('*.jpg'))),24)
        probe=json.loads(subprocess.check_output([self.binary['ffprobe'],'-v','error','-show_entries','stream=width,height','-of','json',str(output/'frame_000000001.jpg')],creationflags=frames.FLAGS))
        self.assertEqual((probe['streams'][0]['width'],probe['streams'][0]['height']),(120,160))
        another=frames.extract(self.state,dict(payload,interval=50),lambda **_:None,threading.Event())
        self.assertNotEqual(another['frameOutput']['output'],str(output));self.assertEqual(another['frameOutput']['count'],1)
        self.assertEqual(len(list(output.glob('*.jpg'))),24)

    def test_validation_and_cancel_never_change_source(self):
        for extra in (dict(interval=11),dict(start=0),dict(end=25),dict(format='exe'),dict(width=123),dict(interval=True),dict(destination='relative')):
            with self.assertRaises(ValueError): frames.options(self.info,dict(destination=str(self.root/'out'),**extra) if 'destination' not in extra else extra)
        cancelled=threading.Event();cancelled.set()
        with self.assertRaises(ValueError): frames.inspect(self.state,self.payload,lambda **_:None,cancelled)
        self.assertEqual(self.video.read_bytes(),self.original)
