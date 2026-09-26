import base64
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from media_organizer import captures, custom_folders, folder_browser, frames, scan
from media_organizer.ui_server import UIState


class FolderBrowserTests(unittest.TestCase):
    def test_create_managed_external_browse_and_reject_invalid_names(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);reports=root/'runs'
            managed=custom_folders.create_folder(reports,'Favorites')
            self.assertTrue(Path(managed['path']).is_dir())
            self.assertEqual(Path(managed['path']),reports/'managed-media'/'Custom Folders'/'Favorites')
            external=custom_folders.create_folder(reports,'Travel',str(root))
            self.assertTrue((root/'Travel').is_dir())
            listing=folder_browser.browse(reports,str(root))
            self.assertIn('Travel',[item['name'] for item in listing['children']])
            self.assertEqual(folder_browser.create(root,'Nested'),root/'Nested')
            for name in ('../outside','NUL','CON.png','bad:name','.','bad/name',''):
                with self.assertRaises(ValueError): custom_folders.create_folder(reports,name)
            with self.assertRaises(ValueError): custom_folders.create_folder(reports,'Favorites')
            self.assertEqual(len(custom_folders.folders(reports)),2)


class CaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try: cls.binary=frames.binaries()
        except ValueError as e: raise unittest.SkipTest(str(e))
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='capture_qa_');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);source=self.root/'source';source.mkdir()
        self.video=source/'VID_20190920_100000.mp4'
        subprocess.run([self.binary['ffmpeg'],'-v','error','-f','lavfi','-i','testsrc2=s=160x120:r=25:d=2',
            '-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-c:a','aac','-shortest',str(self.video)],check=True,creationflags=frames.FLAGS)
        self.original=self.video.read_bytes()
        run,_=scan.run_scan(scan.ScanOptions(str(source),str(self.root/'archive'),str(self.root/'runs'),use_exiftool=False,quiet=True),out=lambda *_:None)
        self.state=UIState(str(self.root/'runs'));self.run=Path(run).name
        row=self.state.library(self.run)['records'][0]
        self.payload=dict(runId=self.run,recordId=row['RecordId'],expectedPath=row['CurrentPath'])
    def probe(self,path):
        return json.loads(subprocess.check_output([self.binary['ffprobe'],'-v','error','-show_streams','-show_format','-of','json',str(path)],creationflags=frames.FLAGS))
    def test_clip_timing_audio_rotation_destination_and_nonoverwrite(self):
        result=captures.execute(self.state,dict(self.payload,start=.4,end=1.2,rotation=90),lambda **_:None,threading.Event(),'clip')['capture']
        info=self.probe(result['path']);video=next(s for s in info['streams'] if s['codec_type']=='video')
        self.assertEqual((video['width'],video['height']),(120,160))
        self.assertAlmostEqual(float(video['duration']),.8,places=2)
        self.assertTrue(any(s['codec_type']=='audio' for s in info['streams']))
        extra=captures.execute(self.state,dict(self.payload,start=0,end=.2,rotation=0,destination=str(self.root)),lambda **_:None,threading.Event(),'clip')['capture']
        self.assertEqual(Path(extra['path']).parent,self.root)
        self.assertNotEqual(result['path'],extra['path'])
        self.assertEqual(len(captures.gallery(self.state,'clip')['records']),2)
        self.assertEqual(captures.media_path(self.state,result['id']),Path(result['path']))
        self.assertFalse(Path(result['path'] + '.json').exists())
        self.assertEqual(self.video.read_bytes(),self.original)
        with self.assertRaises(ValueError): captures.execute(self.state,dict(self.payload,start=1,end=.5),lambda **_:None,threading.Event(),'clip')
        with self.assertRaises(ValueError): captures.execute(self.state,dict(self.payload,start=0,end=3),lambda **_:None,threading.Event(),'clip')
    def test_snapshot_decodes_png_and_records_current_frame_and_rotation(self):
        png=subprocess.check_output([self.binary['ffmpeg'],'-v','error','-ss','0.4','-i',str(self.video),'-frames:v','1','-vf','transpose=clock','-f','image2pipe','-c:v','png','pipe:1'],creationflags=frames.FLAGS)
        result=captures.execute(self.state,dict(self.payload,png='data:image/png;base64,'+base64.b64encode(png).decode(),time=.4,rotation=90),lambda **_:None,threading.Event(),'snapshot')['capture']
        self.assertEqual((result['width'],result['height']),(120,160))
        self.assertEqual(result['time'],.4)
        self.assertFalse(Path(result['path'] + '.json').exists())
        self.assertEqual(captures.gallery(self.state,'snapshot')['records'][0]['id'],result['id'])
        self.assertEqual(self.probe(result['path'])['streams'][0]['codec_name'],'png')
        self.assertEqual(self.video.read_bytes(),self.original)
        with self.assertRaises(ValueError): captures.media_path(self.state,'../source')
        with self.assertRaises(ValueError): captures.execute(self.state,dict(self.payload,png='data:image/png;base64,bm90IGEgcG5n',time=0),lambda **_:None,threading.Event(),'snapshot')
