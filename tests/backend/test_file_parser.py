import pytest

from services import file_parser


def test_scanned_pdf_ocrs_only_pages_without_a_useful_text_layer(monkeypatch):
    monkeypatch.setattr(
        file_parser,
        "_extract_pdf_page_texts",
        lambda _data: [
            "Native text remains authoritative on this page.",
            "",
            "tiny",
        ],
    )
    seen = []

    def fake_ocr(_data, page_indices):
        seen.extend(page_indices)
        return {
            1: "OCR TRANSCRIPTION PAGE TWO",
            2: "OCR TRANSCRIPTION PAGE THREE",
        }

    monkeypatch.setattr(file_parser, "_ocr_pdf_pages", fake_ocr)

    text, metadata = file_parser._parse_pdf(b"fake-pdf")

    assert seen == [1, 2]
    assert "--- Page 1 ---\nNative text remains authoritative" in text
    assert "--- Page 2 ---\nOCR TRANSCRIPTION PAGE TWO" in text
    assert "--- Page 3 ---\nOCR TRANSCRIPTION PAGE THREE" in text
    assert metadata == {
        "page_count": 3,
        "text_layer_pages": [1],
        "ocr_pages": [2, 3],
        "ocr_model": file_parser.settings.ocr_model,
    }


def test_text_layer_pdf_does_not_start_the_ocr_runtime(monkeypatch):
    monkeypatch.setattr(
        file_parser,
        "_extract_pdf_page_texts",
        lambda _data: ["First native page with enough text.", "Second native page with enough text."],
    )
    monkeypatch.setattr(
        file_parser,
        "_ocr_pdf_pages",
        lambda *_args: pytest.fail("OCR must not run for text-layer pages"),
    )

    text, metadata = file_parser._parse_pdf(b"fake-pdf")

    assert "First native page" in text
    assert "Second native page" in text
    assert metadata["ocr_pages"] == []
    assert metadata["text_layer_pages"] == [1, 2]


def test_parse_file_exposes_scanned_pdf_metadata(monkeypatch):
    monkeypatch.setattr(
        file_parser,
        "_parse_pdf",
        lambda _data: (
            "--- Page 1 ---\nSCANNED SENTINEL 731",
            {
                "page_count": 1,
                "text_layer_pages": [],
                "ocr_pages": [1],
                "ocr_model": "vision-test",
            },
        ),
    )

    parsed = file_parser.parse_file(b"fake-pdf", "scan.pdf")

    assert parsed["error"] is None
    assert parsed["ocr_pages"] == [1]
    assert parsed["page_count"] == 1
    assert parsed["ocr_model"] == "vision-test"
    assert parsed["char_count"] == len(parsed["text"])


def test_ocr_requires_visible_transcription_instead_of_exposing_thinking(monkeypatch):
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"message": {"content": "", "thinking": "private reasoning"}}

    monkeypatch.setattr(file_parser.httpx, "post", lambda *_args, **_kwargs: Response())

    with pytest.raises(RuntimeError, match="no visible transcription"):
        file_parser._transcribe_page_png(b"png", page_number=1, keep_alive=0)


def test_ocr_request_is_local_deterministic_and_unloads_after_last_page(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"message": {"content": "```text\nSCANNED SENTINEL 731\n```"}}

    def fake_post(url, **kwargs):
        captured.update(url=url, **kwargs)
        return Response()

    monkeypatch.setattr(file_parser.httpx, "post", fake_post)

    text = file_parser._transcribe_page_png(b"png", page_number=1, keep_alive=0)

    assert text == "SCANNED SENTINEL 731"
    assert captured["url"].endswith("/api/chat")
    assert captured["json"]["model"] == file_parser.settings.ocr_model
    assert captured["json"]["stream"] is False
    assert captured["json"]["think"] is False
    assert captured["json"]["keep_alive"] == 0
    assert captured["json"]["messages"][0]["images"]

