"""UI fixture only: synthetic providers, real APIs and disposable file catalogs."""
import os
from pathlib import Path
assert 'law-visual-review-preview' in os.environ.get('LAW_DATA_DIR',''), 'Use the dedicated temporary preview data directory.'
from main import app
from config import settings
from PIL import Image,ImageDraw
from services.faces.providers import register,ProviderStatus,DetectedFace
from services.image_manager import manager
from services import visual_classification
from services.image_workflows import adapters

class FixtureFaces:
    key='fixture';name='Synthetic face fixture'
    def status(self):return ProviderStatus(self.key,self.name,True,'cpu','Simulated inference for UI verification only.')
    def uses_gpu(self):return False
    def unload(self):return True
    def detect(self,image,cancelled=None):
        return [DetectedFace((15,20,80,90),.99,embedding=(1.,)+(0.,)*31),DetectedFace((115,20,180,90),.99,embedding=(0.,1.)+(0.,)*30)]
register(FixtureFaces())
adapters.vision_models=lambda:[{'id':'fixture-scenes','name':'Synthetic scene fixture'}]
async def scenes(*args):return ['outdoors','park']
async def prepare(*args):pass
visual_classification.scene_labels=scenes
visual_classification.prepare_runtime=prepare
# Keep model cleanup local to the fixture as well as simulated inference.
import httpx
original_client=httpx.AsyncClient
def response(request):return httpx.Response(200,json={'done':True})
visual_classification.httpx=type('FixtureHTTP',(),{'AsyncClient':staticmethod(lambda **kwargs:original_client(transport=httpx.MockTransport(response))), 'HTTPError':httpx.HTTPError})

root=settings.data_dir.parent/'photos';root.mkdir(parents=True,exist_ok=True)
for name,color in [('one.png','#34604b'),('two.png','#3e587c')]:
    image=Image.new('RGB',(200,140),color);draw=ImageDraw.Draw(image)
    for x in (15,115):draw.ellipse((x,20,x+65,90),fill='#dcb792');draw.ellipse((x+17,43,x+23,49),fill='black');draw.ellipse((x+42,43,x+48,49),fill='black')
    image.save(root/name)
folder=manager.add_folder(str(root));manager.start('scan',{'folder_ids':[folder['id']],'recursive':True});manager.worker.join(10)
@app.get('/fixture/items')
def items():return {'ids':[row['id'] for row in manager.query()['images']]}
