"""Stateless, session-authenticated conversion endpoints for Document Editor."""
import json
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from services.document_editor import MAX_FILE, MAX_MODEL, export_docx, import_docx

router = APIRouter(prefix='/document-editor', tags=['document-editor'])


async def bounded_body(request, limit):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > limit:
            raise HTTPException(413, 'Document exceeds the editor size limit.')
        data.extend(chunk)
    return bytes(data)


@router.post('/import')
async def open_document(request: Request):
    raw = await bounded_body(request, MAX_FILE)
    try:
        return await run_in_threadpool(import_docx, raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/export')
async def save_document(request: Request):
    raw = await bounded_body(request, MAX_MODEL)
    try:
        value = json.loads(raw)
        if not isinstance(value, dict): raise ValueError('Invalid document request.')
        result = await run_in_threadpool(export_docx, value.get('document'), value.get('layout', {}))
        return Response(result, media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        headers={'Content-Disposition': 'attachment; filename="document.docx"', 'Cache-Control': 'no-store'})
    except (ValueError, RecursionError) as exc:
        raise HTTPException(400, str(exc) if isinstance(exc, ValueError) else 'Document nesting is too deep.') from exc
