# Audio

Open **Workspace → Audio** for video-to-audio extraction, microphone recording,
audio-file transcription, and local text-to-speech. Chat has a **Microphone / audio** panel above its
message input and **Speak** controls on assistant messages.

Chat assistant messages now have **Speak / Stop** controls for the existing cloned
voice engines. In **Audio → Voice cloning**, choose an engine, record or upload a
6–30 second reference, review its transcript, then choose **Use this voice for
chat**. This explicitly saves the reference in the existing shared audio library.
The original recording is preserved. Engine, language, processing choice and
reference transcript are retained in the normal application preferences.

Open **Settings → Voice Output** to select a saved reference or enable
**Automatically speak assistant responses**. Automatic speech defaults to off
and stays off after restarting when disabled. Only newly completed, successful
responses in the visible chat are spoken automatically; reopening history does
not replay it. Leaving the chat, changing its voice, or choosing Stop cancels
pending speech and playback. Submitting another chat request remains possible.

Speech uses one completed-response synthesis request, up to the existing
**1,500-character** limit after removing Markdown formatting. Longer responses
show a useful error without changing their text; paste a shorter passage into
Audio to speak it. Speech failures never replace the chat response or retry
automatically. Generated chat audio is temporary and is released when playback
ends or stops. Standalone Windows-voice read-aloud and cloned-voice generation
remain available in Audio. This does not change microphone or transcription
behavior.

After building the app, verify the production chat integration in an isolated
Electron profile and temporary backend storage:

```powershell
.\node_modules\.bin\electron.cmd scripts/qa-chat-speech.cjs
```

This check uses synthetic chat and voice inference with real muted HTML audio
playback. It covers Speak/Stop, cancellation, errors, automatic speech,
preferences after reload, the saved voice catalogue, and standalone cloning.
Reports and screenshots are saved under `artifacts/chat-speech-smoke`.

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

## Extract audio from a video

In **Audio → Extract audio from video**, choose or drop a video, select **MP3**,
**WAV**, **M4A**, or **FLAC**, then click **Extract audio**. Preview the result,
use **Save extracted audio** to keep it, or **Use for transcription** to load it
into Speech to text. Loading it does not start transcription; choose settings
and click **Transcribe audio**. Existing transcripts are cleared when another
file is loaded, so save any edits first.

Common inputs include MP4/M4V, MOV, MKV, WebM, AVI, WMV, FLV, MPEG/TS, 3GP,
VOB, OGV, and MXF. Audio-only inputs such as WAV, MP3, M4A/AAC, Ogg/Opus,
FLAC, WMA, AIFF, AC3, AMR, and CAF can also be converted. Codec support depends
on the installed PyAV runtime. Files without audio, corrupt media, and invalid
track numbers produce an error. **Audio track** starts at 1 and selects one
track, useful for alternate languages or commentary; tracks are not mixed.

Inputs are limited to **2 GB / 2 hours**, and outputs to **250 MB**. MP3 or M4A
is best for keeping long recordings within the output limit. WAV uses 16-bit
PCM; FLAC compresses that PCM without further loss. Mono/stereo and common
sample rates are retained up to 48 kHz; surround audio is mixed to stereo.
The selected track is decoded and converted to the chosen format.

Extraction uses the existing optional audio runtime, with bounded CPU threads
and no model download, GPU, or remote service. It skips video decoding and never
changes the source file. Source metadata, video, subtitles, and cover art are
omitted. One extraction runs at a time, with progress and **Cancel extraction**;
an operation is limited to 15 minutes. Temporary inputs and output are removed
after the response, cancellation, or a handled failure, including a disconnected
download. Leaving Audio pauses playback while extraction continues. Closing or
refreshing cancels unfinished work and clears unsaved results.

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

The recorder includes a local **phrase generator** with English reading prompts:
Cozy chaos, Space nonsense, Tiny adventures, Detective drama, or Surprise me.
**New phrase** shuffles 256 combinations without immediately repeating a phrase.
Read naturally; the prompt stays fixed while recording. It needs no model or
network connection. After recording, **Phrase shown during this recording**
keeps the exact prompt you saw even if you shuffle again. Choose **Use recorded
phrase as transcript** only if you read it word for word; otherwise transcribe
the recording as usual. Uploading another reference clears that association.
Use **Save phrase (.txt)** to keep the current reading prompt, or **Save recorded
phrase (.txt)** to keep the prompt tied to a recording. **Save reference text
(.txt)** exports the reviewed reference transcript. These save controls remain
available during recording and generation.

Click **Demo this voice** to generate and automatically play a short sample in
the selected language. Enter your own text to demo that instead. OmniVoice and
Qwen automatically transcribe the reference if its transcript is blank; you can
also use **Transcribe reference** and review/correct the words first. Chatterbox
uses the audio alone. Demo playback starts after local generation finishes;
this is not streaming voice conversion. Leaving Audio suppresses pending demo
playback and stops the transcription-to-generation chain before its next job.
If automatic playback is blocked, the finished audio still has a Play control.

For up to 1,500 characters of new text, **Generate cloned voice** creates speech
for manual playback. **Save text (.txt)** exports those words before, during, or
after generation; when the field is blank, it saves the displayed demo text.
Both modes offer **Save generated WAV** and **Save generated text (.txt)**.
The latter always uses the exact text attached to that result, even if you edit
the draft afterward. Text files use UTF-8 and preserve line breaks. A whole meeting with multiple speakers is not a
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
npm run test -- tests/frontend/audioExtraction.test.js
.\venv\Scripts\python.exe -m pytest tests/backend/test_audio.py -q
.\venv\Scripts\python.exe -m pytest tests/backend/test_speaker_diarization.py -q
.\venv\Scripts\python.exe -m pytest tests/backend/test_audio_acceleration.py -q
.\venv\Scripts\python.exe -m pytest tests/backend/test_audio_extraction.py -q
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

For real extraction checks, build the same fixture and use a short synthetic
video (the second argument is its audio-track number):

```powershell
.\node_modules\.bin\electron.cmd scripts\qa-audio-extraction.cjs "C:\path\synthetic-video.mp4" 1
# Optional: also transcribe the extracted speech with the installed model.
.\node_modules\.bin\electron.cmd scripts\qa-audio-extraction.cjs "C:\path\synthetic-video.mp4" 1 --transcribe
```

This tests all four output formats through the actual authenticated API, muted
desktop playback, saved-file hashes, navigation, responsive layout, and loading
Speech to text. Only its cancellation UI check uses a delayed fixture response;
backend tests cover real encoding cancellation and disconnect cleanup. Results
and screenshots are saved under ignored `artifacts/audio-extraction-smoke`.

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

## Spotify playback recording

Linked applications → Spotify offers two explicit recording sources. **Windows
playback** captures system audio on the Windows playback output, including other
apps and notifications. Play Spotify, keep it unmuted, and check Windows Sound
settings → Volume mixer so Spotify and this app use the same default output.
**Embedded Spotify player** captures only the player opened in this workspace;
open its link and press Play inside the player before recording. It does not
capture the separate Spotify desktop app. Recording requires the Windows desktop
app; microphone access and Whisper model setup are not recording requirements.

**Check recording requirements** checks the desktop capture APIs and whether an
embedded player is loaded. It does not establish that Spotify is playing or that
Windows can open an output device. **Start playback recording** opens the selected
audio source and displays a live signal meter. **Stop recording** creates an
in-memory preview; silent recordings are labeled. **Discard current recording**
preserves the previous clip. Capture continues across workspace changes and stops
at five minutes or 64 MB. Save, download, and transcription remain explicit actions.

Windows may report `NotReadableError` / “Could not start audio source” for system
playback. The UI explains the output-device checks and offers embedded-player
capture as a separate source. No audio-device settings are changed automatically.
Native capture uses a short, one-request permission lease that remains valid for
Chromium's final media check and is revoked after opening. Only audio enters the
recorder; the required temporary video track is stopped immediately.

Validation uses generated audio and an icon in disposable test windows:

```powershell
node scripts/build-playback-downloads-qa.mjs
.\node_modules\.bin\electron.cmd scripts/qa-playback-downloads.cjs
```

This checks the production recorder, live signal detection, decoded audio, lease
revocation, and the production converted-image Save As handler with identical ICO
bytes. It does not access a live Spotify account or the microphone. On this
machine, the system-loopback test still reported a Windows audio-source startup
failure; embedded-player capture passed with a generated tone.
