"""Stateless, session-authenticated conversion endpoints for Document Editor."""
import json
from contextlib import asynccontextmanager
from tempfile import SpooledTemporaryFile
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from services.document_editor import export_docx, import_docx
from services.import_processing import process as process_import

router = APIRouter(prefix='/document-editor', tags=['document-editor'])


@asynccontextmanager
async def document_body(request):
    with SpooledTemporaryFile(max_size=1024 * 1024, mode='w+b') as body:
        async for chunk in request.stream():
            await run_in_threadpool(body.write, chunk)
        body.seek(0)
        yield body


def export_body(body):
    value = json.load(body)
    if not isinstance(value, dict):
        raise ValueError('Invalid document request.')
    return export_docx(value.get('document'), value.get('layout', {}))


@router.post('/import')
async def open_document(request: Request):
    try:
        async with document_body(request) as body:
            return await process_import(import_docx, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/export')
async def save_document(request: Request):
    try:
        async with document_body(request) as body:
            result = await process_import(export_body, body)
        return Response(result, media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        headers={'Content-Disposition': 'attachment; filename="document.docx"', 'Cache-Control': 'no-store'})
    except (ValueError, RecursionError) as exc:
        raise HTTPException(400, str(exc) if isinstance(exc, ValueError) else 'Document nesting is too deep.') from exc
