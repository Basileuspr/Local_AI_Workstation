"""Slice a synthetic cube with the detected CuraEngine; all outputs are temporary."""
from pathlib import Path
import struct
import re
import sys
import tempfile
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from services import slicer
from routes.slicer import SliceOptions

vertices = [(-5,-5,0),(5,-5,0),(5,5,0),(-5,5,0),(-5,-5,10),(5,-5,10),(5,5,10),(-5,5,10)]
faces = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
raw = b'Neutral QA cube'.ljust(80,b'\x00') + struct.pack('<I',len(faces))
for face in faces:
    coords = [value for index in face for value in vertices[index]]
    raw += struct.pack('<12fH',0,0,0,*coords,0)
with tempfile.TemporaryDirectory(prefix='law-slicer-qa-') as directory:
    slicer.ROOT = Path(directory)
    ready = slicer.readiness()
    assert ready['ready'], ready
    slicer.start(raw, 'neutral-cube.stl', SliceOptions(generic_confirmed=True).model_dump())
    while slicer.status()['job']['status'] in ('queued','running','stopping'):
        time.sleep(.2)
    job=slicer.status()['job']
    if job['status'] != 'complete':
        print((Path(directory)/job['id']/'engine.log').read_text(encoding='utf-8',errors='replace')[-3000:])
    assert job['status']=='complete',job
    file,name=slicer.output(job['id']);gcode=file.read_text(encoding='utf-8',errors='replace')
    assert ';LAYER:' in gcode and 'G1 ' in gcode and ' E' in gcode
    coordinates={axis:[float(value) for value in re.findall(r'^G[01]\s[^\n]*?\b'+axis+r'(-?[0-9.]+)',gcode,re.M)] for axis in ('X','Y')}
    for values in coordinates.values():assert values and min(values)>=0 and max(values)<=220
    heating=[line for line in gcode.splitlines() if re.match(r'M(?:104|109|140|190)\b',line)]
    print({'heating_commands':heating})
    assert re.search(r'M10[49][^\n]*S200',gcode) and re.search(r'M1[49]0[^\n]*S60',gcode)
    print({'engine':ready['engine'],'status':job['status'],'output_bytes':len(gcode),'elapsed_seconds':job['elapsed_seconds'], 'source_unchanged':(file.parent/'input.stl').read_bytes()==raw,'xy_bounds':{axis:[min(values),max(values)] for axis,values in coordinates.items()}})
