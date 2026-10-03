import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import slicer
from routes.slicer import router, SliceOptions

def test_route_validates_settings_before_starting_any_engine(monkeypatch):
    app=FastAPI();app.include_router(router)
    monkeypatch.setattr(slicer,'start',lambda *args:pytest.fail('Invalid input must not start a process'))
    with TestClient(app) as client:
        for options in [{'machine':'../../private'},{'infill':101},{'nozzle':0},{'layer_height':float('inf')}]:
            response=client.post('/slicer/jobs',files={'file':('cube.stl',b'neutral','model/stl')},data={'options':json.dumps(options)})
            assert response.status_code==400

def test_sources_and_outputs_are_bounded_and_only_finished_owned_jobs_are_downloadable(tmp_path,monkeypatch):
    monkeypatch.setattr(slicer,'ROOT',tmp_path)
    for name,raw in [('cube.obj',b'neutral'),('cube.stl',b''),('cube.stl',b'x'*(slicer.MAX_FILE+1))]:
        with pytest.raises(ValueError):slicer.start(raw,name,SliceOptions().model_dump())
    ident='a'*32;folder=tmp_path/ident;folder.mkdir();(folder/'output.gcode').write_text('G1 X1')
    (folder/'result.json').write_text(json.dumps({'status':'cancelled','name':'cube.gcode'}))
    with pytest.raises(FileNotFoundError):slicer.output(ident)
    with pytest.raises(FileNotFoundError):slicer.output('../private')
    (folder/'result.json').write_text(json.dumps({'status':'complete','name':'cube.gcode'}))
    assert slicer.output(ident)==(folder/'output.gcode','cube.gcode')

def test_generic_printer_requires_explicit_dimension_confirmation(tmp_path,monkeypatch):
    monkeypatch.setattr(slicer.linked_apps,'cura_installation',lambda:(tmp_path/'CuraEngine.exe',tmp_path))
    monkeypatch.setattr(slicer,'readiness',lambda:{'machines':[{'id':'fdmprinter'}]})
    with pytest.raises(ValueError,match='Confirm'):slicer.start(b'neutral','cube.stl',SliceOptions().model_dump())
    assert not list(tmp_path.iterdir())
