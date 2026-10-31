# Audio and playback

Audio provides video-to-audio extraction, recording, transcription, local speech
and voice cloning. Chat exposes microphone/audio insertion and assistant-message
Speak/Stop controls. Install optional runtimes/models before using their features.

## Transcription

Record, stop, transcribe, then review/edit the text. In chat, **Insert into message**
appends to the current draft without sending it. File uploads follow the same
review flow. Copy or save the corrected transcript as text.

**Separate speakers** groups timestamped turns, with automatic or supplied speaker
count. Rename labels and correct mistaken turns/words before copying or saving.
Labels distinguish voices; they do not establish identity. Short/overlapping
speech and noise can produce Unknown or Unclear speaker labels.

Uploads and microphone recordings have no application byte or duration ceiling.
Record until you choose Stop. Long transcription uses bounded overlapping chunks. Processing
availability depends on the installed Whisper/runtime and hardware. Speaker
separation failures remain visible rather than being reported as successful
diarization.

## Extract and speak

Choose a video and extract its audio locally, then optionally transcribe it.
The source video remains unchanged. Extraction does not infer a transcript without
the explicit transcription step.

Windows voices support local read-aloud with voice, rate, pause/resume and stop.
Cloned speech uses separately installed engines and an explicit reference.

## Voice cloning

1. Choose OmniVoice, Qwen3-TTS or Chatterbox Turbo.
2. Record/upload a clear reference. The application does not impose an upload
   byte or duration ceiling; the chosen engine and available memory determine
   what it can process. A focused recording of one clear voice is useful.
3. Review the reference transcript. OmniVoice and Qwen use it; Chatterbox uses
   the audio-only reference path.
4. Enter up to 1,500 characters and generate. Save the result explicitly.

Reference audio remains unchanged. Generation is local and uses the shared runtime
queue. Auto processing can fall back to CPU with a visible status; completion and
voice quality depend on the installed runtime and model.

A saved spoken phrase can be associated with a reference only when it matches the
recording. Applying a character’s voice reference replaces the current selection
explicitly. Standalone generated audio is not automatically sent to chat.

## Chat voice

**Use this voice for chat** saves the selected reference in the shared audio
library. Settings → Voice Output selects a saved voice and controls automatic
speech, which defaults off.

Automatic speech applies to newly completed successful responses in the visible
chat; reopening history does not replay it. Leaving chat, changing voice or Stop
cancels pending synthesis/playback. Longer-than-supported responses report an error;
they are not silently rewritten. Temporary chat audio is released after playback
or cancellation. Speech failure does not replace the text response or retry it.

## Setup

Install optional audio dependencies into this PC’s environment:

```powershell
venv\Scripts\python.exe -m pip install -r requirements-audio.txt
```

Voice engines use separate Python 3.11 environments and local model folders.
Their installer requires Python 3.11 and Git; choose only the engines you need:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-voice-models.ps1 -Model qwen3-tts
```

Use the installer’s `-ModelsDir` option when models live elsewhere. Installation
may download the selected runtime/weights; ordinary generation uses the installed
local assets. Recreate environments on each PC rather than copying them.

## Playback recording and mixer

Spotify playback recording has two distinct sources. **Embedded** captures the
workspace’s loaded player. **Windows playback** captures the default output,
including other apps and notifications; it does not require microphone access.
Choose the intended device/source and check the level meter before recording.
It does not silently change the Windows output device. Recording is bounded to
five minutes / 64 MB.

Sound Mixer controls supported app playback channels and local tracks, with EQ,
pan and optional microphone monitoring. Monitoring starts off. Recording captures
the PCM routed into the mixer; external voices/players can have volume controls
without contributing PCM or supporting mixer EQ.

Browser/provider restrictions and Windows loopback capture can prevent recording.
A silent meter or startup error is not a successful capture. Current test and
hardware limits are recorded in [verification](../development/VERIFICATION.md).

[Characters](../images/CHARACTERS.md) · [Media Manager](MEDIA_MANAGER.md)
