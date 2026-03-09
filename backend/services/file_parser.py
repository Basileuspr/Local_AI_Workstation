"""
File Parser Service
Reads text from multiple file formats.

This is the shared foundation for both:
- Direct file upload (full text into chat context)
- Knowledge base (text gets chunked and embedded for RAG)

Supported formats: .txt, .md, .pdf, .docx
"""

from pathlib import Path
import io


def parse_file(file_bytes: bytes, filename: str) -> dict:
    """
    Extract text from a file based on its extension.
    
    Args:
        file_bytes: Raw file content as bytes
        filename: Original filename (used to detect format)
    
    Returns:
        dict with:
            - text: Extracted text content
            - filename: Original filename
            - format: Detected format
            - char_count: Length of extracted text
            - error: Error message if extraction failed, None otherwise
    """
    ext = Path(filename).suffix.lower()

    try:
        if ext in (".txt", ".md"):
            text = _parse_text(file_bytes)
        elif ext == ".pdf":
            text = _parse_pdf(file_bytes)
        elif ext in (".docx", ".doc"):
            text = _parse_docx(file_bytes)
        else:
            return {
                "text": "",
                "filename": filename,
                "format": ext,
                "char_count": 0,
                "error": f"Unsupported file format: {ext}",
            }

        return {
            "text": text,
            "filename": filename,
            "format": ext,
            "char_count": len(text),
            "error": None,
        }

    except Exception as e:
        return {
            "text": "",
            "filename": filename,
            "format": ext,
            "char_count": 0,
            "error": f"Failed to parse {filename}: {str(e)}",
        }


def _parse_text(file_bytes: bytes) -> str:
    """Plain text and markdown — just decode the bytes."""
    # Try UTF-8 first, fall back to latin-1 which never fails
    try:
        return file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        return file_bytes.decode("latin-1")


def _parse_pdf(file_bytes: bytes) -> str:
    """
    Extract text from PDF.
    Only works on PDFs with text layers (not scanned images).
    """
    from PyPDF2 import PdfReader

    reader = PdfReader(io.BytesIO(file_bytes))
    pages = []

    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text and text.strip():
            pages.append(f"--- Page {i + 1} ---\n{text.strip()}")

    if not pages:
        return "[No extractable text found in this PDF. It may be a scanned document without OCR.]"

    return "\n\n".join(pages)


def _parse_docx(file_bytes: bytes) -> str:
    """Extract text from Word documents."""
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    paragraphs = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            paragraphs.append(text)

    if not paragraphs:
        return "[No text found in this document.]"

    return "\n\n".join(paragraphs)
