"""Translate sd.cpp diagnostics into bounded, prompt-free job progress."""
import re


class RuntimeProgress:
    def __init__(self, args, report):
        self.report = report
        self.steps = int(args[args.index('--steps') + 1]) if '--steps' in args else 0
        self.experts = 2 if '--high-noise-diffusion-model' in args else 1
        self.total = self.steps * self.experts
        self.expert = 0
        self.step = 0
        self.phase = 'Loading model'
        self.sampling = False

    def emit(self, **detail):
        self.report(self.phase, self.step, self.total, **detail)

    def feed(self, line):
        line = re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', line)
        lower = line.lower()
        # Startup inventory contains "encoding / decoding" and "sampling using";
        # neither means the runtime has actually reached those stages.
        if re.search(r'generate_(video|image)\s+\d+x\d+|generating image:', lower):
            self.phase = 'Generating'; self.sampling = True; self.emit()
        elif 'sampling(high noise) completed' in lower:
            self.expert = min(1, self.experts - 1)
            self.step = self.steps * self.expert
            self.emit(detail='Switching to the second video expert')
        elif re.search(r'generating (?:\d+ )?latent', lower) and 'completed' in lower:
            self.phase = 'Decoding output'; self.sampling = False; self.emit()
        elif 'decode_first_stage completed' in lower:
            self.phase = 'Saving output'; self.sampling = False; self.emit()
        elif 'encode_first_stage completed' in lower or 't5 build' in lower:
            self.phase = 'Encoding prompt'; self.emit()
        elif 'wan_vae build' in lower and not self.sampling and self.phase != 'Decoding output':
            self.phase = 'Encoding reference'; self.emit()
        elif re.search(r'\b(?:loading tensors|memory-mapped)\b', lower) or re.search(r'\b[mg]b/s\b', lower):
            self.emit(detail='Loading/offloading model tensors; memory or disk transfers can be slow')
        else:
            match = re.search(r'(\d+)\s*/\s*(\d+)\s*[-|]', line)
            rate = re.search(r'([\d.]+)\s*(s/it|it/s)', line)
            if match and rate and self.sampling and int(match[2]) == self.steps:
                current = int(match[1])
                if not 0 < current <= self.steps:
                    return
                self.step = max(self.step, self.expert * self.steps + current)
                speed = float(rate[1])
                seconds_per_step = speed if rate[2] == 's/it' else 1 / speed if speed else None
                self.emit(seconds_per_step=seconds_per_step,
                          detail=f'Expert {self.expert + 1} of {self.experts}' if self.experts > 1 else '')
