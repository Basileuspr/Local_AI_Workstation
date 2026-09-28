# Audio

Open **Workspace → Audio** for microphone recording, audio-file transcription,
and local text-to-speech. Chat has a **Microphone / audio** panel above its
message input and **Read aloud** controls on assistant messages.

Record → Stop recording → Transcribe audio → review/edit the transcript.
In chat, **Insert into message** appends the transcript to the existing draft;
it does not send it. File uploads use the same review flow. Copy or save the
transcript as a `.txt` file. Voice playback provides voice selection, speed,
pause, resume, and stop. Settings are shared with chat.

Enable **Separate speakers** to group a conversation into timestamped turns
such as **Speaker 1**, **Speaker 2**, and **Speaker 3**. Leave the count at
**Auto detect**, or set it when known. Voices are compared across the whole
recording, including long uploads. Labels can still be mistaken. Under the result, expand
**speaker labels · rename or correct** to rename voices. Edit a mistaken turn
or word directly in the transcript. Copy, Save, and Insert into message all
use that edited, labeled text.

These labels distinguish voices; they do not establish people's identities.
Short replies, similar voices, noise, and simultaneous speech may need manual
correction. Words without matching voice evidence are marked **Unknown speaker**;
ambiguous concurrent voices are marked **Unclear / overlapping**.

## Setup

Install the optional transcription runtime with the Python used by the app:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements-audio.txt
```

Restart the desktop app, choose a **Transcription model**, then use its download
button. **Whisper large-v3 Turbo** is the recommended default (~1.6 GB), with
**Processing → Auto** and **CPU assistance → Auto**. **Whisper small** (~500 MB)
and **Whisper base** (~150 MB) remain available for lower resource use.
The multilingual models are stored below `LAW_MODELS_DIR/audio/whisper-turbo`,
`whisper-small`, and `whisper-base` (default: `models/audio/...`). Missing
models require explicit setup; selecting one never silently uses another model.
Only this explicit setup action enables a network download, in a separate
process. Ordinary transcription requires local model files. Auto uses CUDA
with FP16 when a compatible NVIDIA GPU and libraries are available, or INT8
on CPU. The workstation's existing compatible PyTorch installation can supply
the CUDA libraries; CPU operation does not require PyTorch or CUDA.
Model setup and transcription are serialized; a second request receives a busy
message, while independent sections within a recording can run together.

GPU transcription acquires the same coordination lock used by image generation
and training, after CPU speaker analysis finishes. Low GPU memory, a busy GPU,
or unavailable CUDA produces a visible CPU fallback notice. Runtime GPU failure
retries the selected model on CPU; the app never substitutes a smaller model.
GPU weights move back to CPU before releasing the lock, preserving reusable
weights without keeping the GPU occupied between audio jobs. CPU fallback with
Turbo can be substantially slower; small is a lighter CPU option.
If memory is low while the audio job holds the GPU lock, the app first tries
its existing handoff to park idle image weights and unload idle Ollama models.
Running app jobs are not interrupted.

**CPU assistance** adjusts concurrency to physical cores and available memory.
Auto allows up to two transcription workers, four threads per worker, and four
speaker-analysis threads; Light uses one worker and up to two speaker threads.
Balanced allows up to four CPU workers and six speaker threads. All modes leave
CPU headroom, reduce worker count when RAM is limited, and cap GPU workers at two.
Work is bounded and results retain source order. Language detection runs before
parallel sections, and overlapping chunk ownership prevents duplicate words.
Changing concurrency does not lower decoding quality or change the chosen model.
The interface reports the actual device, workers, elapsed time, and final
transcription/speaker-analysis timings. Speaker analysis remains on CPU.

Speaker separation uses optional `sherpa-onnx` with local pyannote segmentation
and NeMo TitaNet Large embeddings. **Download speaker models (~110 MB)** explicitly
fetches the published model files into `LAW_MODELS_DIR/audio/speakers` and
validates them before installation. Ordinary runs do not download models or
send audio to a service. A separate CPU worker analyzes the complete recording
to compare voices across the entire file. The speaker detector then supplies
short speech regions for transcription, without applying a second silence
filter that could discard quiet voices. Word timestamps align the text with
speaker turns. A normal handoff between voices is distinct from simultaneous
speech, and intervening voice changes prevent neighboring turns being merged.
Temporary decoded audio and analysis
files are removed after completion. A long recording may take several minutes
and temporarily use several hundred MB of RAM/disk. If speaker analysis fails,
ordinary transcription is attempted and returned with a visible speaker error.
The older WeSpeaker model is no longer used; existing copies are preserved.

Text-to-speech uses installed system voices marked as local. If none are
available, install a Windows speech voice and restart. No cloud speech service
or API key is used. Microphone permission applies only to the trusted desktop
renderer; remote Browser pages and other isolated views retain their own
denied permissions.

## Bounds and behavior

- Uploads: 250 MB and 2 hours per file. Upload the whole recording; the backend
  automatically processes overlapping sections in bounded memory, joins the
  transcript using word timestamps, and reports the amount of audio processed.
  Microphone capture remains limited to 25 MB / 10 minutes per recording.
  Supports WAV, MP3, M4A,
  AAC, OGG, FLAC, WebM, and the first audio track in MP4.
- Transcription starts after recording ends; no live captions. Speaker mode
  detects voices first, then transcribes the detected speech regions.
- Choose a language when auto detection struggles with short recordings.
- Source files stay unchanged. Uploaded audio is held in temporary storage
  during the request and removed in the normal success/error cleanup path.
- **Save audio recording** downloads the selected or recorded audio unchanged,
  so microphone recordings can be kept and reused before closing the app.
- Navigating away, switching chats, or closing the recording panel stops and
  discards an unfinished recording. Completed recordings remain in that panel
  until removed or the panel is closed. Save transcripts before closing or
  refreshing the app. Transcription already submitted may finish in the backend.
- Text-to-speech reads up to 20,000 characters per action. Navigating away from
  its workspace or changing chats stops playback. Starting another reading
  replaces the previous one. Recording stops spoken output to reduce feedback.
- Check names, numbers, and unclear speech before relying on a transcript.

## Voice cloning

The **Voice cloning** section in Audio offers three local engines:

| Engine | Installed checkpoint | Reference transcript | Languages exposed in the app |
| --- | --- | --- | --- |
| [OmniVoice](https://github.com/k2-fsa/OmniVoice) | [k2-fsa/OmniVoice](https://huggingface.co/k2-fsa/OmniVoice) | Required | English, Chinese, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian |
| [Chatterbox Turbo](https://github.com/resemble-ai/chatterbox) | [ResembleAI/chatterbox-turbo](https://huggingface.co/ResembleAI/chatterbox-turbo) | Optional; engine uses audio | English |
| [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | [Qwen3-TTS-12Hz-0.6B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base) | Required | Same ten languages as above |

Choose **Record voice reference**, speak naturally for 10–20 seconds, then
**Stop and use recording**. Capture stops automatically at 20 seconds and
rejects recordings shorter than 6 seconds. Preview your recording and use
**Save reference recording** to keep its original WebM/OGG/M4A file for reuse.
You can also upload one clear voice, 6–30 seconds long and no more than 25 MB.
Recording a replacement keeps the previous reference until the new one is ready;
**Discard recording** or leaving Audio cancels capture, including a pending
microphone permission request.

Click **Demo this voice** to generate and automatically play a short sample in
the selected language. Enter your own text to demo that instead. OmniVoice and
Qwen automatically transcribe the reference if its transcript is blank; you can
also use **Transcribe reference** and review/correct the words first. Chatterbox
uses the audio alone. Demo playback starts after local generation finishes;
this is not streaming voice conversion. Leaving Audio suppresses pending demo
playback and stops the transcription-to-generation chain before its next job.
If automatic playback is blocked, the finished audio still has a Play control.

For up to 1,500 characters of new text, **Generate cloned voice** creates speech
for manual playback. Both modes offer **Save generated WAV**. A whole meeting with multiple speakers is not a
suitable voice reference. Use your own voice or one you have permission to use.
Chatterbox's built-in PerTh watermark is preserved.

Each engine has a separate Python 3.11 environment because their PyTorch and
Transformers requirements conflict. These environments and pinned GitHub source
checkouts live under `LAW_MODELS_DIR/audio/voice-cloning`, alongside the weights.
They do not change the app's main Python environment. Workers load local model
paths with Hugging Face offline mode enabled; ordinary synthesis downloads
nothing. The worker exits after each request, releasing GPU allocations before
the shared GPU lock is released. Auto can fall back to CPU with a visible notice;
CPU synthesis may take several minutes. The app permits one cloning request at
a time and stops a worker that exceeds ten minutes.

Reference uploads and generated server WAVs use temporary storage and are removed
after the response or a handled failure. The returned WAV stays in the browser
until saved or the page is closed/refreshed. It is not sent into chat automatically.
The existing system-voice Read aloud controls remain available.

To install/reinstall the pinned engines on Windows, with Python 3.11 and Git,
first install the shared audio decoder/transcription runtime in the app's Python:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements-audio.txt
powershell -ExecutionPolicy Bypass -File scripts/install-voice-models.ps1
# Optional: install only one engine, or use a custom LAW_MODELS_DIR location.
powershell -ExecutionPolicy Bypass -File scripts/install-voice-models.ps1 -Model qwen3-tts -ModelsDir D:\Models
```

Model weights require about 9 GB; allow roughly 30–40 GB overall for the three
CUDA runtimes, dependencies, and download caches. The unused legacy Chatterbox
`s3gen.safetensors` is omitted; Turbo uses `s3gen_meanflow.safetensors`. Source and
model revisions are pinned in the installer, and an installation receipt is
written only after imports and dependency checks pass. Incomplete installation
is shown in Audio. Fully quit the desktop app from its tray and reopen after
updating app code; model-only installations can be refreshed by reopening Audio.

## Verification

```powershell
npm run test -- tests/frontend/audio.test.js
.\venv\Scripts\python.exe -m pytest tests/backend/test_audio.py -q
.\venv\Scripts\python.exe -m pytest tests/backend/test_speaker_diarization.py -q
.\venv\Scripts\python.exe -m pytest tests/backend/test_audio_acceleration.py -q
npx vite build --config tests/fixtures/audio.config.mjs
.\node_modules\.bin\electron.cmd scripts\qa-audio.cjs
```

The desktop fixture uses a private temporary profile, a simulated microphone,
and a mocked transcription API. It checks real Electron capture, playback
preview, recording cleanup on navigation, transcript insertion, real local
voice synthesis at zero volume, and playback controls. It never captures the
user's microphone or modifies the running app. Inference should also be tested
with a known speech WAV using the real local model. Passing interface tests
or producing the requested number of labels does not establish speaker accuracy.

For the recording-to-cloned-demo flow, use an existing synthetic speech WAV
(the fixture never opens the physical microphone):

```powershell
.\node_modules\.bin\electron.cmd scripts\qa-voice-recording.cjs "C:\path\synthetic-speech.wav"
```

This fixture captures the WAV through Electron's simulated microphone, verifies
the 20-second limit and reference download, and runs real local Whisper and
OmniVoice inference followed by automatic muted playback. It also checks short
recordings, microphone cleanup, and cancellation. Later navigation, permission,
generation-error, and blocked-playback cases use explicit mocks. Reports and
recorded/generated audio go under `artifacts/voice-recording-smoke`.

To verify an actual long file through the desktop upload controls and real
authenticated audio API, run the following after building the fixture above:

```powershell
.\node_modules\.bin\electron.cmd scripts\qa-audio-upload.cjs "C:\path\recording.m4a"
```

This second fixture submits the original file once, checks the UI transcript
against the real API result, verifies that the source hash is unchanged, and
saves the transcript under the ignored `artifacts/audio-transcription` folder.
It uses a separate temporary desktop profile and API process.
Its summary includes actual processing settings and elapsed time.

Append the known speaker count (or `0` for Auto detect) to verify speaker
separation end to end, for example:

```powershell
.\node_modules\.bin\electron.cmd scripts\qa-audio-upload.cjs "C:\path\recording.m4a" 3
```

For an opt-in accuracy comparison, the following script downloads 64 fixed
public LibriSpeech clips with known transcripts (eight speakers, both clean
and other test splits). It never uploads recordings. Run comparisons separately
while other inference jobs are idle; both models must already be installed.
Results include normalized word error rate and inference/decode time, excluding
model loading, under `tmp/audio-bench/reference-64`. This small read-speech test
does not establish accuracy for a noisy conversation or speaker labels.

```powershell
.\venv\Scripts\python.exe scripts/benchmark-audio-accuracy.py --model small --device cpu
.\venv\Scripts\python.exe scripts/benchmark-audio-accuracy.py --model turbo --device cuda
```

Engine: [Faster Whisper](https://github.com/SYSTRAN/faster-whisper).
Speaker engine and published model sources:
[sherpa-onnx speaker diarization](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html),
[TitaNet embeddings](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models).
