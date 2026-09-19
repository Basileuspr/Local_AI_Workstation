from types import SimpleNamespace

from services import image_generation


class FakeTokenizer:
    def __init__(self, model_max_length, token_count):
        self.model_max_length = model_max_length
        self._token_count = token_count

    def __call__(self, _prompt, add_special_tokens=False):
        assert add_special_tokens is False
        return SimpleNamespace(input_ids=list(range(self._token_count)))


def test_token_summary_reports_the_native_window_and_long_prompt_chunks():
    summary = image_generation._token_summary(
        (FakeTokenizer(77, 74), FakeTokenizer(77, 151)), "long prompt"
    )

    assert summary["token_counts"] == [74, 151]
    assert summary["token_count"] == 151
    assert summary["native_content_limit"] == 75
    assert summary["chunks_required"] == 3

