import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from media_organizer import frames, image_tools
from media_organizer.ui_server import UIState


class ImageToolsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try: cls.binary = frames.binaries()
        except ValueError as error: raise unittest.SkipTest(str(error))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='image_tools_'); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.source = self.root/'source'; self.source.mkdir()
        for i, (color, size) in enumerate([('red','80x40'),('blue','40x80'),('green','60x60'),('white','100x40')]):
            subprocess.run([self.binary['ffmpeg'],'-v','error','-f','lavfi','-i',f'color={color}:s={size}',
                '-frames:v','1','-threads','1',str(self.source/f'{i+1}.jpg')],check=True,creationflags=frames.FLAGS)
        self.originals={p:p.read_bytes() for p in self.source.iterdir()}
        self.state=UIState(str(self.root/'runs')); self.cancel=threading.Event()
        self.info=image_tools.inspect(self.state,dict(source=str(self.source)),lambda **_:None,self.cancel)['imageBatch']

    def execute(self, **settings):
        return image_tools.execute(self.state,dict(batchId=self.info['id'],destination=str(self.root/'out'),**settings),lambda **_:None,self.cancel)['imageOutput']

    def pixels(self,path):
        return subprocess.check_output([self.binary['ffmpeg'],'-v','error','-i',str(path),'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],creationflags=frames.FLAGS)

    def size(self,path):
        result=json.loads(subprocess.check_output([self.binary['ffprobe'],'-v','error','-show_entries','stream=width,height','-of','json',str(path)],creationflags=frames.FLAGS))['streams'][0]
        return result['width'],result['height']

    def test_conversion_and_nonoverwriting_source_preservation(self):
        result=self.execute(format='png')
        self.assertEqual(len(result['images']),4)
        for item in result['images']:
            self.assertEqual(self.size(item['output']),(item['source']['width'],item['source']['height']))
        second=self.execute(format='webp')
        self.assertNotEqual(result['output'],second['output'])
        for source,content in self.originals.items(): self.assertEqual(source.read_bytes(),content)

    def test_animated_gif_frame_count_delay_order_and_source_preservation(self):
        result=self.execute(standardize=True,width=32,height=32,layout='gif',frameDelay=200,loop=0,reverse=True)
        path=result['animated'];self.assertEqual(self.size(path),(32,32))
        probe=json.loads(subprocess.check_output([self.binary['ffprobe'],'-v','error','-show_frames','-show_entries','frame=pts_time:stream=nb_frames,duration','-of','json',path],creationflags=frames.FLAGS))
        times=[float(frame['pts_time']) for frame in probe['frames']]
        self.assertEqual(times,[0,.2,.4,.6])
        self.assertTrue(all(c>250 for c in self.pixels(path)[:3]))
        self.assertEqual(Path(path).read_bytes()[:6],b'GIF89a')
        for source,content in self.originals.items(): self.assertEqual(source.read_bytes(),content)
        with self.assertRaises(ValueError): self.execute(standardize=True,layout='gif',frameDelay=33)
        with self.assertRaises(ValueError): self.execute(standardize=True,layout='gif',width=3000,height=3000)

    def test_padding_crop_stretch_grid_order_and_strips(self):
        result=self.execute(standardize=True,width=32,height=32,fit='contain',layout='grid',columns=2,gap=2)
        self.assertEqual(self.size(result['stitched']),(66,66))
        pixels=self.pixels(result['stitched'])
        def pixel(x,y): return pixels[(y*66+x)*3:(y*66+x)*3+3]
        self.assertEqual(pixel(0,0),bytes([255,255,255]))  # letterbox padding
        self.assertGreater(pixel(16,16)[0],240);self.assertGreater(pixel(50,16)[2],240)
        for layout,size in [('vertical',(16,64)),('horizontal',(64,16))]:
            output=self.execute(standardize=True,width=16,height=16,fit='cover',layout=layout,reverse=True)
            self.assertEqual(self.size(output['stitched']),size)
            self.assertTrue(all(c>250 for c in self.pixels(output['images'][0]['output'])[:3]))
        result=self.execute(standardize=True,width=12,height=20,fit='stretch',format='jpg')
        self.assertEqual(self.size(result['images'][0]['output']),(12,20))

    def test_jpeg_alpha_background_and_invalid_stale_inputs(self):
        transparent=self.source/'transparent.png'
        subprocess.run([self.binary['ffmpeg'],'-v','error','-f','lavfi','-i','color=red@0:s=16x16,format=rgba','-frames:v','1','-threads','1',str(transparent)],check=True,creationflags=frames.FLAGS)
        self.info=image_tools.inspect(self.state,dict(source=str(self.source)),lambda **_:None,self.cancel)['imageBatch']
        result=self.execute(format='jpg',background='#00ff00')
        rgb=self.pixels(result['images'][-1]['output'])[:3]
        self.assertLess(rgb[0],5);self.assertGreater(rgb[1],250);self.assertLess(rgb[2],5)
        with self.assertRaises(ValueError): self.execute(standardize=True,layout='grid',columns=2)
        with self.assertRaises(ValueError): self.execute(standardize=True,width=16384,height=16384)
        first=Path(self.info['records'][0]['path']);first.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'changed'): self.execute()
        self.cancel.set()
        with self.assertRaises(ValueError): image_tools.inspect(self.state,dict(source=str(self.source)),lambda **_:None,self.cancel)
