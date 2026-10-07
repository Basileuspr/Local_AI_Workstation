"""Typed, local Word artifacts. Model output is data, never executable code."""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import math
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from config import settings
from services import storage_libraries as storage
from services.app_logging import get_logger
from services import session_store, image_vault

ROOT = settings.data_dir / "artifacts"
logger = get_logger("backend.chat_documents")
MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_document_update_lock = threading.RLock()
MAX_DOCUMENT_BLOCKS = 2000
MAX_DOCUMENT_CHARACTERS = 2_000_000


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TextBlock(StrictModel):
    type: Literal["paragraph", "heading", "bullet", "numbered"]
    text: str = Field(min_length=1, max_length=12000)


class TableBlock(StrictModel):
    type: Literal["table"]
    headers: list[str] = Field(min_length=1, max_length=8)
    rows: list[list[str]] = Field(min_length=1, max_length=60)


class ImageBlock(StrictModel):
    type: Literal["image"]
    image_id: str = Field(max_length=40)
    caption: str = Field(default="", max_length=1000)


class FunctionPlot(StrictModel):
    type: Literal["function_plot"]
    function: Literal["sin", "cos"]
    caption: str = Field(default="", max_length=1000)
    x_min: float = Field(default=0, ge=-10000, le=10000, allow_inf_nan=False)
    x_max: float = Field(default=6.283185307179586, ge=-10000, le=10000, allow_inf_nan=False)


Block = Annotated[TextBlock | TableBlock | ImageBlock | FunctionPlot, Field(discriminator="type")]


class DocumentAdditionSpec(StrictModel):
    blocks: list[Block] = Field(min_length=1, max_length=80)


class DocumentSpec(DocumentAdditionSpec):
    title: str = Field(min_length=1, max_length=160)
    filename: str = Field(default="document.docx", min_length=1, max_length=100)


def _document_attachments(session: dict) -> list[dict]:
    return [artifact for message in session.get("messages", []) for artifact in message.get("artifacts", [])
            if isinstance(artifact, dict) and artifact.get("kind") == "docx" and re.fullmatch(r"[a-f0-9]{32}", str(artifact.get("id", "")))]


def latest_document(session_id: str, artifact_id: str | None = None) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session_id or ""):
        raise ValueError("Open the source chat before adding to its document.")
    session = session_store.get_session(session_id)
    artifacts = _document_attachments(session or {})
    if not artifacts:
        raise ValueError("This chat has no Word document to extend. Create one first using Word or /docx.")
    chosen = next((item for item in reversed(artifacts) if item["id"] == artifact_id), None) if artifact_id else artifacts[-1]
    if not chosen: raise ValueError("The selected Word document is not attached to this chat.")
    family = chosen.get("document_id", chosen["id"])
    # Clicking an older attachment still adds to its latest saved version.
    chosen = next(item for item in reversed(artifacts) if item.get("document_id", item["id"]) == family)
    metadata = read_artifact(chosen["id"])
    if metadata.get("session_id") != session_id: raise ValueError("The selected Word document belongs to a different chat.")
    return metadata


def document_operation(text: str, session_id: str | None, *, force=False, artifact_id=None) -> dict | None:
    """Route additions from saved attachments, independently of model context compaction."""
    prompt = re.sub(r"```[\s\S]*?```", "", text).strip()
    command = re.match(r"(?is)^/docx\s+(?:append|add|continue)\b(?:\s+([a-f0-9]{32})\b)?", prompt)
    if command and not prompt[command.end():].strip():
        raise ValueError("Describe the new content after /docx append, then Send.")
    if artifact_id:
        return {"action": "append", "base": latest_document(session_id or "", artifact_id)}
    if command:
        base = latest_document(session_id or "", command.group(1))
        return {"action": "append", "base": base}
    lower = prompt.lower()
    if re.search(r"\b(how (?:do|can|should|to)|don't|do not|python (?:code|script)|code (?:to|for))\b", lower) or re.match(r"^(?:can you |please )?explain\b", lower):
        return {"action": "create"} if force else None
    addition = bool(re.search(r"\b(?:add|append|extend|continue|expand|insert|include|finish|complete)\b", lower)
                    or re.search(r"\b(?:write|draft)\b.*\b(?:next|another|more|remaining|(?:chapter|part|section)\s+(?:[2-9]\d*|two|three|four|five|six|seven|eight|nine|ten))\b", lower)
                    or re.search(r"\b(?:update|amend)\b.*\b(?:with|by)\b.*\b(?:new|next|another|additional|adding|appending)\b", lower))
    new_document = bool(re.search(r"\b(?:create|make|start|write|generate)\b.*\b(?:new|separate|different)\b.*\b(?:docx|document|file)\b", lower))
    if wants_document(prompt) and re.match(r"^(?:(?:can|could|would) you |please |okay,? (?:now )?)*(?:create|make|generate|produce|export|save|prepare|convert|turn|put|give)\b", lower):
        return {"action": "create"}
    if addition and not new_document:
        explicit_document = bool(re.search(r"(?:\b(?:docx|document|word file|report)\b|\.docx\b)", lower))
        session = session_store.get_session(session_id) if re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session_id or "") else None
        last_assistant = next((message for message in reversed((session or {}).get("messages", [])) if message.get("role") == "assistant"), {})
        recent_document = bool(_document_attachments({"messages": [last_assistant]}))
        if explicit_document or recent_document:
            artifacts = _document_attachments(session or {})
            named = [item for item in artifacts if item.get("name") and re.search(r"(?<![\w.-])" + re.escape(item["name"]) + r"(?![\w.-])", prompt, re.I)]
            families = {item.get("document_id", item["id"]) for item in named}
            if len(families) > 1: raise ValueError("More than one document has that filename. Use Add to document on the intended attachment.")
            if not named and re.search(r"\b[\w-]+\.docx\b", lower):
                raise ValueError("That Word file is not attached to this chat. Use Add to document on a chat-created attachment.")
            base = latest_document(session_id or "", named[-1]["id"] if named else None)
            return {"action": "append", "base": base}
    return {"action": "create"} if force or wants_document(prompt) else None


def wants_document(text: str) -> bool:
    """Explicit creation requests only; quoted snippets and how-to questions stay chat."""
    text = re.sub(r"```[\s\S]*?```", "", text).strip().lower()
    if text.startswith("/docx"): return True
    if re.search(r"\b(how (do|can|should|to)|don't|do not|explain|python (code|script)|code (to|for))\b", text): return False
    return bool(re.search(r"(?:\.docx\b|\bdocx\b|\bword (?:document|file)\b)", text)
                and re.search(r"\b(make|create|generate|export|save|convert|turn|put|give|prepare|produce|write|download)\b", text))


def image_inventory(session_id: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session_id or ""):
        raise ValueError("Open or save a chat before creating a document.")
    session = session_store.get_session(session_id)
    if not session: raise ValueError("Open or save a chat before creating a document.")
    result = {}
    for message in session.get("messages", []):
        for record in session_store._message_image_records(message):
            # Do not expose locked images to the model or copy them into a document.
            try:
                raw, _ = session_store._decode_image(record)
                image_vault.require_public(hashlib.sha256(raw).hexdigest())
            except (ValueError, OSError):
                continue
            result[f"image-{len(result) + 1}"] = {"message_id": message["id"], "image_id": record["id"],
                                                     "name": str(record.get("name") or "Chat image")[:200]}
    # Recent images remain available without expanding an unbounded prompt.
    return dict(list(result.items())[-20:])


def document_instruction(inventory: dict, base: dict | None = None, *, excerpt: str | None = None) -> str:
    images = [{"image_id": key, "name": value["name"]} for key, value in inventory.items()]
    instruction = (
        "The application will create a real downloadable Word document and show it in chat. "
        "Return ONLY a JSON document matching this schema. Write the actual requested document content, "
        "not Python code, setup steps, or instructions for making a file. Use the conversation as source material. "
        "Do not claim you cannot create files. Use plain text within each block, without Markdown syntax. "
        "Include a concise title and a descriptive .docx filename. Preserve requested facts and do not invent missing ones. "
        "For pictures use ONLY image_id values from the available chat images below. "
        "A filename mentioned in prose or a code snippet does not mean that file exists. "
        "If a requested image is unavailable, include an honest paragraph saying it must be attached. "
        "For a mathematical sine or cosine plot, a function_plot block creates an actual chart locally; "
        "use sin or cos and the requested x range (default 0 to 6.283185307179586). "
        "Do not invent plots for other functions. Keep the document concise enough to complete.\n"
        f"Available chat images: {json.dumps(images)}\n"
    )
    if base:
        outline = [block.get("text", "")[:180] for block in base.get("blocks", []) if block.get("type") == "heading"][-30:]
        tail = document_text(base)[-12000:] if excerpt is None else excerpt
        instruction += (
            "You are ADDING to an existing Word document. Return ONLY the NEW blocks requested in this turn. "
            "The application preserves all existing content and appends your new blocks in order. "
            "Do not rewrite, summarize, repeat, or return the existing document. Do not include another document title. "
            "Use earlier sections for consistency only. Requests for destructive replacement require a separate edit workflow.\n"
            f"Existing document: {json.dumps({'title':base['title'],'filename':base['name'],'version':base.get('version',1),'headings':outline})}\n"
            f"Existing content excerpt (reference only):\n{tail}\n"
        )
    return instruction + f"Schema: {json.dumps((DocumentAdditionSpec if base else DocumentSpec).model_json_schema())}"


def document_text(value: dict) -> str:
    parts = [value["title"]]
    for block in value.get("blocks", []):
        if block["type"] in ("paragraph", "heading", "bullet", "numbered"): parts.append(block["text"])
        elif block["type"] == "table": parts.extend(" | ".join(row) for row in [block["headers"], *block["rows"]])
        elif block.get("caption"): parts.append(block["caption"])
    return "\n".join(parts)


def _artifact_dir(artifact_id: str, *, create=False) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", artifact_id): raise FileNotFoundError("Document not found")
    target = storage.resolve(ROOT / artifact_id, create=create)
    storage.confined(target, ROOT)
    return target


def read_artifact(artifact_id: str) -> dict:
    directory = _artifact_dir(artifact_id)
    try: value = json.loads((directory / "document.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc: raise FileNotFoundError("This document is unavailable. Try creating it again.") from exc
    if not session_store.get_session(value["session_id"]): raise FileNotFoundError("The source chat is deleted. Restore it to view this document.")
    for digest in value.get("source_hashes", []): image_vault.require_public(digest)
    return value


def file_path(artifact_id: str, name: str) -> Path:
    read_artifact(artifact_id)
    if name != "document.docx" and not re.fullmatch(r"image-[0-9]+\.png", name): raise FileNotFoundError("Document file not found")
    directory = _artifact_dir(artifact_id)
    path = directory / name
    if not path.is_file() or path.resolve().parent != directory.resolve(): raise FileNotFoundError("Document file is missing")
    return path


def _plot(block: FunctionPlot) -> bytes:
    """Small deterministic mathematical plot; no eval, generated scripts, or subprocess."""
    from PIL import Image, ImageDraw, ImageFont
    if block.x_max <= block.x_min: raise ValueError("The plot's maximum x must be greater than its minimum.")
    image = Image.new("RGB", (1200, 680), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=22)
    left, top, width, height = 105, 70, 1045, 500
    for i in range(5):
        y = top + i * height / 4
        draw.line((left, y, left+width, y), fill="#dddddd", width=1)
        draw.text((30, y-12), f"{1 - i/2:g}", fill="#222222", font=font)
    for i in range(6):
        x = left + width * i / 5
        draw.line((x, top, x, top+height), fill="#eeeeee", width=1)
        draw.text((x-18, top+height+12), f"{block.x_min+(block.x_max-block.x_min)*i/5:.2f}", fill="#222222", font=font)
    draw.line((left, top+height/2, left+width, top+height/2), fill="#777777", width=2)
    draw.rectangle((left, top, left+width, top+height), outline="#333333", width=2)
    function = math.sin if block.function == "sin" else math.cos
    points = [(left + width*i/1000, top+height*(1-function(block.x_min+(block.x_max-block.x_min)*i/1000))/2) for i in range(1001)]
    draw.line(points, fill="#245b9b", width=4)
    draw.text((left, 20), f"y = {block.function}(x)", fill="#111111", font=font)
    draw.text((570, 630), "x (radians)", fill="#222222", font=font)
    output = io.BytesIO(); image.save(output, format="PNG"); return output.getvalue()


def create_document(spec: DocumentSpec | DocumentAdditionSpec, session_id: str, inventory: dict, cancel: threading.Event, *, base: dict | None = None) -> dict:
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from PIL import Image

    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", session_id or "") or not session_store.get_session(session_id):
        raise ValueError("The source chat no longer exists.")
    if base and base.get("session_id") != session_id: raise ValueError("The selected Word document belongs to a different chat.")
    if not base and not isinstance(spec, DocumentSpec): raise ValueError("An addition needs an existing Word document.")
    existing_blocks = base.get("blocks", []) if base else []
    if len(existing_blocks) + len(spec.blocks) > MAX_DOCUMENT_BLOCKS:
        raise ValueError("This Word document has reached its section limit. Start a separate document.")
    if len(json.dumps(existing_blocks, ensure_ascii=False)) + len(spec.model_dump_json()) > MAX_DOCUMENT_CHARACTERS:
        raise ValueError("This Word document has reached its text limit. Start a separate document.")
    artifact_id = uuid.uuid4().hex
    ROOT.mkdir(parents=True, exist_ok=True)
    destination = _artifact_dir(artifact_id, create=True)
    temporary = destination.parent / (".partial-" + artifact_id)
    temporary.mkdir()
    try:
        doc = Document(file_path(base["id"], "document.docx")) if base else Document()
        if not base:
            section = doc.sections[0]
            section.page_width, section.page_height = Inches(8.5), Inches(11)
            section.top_margin = section.bottom_margin = Inches(.8)
            section.left_margin = section.right_margin = Inches(.85)
            normal = doc.styles["Normal"]
            normal.font.name, normal.font.size = "Calibri", Pt(11)
            normal.paragraph_format.space_after = Pt(8)
            for style in ("Title", "Heading 1", "Heading 2"):
                doc.styles[style].font.color.rgb = RGBColor(0, 0, 0)
            for border in doc.styles["Title"].element.xpath("./w:pPr/w:pBdr"):
                border.getparent().remove(border)
        title = base["title"] if base else spec.title
        if not base: doc.add_paragraph(title, "Title")
        blocks, source_hashes = list(existing_blocks), list(base.get("source_hashes", [])) if base else []
        image_names = set()
        for item in existing_blocks:
            if item.get("type") == "image":
                name = item.get("image_file", "")
                if not re.fullmatch(r"image-[0-9]+\.png", name): raise ValueError("The source document has an invalid preview image.")
                image_names.add(name)
        for name in image_names: shutil.copyfile(file_path(base["id"], name), temporary / name)
        next_image = max((int(name[6:-4]) for name in image_names), default=-1) + 1
        for index, block in enumerate(spec.blocks):
            if cancel.is_set(): raise InterruptedError("Document creation cancelled")
            if index == 0 and isinstance(block, TextBlock) and block.type == "heading" and block.text.strip().casefold() == title.strip().casefold():
                continue
            item = block.model_dump()
            if isinstance(block, TextBlock):
                style = {"heading": "Heading 1", "bullet": "List Bullet", "numbered": "List Number"}.get(block.type)
                doc.add_paragraph(block.text, style)
            elif isinstance(block, TableBlock):
                if any(len(row) != len(block.headers) for row in block.rows): raise ValueError("A document table has unequal column counts. Try again with a simpler table.")
                if any(len(cell) > 3000 for row in [block.headers, *block.rows] for cell in row): raise ValueError("A table cell is too long.")
                table = doc.add_table(rows=1, cols=len(block.headers)); table.style = "Table Grid"
                for cell, text in zip(table.rows[0].cells, block.headers):
                    cell.text = text
                    for run in cell.paragraphs[0].runs: run.bold = True
                    shade = OxmlElement("w:shd"); shade.set(qn("w:fill"), "E8EEF5"); cell._tc.get_or_add_tcPr().append(shade)
                for row in block.rows:
                    for cell, text in zip(table.add_row().cells, row): cell.text = text
                doc.add_paragraph()
            else:
                if isinstance(block, ImageBlock):
                    source = inventory.get(block.image_id)
                    if not source: raise ValueError("The requested image is not attached to this chat. Attach it and try again.")
                    found = session_store.get_session_image_by_id(session_id, source["message_id"], source["image_id"])
                    if not found: raise ValueError("A selected chat image is missing. Attach it again before creating the document.")
                    raw = found[0]; digest = hashlib.sha256(raw).hexdigest()
                    image_vault.require_public(digest); source_hashes.append(digest)
                    if len(raw) > 25*1024*1024: raise ValueError("The selected image is too large for this document.")
                    with Image.open(io.BytesIO(raw)) as image:
                        if image.width * image.height > 40_000_000: raise ValueError("The selected image has too many pixels.")
                        image.thumbnail((2000, 2000))
                        output = io.BytesIO(); image.convert("RGB").save(output, format="PNG"); raw = output.getvalue()
                else:
                    raw = _plot(block)
                source_hashes.append(hashlib.sha256(raw).hexdigest())
                name = f"image-{next_image if base else index}.png"; next_image += 1
                (temporary / name).write_bytes(raw)
                with Image.open(io.BytesIO(raw)) as image:
                    width = min(6.6, 6.5 * image.width / image.height)
                doc.add_picture(io.BytesIO(raw), width=Inches(width))
                if block.caption: doc.add_paragraph(block.caption, "Caption")
                item = {"type": "image", "image_file": name, "caption": block.caption}
            blocks.append(item)
        if base and len(blocks) == len(existing_blocks):
            raise ValueError("The model returned no new document content. Describe the next section and retry.")
        filename = re.sub(r"[^a-zA-Z0-9 _-]", "", Path((base["name"] if base else spec.filename).replace("\\", "/")).stem)[:70].strip(" .") or "document"
        if re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])", filename): filename = "document-" + filename
        filename += ".docx"
        doc.save(temporary / "document.docx")
        if (temporary / "document.docx").stat().st_size > 100 * 1024 * 1024: raise ValueError("This Word document has reached its file size limit. Start a separate document.")
        descriptor = {"id": artifact_id, "kind": "docx", "name": filename, "title": title,
                      "size": (temporary / "document.docx").stat().st_size,
                      "document_id": base.get("document_id", base["id"]) if base else artifact_id,
                      "version": base.get("version", 1) + 1 if base else 1}
        if base: descriptor["parent_id"] = base["id"]
        metadata = {**descriptor, "session_id": session_id, "blocks": blocks,
                    "source_hashes": list(dict.fromkeys(source_hashes)), "created_at": datetime.now(timezone.utc).isoformat()}
        (temporary / "document.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        for digest in source_hashes: image_vault.require_public(digest)
        if cancel.is_set(): raise InterruptedError("Document creation cancelled")
        temporary.rename(destination)
        logger.info("Created Word artifact %s for session %s (%d bytes)", artifact_id, session_id, descriptor["size"])
        return descriptor
    finally:
        # Only our newly-created partial directory can be removed here.
        if temporary.exists() and temporary.resolve().parent == destination.parent.resolve() and temporary.name == ".partial-" + artifact_id:
            shutil.rmtree(temporary)


def _saved_reply(session_id, reply_id, request_key):
    session = session_store.get_session(session_id)
    previous = next((item for item in (session or {}).get("messages", []) if item.get("id") == reply_id), None)
    if previous:
        if previous.get("document_request_key") != request_key or not previous.get("artifacts"):
            raise ValueError("This reply identifier was already used. Send the addition as a new message.")
        for artifact in previous["artifacts"]: read_artifact(artifact["id"])
    return previous


def _build_and_save(spec, session_id, inventory, cancel, base, reply_id, model, influence_receipt, request_key):
    # Keep choosing the latest version, publishing the file and saving its reply
    # together. Two drafted additions cannot silently drop one another.
    with _document_update_lock:
        previous = _saved_reply(session_id, reply_id, request_key)
        if previous: return previous
        base = latest_document(session_id, base["id"]) if base else None
        if cancel.is_set(): raise InterruptedError("Document creation cancelled")
        artifact = create_document(spec, session_id, inventory, cancel, **({"base": base} if base else {}))
        if cancel.is_set(): raise InterruptedError("Document creation cancelled")
        metadata = read_artifact(artifact["id"])
        summary = (f"Added the new content to **{artifact['name']}**. Version {artifact['version']} below includes the earlier content and your additions."
                   if base else f"Created **{artifact['name']}**. Open the document below to view it or download the Word file.")
        message = {"id": reply_id, "role": "assistant", "content": summary, "artifacts": [artifact],
                   "document_text": document_text(metadata), "document_request_key": request_key,
                   "influence_receipt": influence_receipt}
        saved = session_store.append_messages(session_id, [message], model=model)
        if saved is None: raise ValueError("The source chat was deleted before the document could be attached.")
        return message


async def stream_document(client, payload, request, client_request, influence_context=None, trace=None, operation=None):
    """Use the existing chat queue/cancellation task; publish only complete files."""
    from services.thinking_trace import TraceCapture, reserve_thinking_budget
    trace = trace or TraceCapture()
    trace_status = "Document response interrupted"
    cancel = threading.Event()
    worker = None
    def event(**value): return f"data: {json.dumps(value)}\n\n"
    try:
        prompt = next((message["content"] for message in reversed(payload["messages"]) if message["role"] == "user"), "")
        operation = operation or await run_in_threadpool(document_operation, prompt, request.session_id, force=True)
        base = operation.get("base")
        request_key = hashlib.sha256(json.dumps([request.model, prompt, base.get("document_id", base["id"]) if base else None], ensure_ascii=False).encode()).hexdigest()
        reply_id = request.reply_message_id or uuid.uuid4().hex
        previous = await run_in_threadpool(_saved_reply, request.session_id, reply_id, request_key)
        if previous:
            trace_status = "Document response replayed"
            yield event(token=previous["content"], artifacts=previous["artifacts"], document_text=previous["document_text"], reply_saved=True, done=True)
            return
        inventory = await run_in_threadpool(image_inventory, request.session_id or "")
        context_notes = "\n\n".join(m["content"] for m in payload["messages"] if m["role"] == "system")
        spec_type = DocumentAdditionSpec if base else DocumentSpec
        options = {**payload.get("options", {}), "temperature": 0, "num_predict": 4096}
        context_limit = max(2048, int(options.get("num_ctx") or settings.num_ctx))
        options["num_ctx"] = context_limit
        excerpt = None
        if base:
            from services.context_awareness import estimate_text
            from services.chat_context import clip_text
            options["num_predict"] = min(4096, max(512, context_limit // 3))
            context_notes = clip_text(context_notes, context_limit // 8)
            fixed = context_notes + "\n\n" + document_instruction(inventory, base, excerpt="")
            budget = min(int(context_limit * .66), context_limit - options["num_predict"] - 512)
            excerpt_budget = max(0, min(3000, budget - estimate_text(fixed) - estimate_text(prompt) - 128))
            excerpt = clip_text(document_text(base)[-12000:], excerpt_budget)
        history = [{"role": m["role"], "content": m["content"].split("\n[Document content]\n", 1)[0]
                    if base and m["role"] == "assistant" else m["content"]}
                   for m in payload["messages"] if m["role"] != "system"]
        payload = {**payload, "format": spec_type.model_json_schema(),
                   "messages": [{"role": "system", "content": context_notes + "\n\n" + document_instruction(inventory, base, excerpt=excerpt)}, *history],
                   "options": options}
        payload["options"] = reserve_thinking_budget(payload["options"], payload.get("think"))
        from services.chat_influences import receipt
        yield event(document_status="Drafting the new document section…" if base else "Drafting your Word document…")
        content, completed = "", False
        from services.chat_context import open_chat_stream
        async with open_chat_stream(client, settings.ollama_base_url, payload, client_request.is_disconnected) as response:
            if response.is_error:
                detail = (await response.aread()).decode("utf-8", errors="replace")[:1500]
                raise ValueError(f"The model could not draft the document ({response.status_code}): {detail}")
            influence_receipt = receipt(payload, mode="document", context=influence_context)
            yield event(influence_receipt=influence_receipt)
            for adjustment in payload.get("_context_notices", []):
                yield event(notice={"kind": "context_budget", "message": adjustment})
            async for line in response.aiter_lines():
                if await client_request.is_disconnected(): raise asyncio.CancelledError()
                if not line: continue
                chunk = json.loads(line)
                if chunk.get("error"): raise ValueError(str(chunk["error"]))
                visible, thinking = trace.chunk(chunk)
                content += visible
                if thinking: yield event(thinking=thinking, done=False)
                if len(content) > 180000: raise ValueError("This document is too large. Try creating it in smaller sections.")
                yield ": drafting document\n\n"
                if chunk.get("done"):
                    if chunk.get("done_reason") == "length": raise ValueError("The document draft reached the model's output limit. Ask for a shorter document and retry.")
                    completed = True; break
        if not completed: raise ValueError("The model stopped before completing the document. Try again.")
        try: spec = spec_type.model_validate_json(content)
        except ValidationError as exc: raise ValueError("The model did not return a usable document. Try again or use a model that supports structured output.") from exc
        yield event(document_status="Creating the Word file and preview…")
        worker = asyncio.create_task(run_in_threadpool(_build_and_save, spec, request.session_id, inventory, cancel, base, reply_id, request.model, influence_receipt, request_key))
        message = await asyncio.shield(worker)
        if await client_request.is_disconnected(): raise asyncio.CancelledError()
        trace_status = "Document response complete"
        yield event(token=message["content"], artifacts=message["artifacts"], document_text=message["document_text"], reply_saved=True, done=True)
    except asyncio.CancelledError:
        cancel.set()
        if worker:
            try: await asyncio.shield(worker)
            except Exception: pass
        raise
    except Exception as exc:
        logger.exception("Word document creation failed for session %s", request.session_id)
        detail = str(exc) if isinstance(exc, (ValueError, ImportError, OSError)) else "Document creation failed. See the app logs and try again."
        if isinstance(exc, ImportError): detail = "Word document tools are unavailable. Run the app setup again to install python-docx and Pillow, then retry."
        trace_status = f"Document response failed: {detail}"
        yield event(token=f"[Error: {detail}]", error=detail, done=True)
    finally:
        trace.finish(trace_status)
