"""Model-free boundaries and output semantics for optional local adapters."""
import hashlib
import importlib.util
import json
import sys
import threading
from types import SimpleNamespace

import pytest
from PIL import Image, ImageChops
from pydantic import ValidationError

from services.image_workflows import advanced_adapters as advanced, addon_models
from services.image_workflows.contracts import Stage, PromptSettings, Workflow, Asset
from services.image_workflows.providers import PreparedStage, ExecutionContext, WorkflowCancelled, StageResult
from services.image_workflows.planning import preflight


@pytest.fixture
def installer(tmp_path, monkeypatch):
    from pathlib import Path
    path = Path(__file__).resolve().parents[2] / 'scripts' / 'install-workflow-models.py'
    module_spec = importlib.util.spec_from_file_location('workflow_installer_test', path)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    payload = b'fixed model bytes'
    spec = {'files': [{'file': 'weights.bin', 'size': len(payload),
                       'sha256': hashlib.sha256(payload).hexdigest(), 'url': 'https://example.invalid/weights'}]}
    monkeypatch.setattr(addon_models, 'catalog', lambda: {'test': spec})
    monkeypatch.setattr(module, 'catalog', lambda: {'test': spec})
    monkeypatch.setattr(module.shutil, 'disk_usage', lambda _: SimpleNamespace(free=2 * 1024**3))
    root = addon_models.asset_root('test', tmp_path)
    root.mkdir(parents=True)
    return module, payload, root


@pytest.mark.parametrize('range_supported', [True, False])
def test_installer_resumes_or_restarts_then_checks_hash(tmp_path, monkeypatch, installer, range_supported):
    import requests
    module, payload, root = installer
    (root/'weights.bin.pending').write_bytes(payload[:5])
    class Response:
        status_code = 206 if range_supported else 200
        headers = {'Content-Range': f'bytes 5-{len(payload)-1}/{len(payload)}'} if range_supported else {}
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def iter_content(self, _): yield payload[5:] if range_supported else payload
    def fetch(url, **kwargs):
        assert kwargs['headers'] == {'Range': 'bytes=5-'}
        return Response()
    monkeypatch.setattr(requests, 'get', fetch)
    module.install('test', tmp_path)
    assert (root/'weights.bin').read_bytes() == payload
    assert not (root/'weights.bin.pending').exists()
    assert addon_models.require_assets('test', tmp_path, verify_hashes=True) == root
    monkeypatch.setattr(requests, 'get', lambda *a, **k: pytest.fail('Verified installation fetched again'))
    module.install('test', tmp_path)


@pytest.mark.parametrize('failure', ['oversize', 'wrong_hash', 'wrong_range', 'http_error'])
def test_installer_never_marks_bad_download_ready(tmp_path, monkeypatch, installer, failure):
    import requests
    module, payload, root = installer
    class Response:
        status_code = 503 if failure == 'http_error' else 206 if failure == 'wrong_range' else 200
        headers = {'Content-Range': 'bytes 999-1000/1001'}
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def iter_content(self, _): yield payload + b'extra' if failure == 'oversize' else b'x' * len(payload)
    monkeypatch.setattr(requests, 'get', lambda *a, **k: Response())
    with pytest.raises(ValueError): module.install('test', tmp_path)
    assert not (root/'installation-manifest.json').exists()
    assert not (root/'weights.bin').exists()


def test_installer_preserves_unrecognized_existing_file(tmp_path, monkeypatch, installer):
    import requests
    module, payload, root = installer
    existing = root/'weights.bin'
    existing.write_bytes(b'x' * len(payload))
    monkeypatch.setattr(requests, 'get', lambda *a, **k: pytest.fail('Must not fetch over existing work'))
    with pytest.raises(ValueError, match='SHA-256'): module.install('test', tmp_path)
    assert existing.read_bytes() == b'x' * len(payload)
    assert not (root/'installation-manifest.json').exists()


def context(tmp_path):
    output = tmp_path / 'output'
    output.mkdir(exist_ok=True)
    return ExecutionContext('test', output, threading.Event())


def request(tmp_path, operation, **settings):
    source = tmp_path/'source.png'
    Image.new('RGB',(80,64),'blue').save(source)
    stage = Stage(id='a'*32,operation=operation,model_id='test',width=256,height=256,**settings)
    return PreparedStage(stage,PromptSettings(prompt='A portrait',seed=123,steps=4),source,None,None,())


@pytest.mark.parametrize('changes',[{'outpaint_left':256},{'outpaint_top':256},
    {'outpaint_left':0,'outpaint_right':0,'outpaint_top':0,'outpaint_bottom':0}, {'canny_low':200,'canny_high':100}])
def test_invalid_controls_rejected_before_execution(changes):
    with pytest.raises(ValidationError):
        Stage(id='a'*32,operation='outpaint',width=256,height=256,**changes)


def test_canny_creates_structure_without_changing_source():
    pytest.importorskip('cv2')
    source=Image.new('RGB',(128,128),'black');source.paste('white',(32,32,96,96))
    original=source.tobytes()
    edge=advanced.canny_map(source)
    assert edge.size==source.size and edge.mode=='RGB'
    assert edge.getpixel((64,64))==(0,0,0)
    assert edge.getbbox() and edge.getextrema()==((0,255),)*3
    assert source.tobytes()==original


def test_outpainting_preserves_fitted_interior_and_cleans_inputs(tmp_path,monkeypatch):
    from services.image_workflows import adapters
    req=request(tmp_path,'outpaint');ctx=context(tmp_path)
    before=req.source.read_bytes()
    def generate(self,prepared,execution):
        assert prepared.stage.operation=='inpaint' and prepared.stage.strength==1
        with Image.open(prepared.mask) as mask:
            assert mask.getpixel((0,0))==255 and mask.getpixel((128,128))==0
        return advanced.save_result(Image.new('RGB',(256,256),'red'),execution,{'seed':123})
    monkeypatch.setattr(adapters.SDXLProvider,'generate',generate)
    result=advanced.OutpaintProvider().generate(req,ctx)
    with Image.open(result.image_paths[0]) as image:
        assert image.getpixel((0,0))==(255,0,0)
        assert image.crop((64,64,192,192)).getextrema()==((0,0),(0,0),(255,255))
    assert req.source.read_bytes()==before
    assert list(ctx.output_dir.iterdir())==list(result.image_paths)
    assert result.metadata['preserves_fitted_source'] is True


def test_outpainting_failure_cleans_prepared_inputs(tmp_path,monkeypatch):
    from services.image_workflows import adapters
    req=request(tmp_path,'outpaint');ctx=context(tmp_path)
    def fail(*args): raise WorkflowCancelled('stopped')
    monkeypatch.setattr(adapters.SDXLProvider,'generate',fail)
    with pytest.raises(WorkflowCancelled): advanced.OutpaintProvider().generate(req,ctx)
    assert not list(ctx.output_dir.iterdir())


def test_model_readiness_rejects_missing_changed_and_tampered_assets(tmp_path,monkeypatch):
    payload=b'model bytes'
    spec={'files':[{'file':'weights.safetensors','size':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}]}
    monkeypatch.setattr(addon_models,'catalog',lambda:{'test':spec})
    with pytest.raises(ValueError): addon_models.require_assets('test',tmp_path)
    root=addon_models.asset_root('test',tmp_path);root.mkdir(parents=True)
    (root/'weights.safetensors').write_bytes(payload)
    (root/'installation-manifest.json').write_text(json.dumps({'spec':spec}))
    assert addon_models.require_assets('test',tmp_path,verify_hashes=True)==root
    (root/'weights.safetensors').write_bytes(b'other bytes')
    with pytest.raises(ValueError,match='integrity'): addon_models.require_assets('test',tmp_path,verify_hashes=True)
    (root/'weights.safetensors').write_bytes(b'x')
    with pytest.raises(ValueError): addon_models.require_assets('test',tmp_path)


@pytest.mark.parametrize('operation',['controlnet','multi_reference'])
@pytest.mark.parametrize('cancel',[False,True])
def test_conditioning_passes_actual_inputs_and_cleans_on_cancel(tmp_path,monkeypatch,operation,cancel):
    import torch
    from services import image_generation
    from services.image_workflows import adapters
    calls=[]
    class Pipeline:
        @classmethod
        def from_pretrained(cls,path,**kwargs):
            assert kwargs['local_files_only'] and kwargs['use_safetensors'];return cls()
        def load_ip_adapter(self,*args,**kwargs):
            assert kwargs['local_files_only'];calls.append('adapter')
        def set_ip_adapter_scale(self,value): calls.append(('scale',value))
        def enable_vae_slicing(self): pass
        def enable_vae_tiling(self): pass
        def enable_sequential_cpu_offload(self): calls.append('sequential')
        def enable_model_cpu_offload(self): calls.append('offload')
        def set_progress_bar_config(self,**kwargs): pass
        def maybe_free_model_hooks(self): calls.append('free')
        def remove_all_hooks(self): calls.append('remove')
        def __call__(self,**kwargs):
            calls.append(kwargs)
            if cancel: ctx.cancel_event.set()
            kwargs['callback_on_step_end'](self,0,None,{})
            return SimpleNamespace(images=[Image.new('RGB',(256,256),'red')])
    monkeypatch.setitem(sys.modules,'diffusers',SimpleNamespace(ControlNetModel=Pipeline,
        StableDiffusionXLControlNetImg2ImgPipeline=Pipeline,StableDiffusionXLImg2ImgPipeline=Pipeline))
    monkeypatch.setitem(sys.modules,'transformers',SimpleNamespace(CLIPVisionModelWithProjection=Pipeline))
    monkeypatch.setattr(torch.cuda,'is_available',lambda:True)
    monkeypatch.setattr(torch.cuda,'empty_cache',lambda:None)
    monkeypatch.setattr(torch,'Generator',lambda *a:SimpleNamespace(manual_seed=lambda s:s))
    monkeypatch.setattr(image_generation.manager,'_unload',lambda:None)
    monkeypatch.setattr(adapters,'sdxl_models',lambda:[{'id':'test','path':str(tmp_path)}])
    monkeypatch.setattr(advanced,'require_assets',lambda *a,**k:tmp_path)
    req=request(tmp_path,operation,control_input='source');ctx=context(tmp_path)
    ref2=tmp_path/'second.png';Image.new('RGB',(32,32),'green').save(ref2)
    req=PreparedStage(req.stage,req.prompt_settings,req.source,None,None,(req.source,ref2))
    monkeypatch.setattr(advanced,'canny_map',lambda *a:Image.new('RGB',(256,256),'white'))
    provider=advanced.ConditioningProvider(operation)
    if cancel:
        with pytest.raises(WorkflowCancelled): provider.generate(req,ctx)
        assert not list(ctx.output_dir.iterdir())
    else:
        result=provider.generate(req,ctx)
        assert len(result.image_paths)==1
        assert result.metadata['conditioning_applied'] is True
    args=next(c for c in calls if isinstance(c,dict))
    if operation=='multi_reference':
        assert len(args['ip_adapter_image'])==1 and len(args['ip_adapter_image'][0])==2
        assert ('scale',.6) in calls
    else: assert args['controlnet_conditioning_scale']==1
    assert calls[-2:]==['free','remove']


@pytest.mark.parametrize('cancel',[False,True])
def test_trained_upscaler_tiles_without_seams_preserves_alpha_and_cancel(tmp_path,monkeypatch,cancel):
    import torch
    from services import image_generation
    class Model:
        scale=4;input_channels=3;output_channels=3
        def to(self,*a): return self
        def eval(self): return self
        def __call__(self,tensor):
            return torch.nn.functional.interpolate(tensor,scale_factor=4,mode='nearest')
    monkeypatch.setitem(sys.modules,'spandrel',SimpleNamespace(ImageModelDescriptor=Model,
        ModelLoader=lambda:SimpleNamespace(load_from_file=lambda _:Model())))
    monkeypatch.setattr(torch.cuda,'is_available',lambda:False)
    monkeypatch.setattr(image_generation.manager,'_unload',lambda:None)
    monkeypatch.setattr(advanced,'require_assets',lambda *a,**k:tmp_path)
    req=request(tmp_path,'upscale',upscale_factor=4)
    source=Image.new('RGBA',(401,213),(30,80,120,123));source.save(req.source)
    ctx=context(tmp_path)
    ctx=ExecutionContext(ctx.request_id,ctx.output_dir,ctx.cancel_event,
        lambda **kw:ctx.cancel_event.set() if cancel else None)
    if cancel:
        with pytest.raises(WorkflowCancelled): advanced.RealESRGANProvider().upscale(req,ctx)
        assert not list(ctx.output_dir.iterdir())
    else:
        result=advanced.RealESRGANProvider().upscale(req,ctx)
        with Image.open(result.image_paths[0]) as image:
            assert image.size==(1604,852) and image.mode=='RGBA'
            assert ImageChops.difference(image,source.resize(image.size)).getbbox() is None
