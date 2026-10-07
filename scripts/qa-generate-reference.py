"""Opt-in real SDXL upload smoke. Run only while the desktop GPU queue is idle."""
import json
import os
from pathlib import Path
import sys
import tempfile
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model', required=True, help='Installed SDXL model ID; never infer a model from discovery order')
args = parser.parse_args()

output = Path(tempfile.mkdtemp(prefix="law-reference-smoke-"))
os.environ["LAW_DATA_DIR"] = str(output)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from PIL import Image, ImageChops
from services.image_generation import manager, discover_models
from services.generation_reference import store_reference

models = discover_models()
selected = next((model for model in models if model['id'] == args.model), None)
assert selected and selected.get('pipeline') != 'ErnieImagePipeline', 'Choose an installed SDXL model'
options = dict(model_id=selected["id"], prompt="a blue ceramic teapot on a wooden table, watercolor illustration",
               negative_prompt="blurry", width=512, height=512, steps=12, guidance_scale=5.5, seed=42)
print(json.dumps({"output": str(output), "model": options["model_id"]}), flush=True)
try:
    original = manager.generate(**options, request_id="reference-original")
    source = output / "generated_images" / original["filename"]
    reference = store_reference(source.name, source.read_bytes())["reference"]
    unet_id = id(manager._pipeline.unet)
    variation = manager.generate(**options, source_image_ref=reference, strength=.3, request_id="reference-variation")
    assert id(manager._active_pipeline.unet) == unet_id
    with Image.open(source) as first, Image.open(output / "generated_images" / variation["filename"]) as second:
        assert first.size == second.size == (512, 512)
        assert ImageChops.difference(first.convert("RGB"), second.convert("RGB")).getbbox() is not None
        assert json.loads(second.info["local_ai_generation"])["source_image_ref"] == reference
    print(json.dumps({"stage":"variation", "seconds":variation["generation_seconds"], "shared_weights":True}), flush=True)
    resumed = manager.generate(**{**options, "steps":4}, request_id="reference-text-again")
    long_options = {**options, "prompt": options["prompt"] + ", detailed glazed pottery" * 25, "allow_long_wait":True}
    long_result = manager.generate(**long_options, source_image_ref=reference, strength=.3, request_id="reference-long-prompt")
    assert long_result["long_prompt_used"]
    report = {"model":options["model_id"], "output":str(output), "size":[512,512],
              "shared_weights":True, "text_image_text_switch":True, "long_prompt_sequential_offload":True,
              "results":[{key:result[key] for key in ("filename", "generation_seconds", "peak_vram_bytes")} for result in (original,variation,resumed,long_result)]}
    (output / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)
finally:
    manager.unload_for_training()
