"""Capture model-emitted traces without guessing reasoning from answer text."""
from __future__ import annotations

import codecs
import time

import httpx

_models: dict[str, tuple[float, dict]] = {}


def remember_model(model: str, info: dict) -> None:
    _models[model] = (time.monotonic(), info)


def thinking_setting(info: dict) -> bool | str | None:
    controls = info.get("thinking") or {}
    values = controls.get("values", [])
    enabled = [value for value in values if value is True or isinstance(value, str)]
    if enabled:
        default = controls.get("default")
        return default if default in enabled else enabled[0]
    if values == [False]:
        return False
    # Older Ollama versions report capabilities but not allowed values. Use
    # architecture/family too, so renamed GPT-OSS models receive a valid level.
    architecture = (info.get("model_info") or {}).get("general.architecture", "")
    family = (info.get("details") or {}).get("family", "")
    if any(str(value).lower().replace("-", "") == "gptoss" for value in (architecture, family)):
        return "medium"
    if "thinking" in info.get("capabilities", []):
        return True
    # Absence of metadata isn't proof of no reasoning. Let legacy templates
    # use their default and capture any explicit trace they emit.
    return None


async def resolve_thinking(client, base_url: str, model: str) -> bool | str | None:
    cached = _models.get(model)
    if cached and time.monotonic() - cached[0] < 300:
        return thinking_setting(cached[1])
    try:
        response = await client.post(f"{base_url}/api/show", json={"model": model}, timeout=10.0)
        response.raise_for_status()
        info = response.json()
        remember_model(model, info)
        return thinking_setting(info)
    except (httpx.HTTPError, ValueError):
        # Discovery failure must not prevent a normal chat request.
        return None


def reserve_thinking_budget(options: dict, think) -> dict:
    options = dict(options)
    limit = options.get("num_predict")
    if (think is True or isinstance(think, str)) and isinstance(limit, int) and limit > 0:
        # Ollama shares one budget between reasoning and the answer. Preserve
        # unlimited requests and give finite replies room to reach the answer.
        options["num_predict"] = limit + 8192
    return options


class TraceCapture:
    def __init__(self, append=lambda text: None):
        self.append = append
        self.pending = ""
        self.closing = None
        self.has_trace = False
        self.finished = False

    def split(self, text: str, flush=False) -> tuple[str, str]:
        buffer = self.pending + text
        self.pending = ""
        visible, thinking = [], []
        # Explicit tag formats only. Never classify ordinary prose as a trace.
        openings = {"<think>": "</think>", "<thinking>": "</thinking>", "<analysis>": "</analysis>"}
        while buffer:
            tags = [self.closing] if self.closing else list(openings)
            lowered = buffer.lower()
            matches = [(lowered.find(tag), tag) for tag in tags if tag in lowered]
            target = thinking if self.closing else visible
            if matches:
                position, tag = min(matches)
                target.append(buffer[:position])
                buffer = buffer[position + len(tag):]
                self.closing = None if self.closing else openings[tag]
                continue
            hold = 0
            if not flush:
                for tag in tags:
                    for size in range(1, min(len(tag), len(buffer) + 1)):
                        if lowered.endswith(tag[:size]):
                            hold = max(hold, size)
            target.append(buffer[:-hold] if hold else buffer)
            self.pending = buffer[-hold:] if hold else ""
            break
        return "".join(visible), "".join(thinking)

    def chunk(self, chunk: dict) -> tuple[str, str]:
        message = chunk.get("message") or {}
        trace = ""
        # Alias fields represent the same channel; don't duplicate mirrored data.
        for source in (message, chunk):
            trace = next((source[key] for key in ("thinking", "reasoning_content", "reasoning", "thought")
                          if isinstance(source.get(key), str) and source[key]), "")
            if trace:
                break
        raw = message.get("content", chunk.get("response", "")) or ""
        content, inline = self.split(raw, flush=bool(chunk.get("done")))
        trace += inline
        self.record(trace)
        return content, trace

    def record(self, text: str) -> None:
        if text:
            self.has_trace = True
            self.append(text)

    def finish(self, status: str) -> None:
        if self.finished:
            return
        _, tail = self.split("", flush=True)
        self.record(tail)
        if not self.has_trace:
            self.append("[No thinking trace was emitted by this model for this response.]\n")
        self.append(f"\n[{status}]\n")
        self.finished = True


def read_trace(path, offset: int, revision: str, requested_revision: str | None, size=262144) -> dict:
    with path.open("rb") as stream:
        stream.seek(0, 2)
        length = stream.tell()
        if requested_revision != revision or offset > length:
            offset = 0
        stream.seek(offset)
        raw = stream.read(size)
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    content = decoder.decode(raw, final=offset + len(raw) >= length)
    next_offset = offset + len(raw) - len(decoder.getstate()[0])
    return {"content": content, "offset": offset, "next_offset": next_offset,
            "revision": revision, "more": next_offset < length}
