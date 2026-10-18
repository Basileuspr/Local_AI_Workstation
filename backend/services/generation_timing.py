"""Per-request wall timings, synchronized only at pipeline stage boundaries."""
from contextlib import contextmanager
from functools import wraps
import time


class GenerationTiming:
    def __init__(self):
        self.seconds = {}

    @contextmanager
    def measure(self, name, synchronize=None):
        if synchronize:
            synchronize()
        started = time.perf_counter()
        failed = False
        try:
            yield
        except BaseException:
            failed = True
            raise
        finally:
            if synchronize and not failed:
                synchronize()
            self.seconds[name] = self.seconds.get(name, 0) + time.perf_counter() - started

    def snapshot(self):
        return {key: round(value, 4) for key, value in self.seconds.items()}


class PipelineTiming:
    """Observe shared pipelines temporarily; never synchronize every denoising step."""
    def __init__(self, pipeline, timing, synchronize):
        self.pipeline, self.timing, self.synchronize = pipeline, timing, synchronize
        self.restores = []
        self.hook = None
        self.denoising_started = None

    def wrap(self, owner, attribute, stage):
        original = getattr(owner, attribute, None)
        if not callable(original):
            return
        owned = attribute in getattr(owner, '__dict__', {})

        @wraps(original)
        def measured(*args, **kwargs):
            with self.timing.measure(stage, self.synchronize):
                return original(*args, **kwargs)
        setattr(owner, attribute, measured)
        self.restores.append((owner, attribute, original, owned))

    def __enter__(self):
        try:
            self.wrap(self.pipeline, 'encode_prompt', 'prompt_encoding')
            vae = getattr(self.pipeline, 'vae', None)
            self.wrap(vae, 'encode', 'reference_encoding')
            self.wrap(vae, 'decode', 'decoding')
            self.wrap(self.pipeline, 'maybe_free_model_hooks', 'offload_cleanup')
            denoiser = getattr(self.pipeline, 'unet', None) or getattr(self.pipeline, 'transformer', None)
            if hasattr(denoiser, 'register_forward_pre_hook'):
                self.hook = denoiser.register_forward_pre_hook(self.start_denoising)
        except BaseException:
            self.restore()
            raise
        return self

    def start_denoising(self, *unused):
        if self.denoising_started is None:
            self.synchronize()
            self.denoising_started = time.perf_counter()

    def finish_denoising(self):
        if self.denoising_started is not None:
            self.synchronize()
            self.timing.seconds['denoising'] = self.timing.seconds.get('denoising', 0) + time.perf_counter() - self.denoising_started
            self.denoising_started = None

    def __exit__(self, *error):
        try:
            # A CUDA error can make synchronization fail too. Preserve the
            # inference/cancellation error and let the manager unload normally.
            if not error[0]:
                self.finish_denoising()
        finally:
            self.restore()

    def restore(self):
        if self.hook:
            self.hook.remove()
        for owner, attribute, original, owned in reversed(self.restores):
            if owned:
                setattr(owner, attribute, original)
            else:
                delattr(owner, attribute)
