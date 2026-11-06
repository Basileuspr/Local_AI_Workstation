"""Explicit real-GPU photo acceptance through the normal workflow runner.

Keep --output outside the repository. Inputs are decoded into independent PNGs;
private pictures, outputs and evidence are never test fixtures or source files.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--photos', type=Path, nargs=2, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--steps', type=int, default=16)
    parser.add_argument('--cases', nargs='*')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(ROOT.resolve()):
        parser.error('Keep personal-photo acceptance output outside the repository.')
    output.mkdir(parents=True, exist_ok=True)
    for key, value in {'LAW_DATA_DIR': output/'app-data', 'LAW_LOG_DIR': output/'logs',
                       'LAW_IMAGE_MANAGER_DIR': output/'catalog', 'LAW_MODELS_DIR': ROOT/'models'}.items():
        os.environ[key] = str(value.resolve())
    # All weights were installed explicitly; loading may never fetch a fallback.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    sys.path.insert(0, str(ROOT/'backend'))
    from PIL import Image, ImageOps, ImageChops, ImageStat
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass
    from services.image_workflows import store, runner, adapters
    from services.image_workflows.contracts import UpdateRequest
    from services.image_workflows.advanced_adapters import canny_map, outpaint_inputs
    from services.image_generation import manager as image_manager
    from services.gpu_coordination import gpu_coordinator
    adapters.vision_models = lambda: []  # This acceptance suite performs no vision-model discovery.
    inputs=[]
    for index, photo in enumerate(args.photos, 1):
        digest=hashlib.sha256(photo.read_bytes()).hexdigest()
        with Image.open(photo) as original:
            image=ImageOps.exif_transpose(original).convert('RGB')
            image.save(output/f'photo-{index}.png')
            preview=image.copy();preview.thumbnail((1000,1000));preview.save(output/f'photo-{index}-preview.png')
            image.thumbnail((512,512))
            size=tuple(max(256,round(n/8)*8) for n in image.size)
            image=image.resize(size); image.save(output/f'photo-{index}-working.png')
        inputs.append({'index':index,'source_name':photo.name,'sha256':digest,'working_size':list(size)})
    (output/'inputs.json').write_text(json.dumps(inputs,indent=2),encoding='utf-8')
    cases=[]
    for index in (1,2):
        for operation, provider in [('controlnet','local-sdxl-controlnet'),('outpaint','local-sdxl-outpaint'),('upscale','local-realesrgan')]:
            cases.append((f'{operation}-{index}', index, operation, provider, []))
    for name,refs in [('multi-both',[1,2]),('multi-first',[1]),('multi-second',[2])]:
        cases.append((name,2,'multi_reference','local-sdxl-ip-adapter',refs))
    results_path=output/'results.json'
    results=json.loads(results_path.read_text()) if results_path.exists() else []

    async def execute():
        for name,index,operation,provider,references in cases:
            if args.cases and name not in args.cases:
                continue
            start=time.monotonic()
            receipt={'case':name,'operation':operation,'photo':index,'status':'failed'}
            print(json.dumps({'case':name,'status':'starting'}),flush=True)
            try:
                workflow=store.create(f'Photo acceptance: {name}')
                for n in (1,2):
                    path=output/f'photo-{n}{"" if operation == "upscale" else "-working"}.png'
                    workflow=store.add_asset(workflow.id,workflow.revision,path.name,path.read_bytes())
                asset=workflow.assets[index-1]
                width,height=asset.width,asset.height
                if operation=='upscale': width,height=512,512  # Unused by the upscaler.
                if operation=='outpaint': width+=128; height+=128
                stage={'id':uuid.uuid4().hex,'operation':operation,'provider_slot':provider,'model_id':args.model,
                    'source':{'kind':'asset','id':asset.id},'width':width,'height':height,'strength':0.35 if operation=='multi_reference' else 0.65,
                    'control_input':'source','control_scale':0.8,'reference_scale':0.55,
                    'reference_asset_ids':[workflow.assets[n-1].id for n in references]}
                prompt=('A natural photograph of a man taking a mirror selfie indoors, realistic room walls and ceiling, consistent soft lighting' if operation=='outpaint' else
                        'A detailed watercolor portrait of a man taking a mirror selfie, blue and gold palette, textured paper, recognizable facial structure')
                if operation=='multi_reference':
                    prompt='A natural photographic portrait of a man with wavy brown hair and a short beard, blue sweater, soft window light'
                body=workflow.model_dump(include={'name','scene_notes','prompt_settings','stages'})
                body.update(revision=workflow.revision,stages=[stage],prompt_settings={'prompt':prompt,'negative_prompt':'distorted face, extra fingers, blurry, duplicate person','seed':123,'steps':args.steps,'guidance':5})
                workflow=store.update(workflow.id,UpdateRequest(**body))
                receipt.update(workflow_id=workflow.id,prompt=prompt,settings=workflow.stages[0].model_dump())
                if operation=='controlnet':
                    canny_map(Image.open(output/f'photo-{index}-working.png')).save(output/f'{name}-edges.png')
                record=await runner.manager.start(workflow.id,workflow.revision)
                last=None
                while record['status'] in runner.ACTIVE:
                    await asyncio.sleep(2)
                    record=runner.read_run(workflow.id,record['id'])
                    state=(record['phase'],record['step'])
                    if state!=last:
                        print(json.dumps({'case':name,'phase':state[0],'step':state[1],'total':record['total_steps']}),flush=True)
                        last=state
                receipt.update(run=record,elapsed_seconds=round(time.monotonic()-start,2))
                if record['status']!='completed':
                    raise RuntimeError(record.get('error') or record['status'])
                path,metadata=runner.output_path(workflow.id,record['id'],record['outputs'][0]['id'])
                shutil.copyfile(path,output/f'{name}.png')
                with Image.open(path) as image:
                    image.load()
                    assert max(ImageStat.Stat(image).stddev)>3, 'Blank output'
                    receipt['output_dimensions']=list(image.size)
                    if operation=='outpaint':
                        canvas,mask,fitted,position=outpaint_inputs(Image.open(output/f'photo-{index}-working.png'),workflow.stages[0])
                        box=(*position,position[0]+fitted.width,position[1]+fitted.height)
                        assert ImageChops.difference(image.crop(box),fitted).getbbox() is None, 'Source interior changed'
                        delta=sum(ImageStat.Stat(ImageChops.difference(image,canvas),mask).mean)/3
                        assert delta>1,'No generated border change'
                        receipt.update(source_interior_exact=True,border_mean_change=delta,source_box=box)
                    if operation=='upscale':
                        with Image.open(output/f'photo-{index}.png') as original:
                            assert image.size==(original.width*2,original.height*2)
                            baseline=original.resize(image.size,Image.Resampling.LANCZOS)
                        delta=sum(ImageStat.Stat(ImageChops.difference(image.convert('RGB'),baseline)).mean)/3
                        assert delta>0.1,'Output matches interpolation'
                        receipt['difference_from_lanczos']=delta
                receipt.update(status='passed',output=f'{name}.png',sha256=metadata['sha256'])
            except Exception as exc:
                receipt['error']=str(exc)
                import traceback
                traceback.print_exc()
            finally:
                image_manager.unload_for_training()
                receipt['gpu_lease_released']=gpu_coordinator.current_owner() is None
                results[:]=[r for r in results if r['case']!=name]+[receipt]
                results_path.write_text(json.dumps(results,indent=2),encoding='utf-8')
                print(json.dumps({k:receipt.get(k) for k in ('case','status','error','elapsed_seconds','gpu_lease_released')}),flush=True)
        for i,p in enumerate(args.photos):
            assert hashlib.sha256(p.read_bytes()).hexdigest()==inputs[i]['sha256'],'Original photo changed'
    asyncio.run(execute())
    return 0 if all(r['status']=='passed' for r in results) else 1


if __name__=='__main__':
    raise SystemExit(main())
