"""One model per process; incompatible third-party libraries stay isolated."""
import json
from pathlib import Path
import sys


def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    import numpy as np
    import soundfile as sf
    import torch
    torch.set_num_threads(request['threads'])
    device = request['device']
    dtype = torch.float16 if device == 'cuda' else torch.float32
    with torch.inference_mode():
        if request['engine'] == 'omnivoice':
            from omnivoice import OmniVoice
            model = OmniVoice.from_pretrained(request['model'], device_map=device, dtype=dtype,
                                              attn_implementation='sdpa', local_files_only=True)
            audios = model.generate(text=request['text'], language=request['language'],
                ref_audio=request['reference'], ref_text=request['reference_text'])
            waveform, rate = audios[0], model.sampling_rate
        elif request['engine'] == 'chatterbox-turbo':
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            model = ChatterboxTurboTTS.from_local(request['model'], device=device)
            waveform = model.generate(request['text'], audio_prompt_path=request['reference'])
            rate = model.sr  # Preserve the upstream PerTh watermark.
        elif request['engine'] == 'qwen3-tts':
            from qwen_tts import Qwen3TTSModel
            model = Qwen3TTSModel.from_pretrained(request['model'], device_map=device,
                dtype=torch.bfloat16 if device == 'cuda' else dtype, attn_implementation='sdpa', local_files_only=True)
            audios, rate = model.generate_voice_clone(text=request['text'], language=request['language'],
                ref_audio=request['reference'], ref_text=request['reference_text'], max_new_tokens=2048)
            waveform = audios[0]
        else:
            raise ValueError('Unsupported voice engine')
    if isinstance(waveform, torch.Tensor):
        waveform = waveform.detach().float().cpu().numpy()
    waveform = np.asarray(waveform).squeeze()
    if waveform.ndim != 1 or not len(waveform) or not np.isfinite(waveform).all():
        raise ValueError('Invalid generated waveform')
    sf.write(request['output'], waveform, rate, subtype='PCM_16')


if __name__ == '__main__':
    main()
