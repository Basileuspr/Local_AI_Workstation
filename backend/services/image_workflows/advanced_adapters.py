"""Local ControlNet, IP-Adapter, outpainting and tiled trained super-resolution."""
import gc
import hashlib
import math
import time
import uuid

from PIL import Image, ImageOps

from services.upload_images import open_upload_image
from .addon_models import require_assets
from .providers import StageResult


def read_rgb(path, size=None):
    with open_upload_image(path) as original:
        image = ImageOps.exif_transpose(original).convert('RGB')
    return image.resize(size, Image.Resampling.LANCZOS) if size else image


def canny_map(source, low=100, high=200):
    import cv2
    import numpy as np
    return Image.fromarray(cv2.Canny(np.asarray(source.convert('RGB')), low, high)).convert('RGB')


def outpaint_inputs(source, stage):
    """Fit inside the requested canvas, extend boundary pixels, and mask only outside."""
    import numpy as np
    left, right, top, bottom = stage.outpaint_left, stage.outpaint_right, stage.outpaint_top, stage.outpaint_bottom
    size = (stage.width - left - right, stage.height - top - bottom)
    if min(size) <= 0 or not any((left, right, top, bottom)):
        raise ValueError('Outpainting requires positive borders and a nonempty source area.')
    fitted = source.convert('RGB').resize(size, Image.Resampling.LANCZOS)
    canvas = Image.fromarray(np.pad(np.asarray(fitted), ((top, bottom), (left, right), (0, 0)), mode='edge'))
    mask = Image.new('L', canvas.size, 255)
    mask.paste(0, (left, top, left + size[0], top + size[1]))
    return canvas, mask, fitted, (left, top)


def save_result(image, context, metadata):
    context.check_cancelled()
    path = context.output_dir / f'{uuid.uuid4().hex}.png'
    image.save(path, 'PNG')
    try:
        context.check_cancelled()
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return StageResult((path,), metadata=metadata)


class OutpaintProvider:
    key = 'local-sdxl-outpaint'
    operations = frozenset({'outpaint'})

    async def execute(self, request, context):
        from .adapters import thread_work
        return await thread_work(self.generate, request, context)

    def generate(self, request, context):
        from .adapters import SDXLProvider
        from .providers import PreparedStage
        context.check_cancelled()
        canvas, mask, fitted, position = outpaint_inputs(read_rgb(request.source), request.stage)
        # Temporary prepared inputs are owned by this stage, never source files.
        source_path = context.output_dir / f'{uuid.uuid4().hex}.png'
        mask_path = context.output_dir / f'{uuid.uuid4().hex}.png'
        try:
            canvas.save(source_path)
            mask.save(mask_path)
            stage = request.stage.model_copy(update={'operation': 'inpaint', 'strength': 1.0})
            result = SDXLProvider().generate(PreparedStage(stage, request.prompt_settings, source_path, mask_path, None, ()), context)
            with Image.open(result.image_paths[0]) as image:
                output = image.convert('RGB')
            output.paste(fitted, position)  # Exact fitted-source pixel preservation.
            context.check_cancelled()
            output.save(result.image_paths[0], 'PNG')
            context.check_cancelled()
            return StageResult(result.image_paths, metadata={**result.metadata, 'provider': self.key,
                'source_box': [*position, position[0] + fitted.width, position[1] + fitted.height],
                'preserves_fitted_source': True, 'source_was_resized': read_rgb(request.source).size != fitted.size})
        finally:
            source_path.unlink(missing_ok=True)
            mask_path.unlink(missing_ok=True)


class ConditioningProvider:
    def __init__(self, operation):
        self.operation = operation
        self.key = 'local-sdxl-controlnet' if operation == 'controlnet' else 'local-sdxl-ip-adapter'
        self.operations = frozenset({operation})

    async def execute(self, request, context):
        from .adapters import thread_work
        return await thread_work(self.generate, request, context)

    def generate(self, request, context):
        import torch
        from services.image_generation import manager
        from services.image_generation_limits import current_resolution_limits, validate_dimensions
        from .adapters import sdxl_models
        stage, prompt = request.stage, request.prompt_settings
        validate_dimensions(stage.width, stage.height, stage.allow_long_wait, current_resolution_limits())
        model = next((m for m in sdxl_models() if m['id'] == stage.model_id), None)
        if model is None:
            raise ValueError('Select an installed SDXL base model.')
        if not torch.cuda.is_available():
            raise ValueError('This conditioning adapter requires CUDA.')
        if stage.operation == 'controlnet' and stage.control_kind != 'edges':
            raise ValueError('Only Canny-edge ControlNet is supported.')
        if stage.operation == 'multi_reference' and not request.references:
            raise ValueError('Choose at least one reference image.')
        context.check_cancelled()
        source = read_rgb(request.source, (stage.width, stage.height))
        if stage.strength == 0:
            return save_result(source, context, {'provider': self.key, 'conditioning_applied': False, 'reason': 'Strength is zero.'})
        addon = require_assets('controlnet-canny-sdxl' if self.operation == 'controlnet' else 'ip-adapter-plus-sdxl')
        pipeline = controlnet = encoder = result = None
        args = {}
        started = time.monotonic()
        context.progress(phase='Loading local conditioning model', step=0, total_steps=prompt.steps)
        # Own the manager lock for the complete lifetime of these transient modules.
        with manager._lock:
            manager._unload()
            try:
                common = dict(torch_dtype=torch.float16, local_files_only=True, use_safetensors=True, add_watermarker=False)
                if self.operation == 'controlnet':
                    from diffusers import ControlNetModel, StableDiffusionXLControlNetImg2ImgPipeline
                    controlnet = ControlNetModel.from_pretrained(addon, variant='fp16', torch_dtype=torch.float16, local_files_only=True, use_safetensors=True)
                    context.check_cancelled()
                    pipeline = StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained(model['path'], controlnet=controlnet, **common)
                    control = read_rgb(request.control, source.size) if stage.control_input == 'map' else canny_map(source, stage.canny_low, stage.canny_high)
                    args.update(control_image=control, controlnet_conditioning_scale=stage.control_scale)
                else:
                    from diffusers import StableDiffusionXLImg2ImgPipeline
                    from transformers import CLIPVisionModelWithProjection
                    encoder = CLIPVisionModelWithProjection.from_pretrained(addon / 'models/image_encoder', torch_dtype=torch.float16, local_files_only=True, use_safetensors=True)
                    context.check_cancelled()
                    pipeline = StableDiffusionXLImg2ImgPipeline.from_pretrained(model['path'], image_encoder=encoder, **common)
                    pipeline.load_ip_adapter(str(addon), subfolder='sdxl_models', weight_name='ip-adapter-plus_sdxl_vit-h.safetensors', image_encoder_folder=None, local_files_only=True)
                    pipeline.set_ip_adapter_scale(stage.reference_scale)
                    # One adapter; the nested list pools every selected reference.
                    args['ip_adapter_image'] = [[read_rgb(path) for path in request.references]]
                context.check_cancelled()
                pipeline.enable_vae_slicing()
                pipeline.enable_vae_tiling()
                if self.operation == 'controlnet' or stage.allow_long_wait:
                    pipeline.enable_sequential_cpu_offload()
                else:
                    pipeline.enable_model_cpu_offload()
                pipeline.set_progress_bar_config(disable=True)
                total = max(1, int(prompt.steps * stage.strength))
                def callback(_pipeline, step, _timestep, values):
                    context.check_cancelled()
                    context.progress(phase='Applying image conditioning', step=step + 1, total_steps=total)
                    return values
                args.update(image=source, width=stage.width, height=stage.height, strength=stage.strength,
                    prompt=prompt.prompt, negative_prompt=prompt.negative_prompt or None,
                    num_inference_steps=prompt.steps, guidance_scale=prompt.guidance,
                    generator=torch.Generator('cpu').manual_seed(prompt.seed), callback_on_step_end=callback)
                context.check_cancelled()
                result = pipeline(**args)
                context.check_cancelled()
                image = result.images[0].convert('RGB')
                if image.size != source.size:
                    raise ValueError('Conditioning returned unexpected image dimensions.')
                return save_result(image, context, {'provider': self.key, 'model_id': stage.model_id,
                    'seed': prompt.seed, 'steps': prompt.steps, 'strength': stage.strength,
                    'conditioning_applied': True, 'control_input': stage.control_input if self.operation == 'controlnet' else None,
                    'control_scale': stage.control_scale if self.operation == 'controlnet' else None,
                    'reference_count': len(request.references) if self.operation == 'multi_reference' else 0,
                    'reference_scale': stage.reference_scale if self.operation == 'multi_reference' else None,
                    'reference_sha256': [hashlib.sha256(p.read_bytes()).hexdigest() for p in request.references],
                    'elapsed_seconds': round(time.monotonic() - started, 3)})
            finally:
                args.clear()
                result = None
                if pipeline is not None:
                    pipeline.maybe_free_model_hooks()
                    pipeline.remove_all_hooks()
                pipeline = controlnet = encoder = None
                gc.collect()
                torch.cuda.empty_cache()


class RealESRGANProvider:
    key = 'local-realesrgan'
    operations = frozenset({'upscale'})

    async def execute(self, request, context):
        from .adapters import thread_work
        return await thread_work(self.upscale, request, context)

    def upscale(self, request, context):
        import numpy as np
        import torch
        from spandrel import ModelLoader, ImageModelDescriptor
        from services.image_generation import manager
        context.check_cancelled()
        root = require_assets('realesrgan-x4plus', verify_hashes=True)
        with open_upload_image(request.source) as original:
            oriented = ImageOps.exif_transpose(original)
            alpha = oriented.convert('RGBA').getchannel('A') if 'A' in oriented.getbands() or 'transparency' in oriented.info else None
            source = oriented.convert('RGB')
        factor = request.stage.upscale_factor
        if source.width * source.height * factor ** 2 > 24_000_000:
            raise ValueError('Upscale output exceeds 24 megapixels.')
        model = tile = prediction = None
        started = time.monotonic()
        with manager._lock:
            manager._unload()
            try:
                model = ModelLoader().load_from_file(str(root / 'RealESRGAN_x4plus.pth'))
                if not isinstance(model, ImageModelDescriptor) or model.scale != 4 or model.input_channels != 3 or model.output_channels != 3:
                    raise ValueError('Unsupported upscaler architecture.')
                device = 'cuda' if torch.cuda.is_available() else 'cpu'
                model = model.to(device).eval()  # FP32 avoids portrait artifacts on some GPUs.
                context.check_cancelled()
                array = np.asarray(source)
                output = Image.new('RGB', (source.width * 4, source.height * 4))
                tile_size, padding = 192, 24
                total = math.ceil(source.width / tile_size) * math.ceil(source.height / tile_size)
                count = 0
                with torch.inference_mode():
                    for y in range(0, source.height, tile_size):
                        for x in range(0, source.width, tile_size):
                            context.check_cancelled()
                            x1, y1 = min(x + tile_size, source.width), min(y + tile_size, source.height)
                            a, b, c, d = max(0, x - padding), max(0, y - padding), min(source.width, x1 + padding), min(source.height, y1 + padding)
                            tile = torch.from_numpy(array[b:d, a:c].copy()).permute(2, 0, 1).unsqueeze(0).float().div_(255).to(device)
                            prediction = model(tile).clamp_(0, 1)
                            rgb = prediction[0].permute(1, 2, 0).mul(255).round().byte().cpu().numpy()
                            patch = Image.fromarray(rgb).crop(((x-a)*4, (y-b)*4, (x1-a)*4, (y1-b)*4))
                            output.paste(patch, (x*4, y*4))
                            tile = prediction = None
                            count += 1
                            context.progress(phase=f'Trained Real-ESRGAN upscaling ({device})', step=count, total_steps=total)
                context.check_cancelled()
                size = (source.width * factor, source.height * factor)
                if factor != 4:
                    output = output.resize(size, Image.Resampling.LANCZOS)
                if alpha is not None:
                    output.putalpha(alpha.resize(size, Image.Resampling.LANCZOS))
                return save_result(output, context, {'provider': self.key, 'model': 'RealESRGAN_x4plus', 'native_scale': 4,
                    'output_scale': factor, 'tile_size': tile_size, 'tile_padding': padding, 'device': device,
                    'alpha_method': 'Lanczos' if alpha is not None else None, 'elapsed_seconds': round(time.monotonic()-started, 3)})
            finally:
                model = tile = prediction = None
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
