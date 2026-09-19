import torch
import json
import pytest

from services.lora_worker import _cached_batch
from services.lora_worker import _batch_from_records, _load_cached_records
from services.cpu_assistance import PreparationPool


def test_training_refuses_an_expired_deadline(tmp_path):
    from services.lora_worker import train
    project = tmp_path / "project.json"
    project.write_text(json.dumps({"settings": {"training_deadline_unix": 1}}))
    with pytest.raises(ValueError, match="deadline"):
        train(project, "expired")


def test_cached_inputs_preserve_conditioning_and_resample_latents(tmp_path):
    record = {
        "mean": torch.zeros(1, 4, 8, 8),
        "std": torch.ones(1, 4, 8, 8),
        "scaling_factor": 0.5,
        "prompt": torch.ones(1, 77, 16),
        "pooled": torch.ones(1, 8),
    }
    torch.save(record, tmp_path / "0.pt")
    batch = [{"cache_index": 0}, {"cache_index": 0}]
    first, prompt, pooled = _cached_batch(batch, tmp_path, "cpu", torch.float32)
    second, _, _ = _cached_batch(batch, tmp_path, "cpu", torch.float32)
    assert first.shape == (2, 4, 8, 8)
    assert not torch.equal(first, second)
    assert prompt.shape == (2, 77, 16)
    assert pooled.shape == (2, 8)
    assert torch.equal(prompt[0], record["prompt"][0])


def test_activation_offload_preserves_gradients():
    # CPU execution also checks the context's autograd contract in normal CI.
    parameter = torch.nn.Parameter(torch.tensor([2.0, 3.0]))
    with torch.autograd.graph.save_on_cpu():
        loss = parameter.square().sum()
    loss.backward()
    torch.testing.assert_close(parameter.grad, torch.tensor([4.0, 6.0]))


def test_preloading_does_not_change_seeded_latent_sampling(tmp_path):
    record = {"mean": torch.zeros(1, 4, 8, 8), "std": torch.ones(1, 4, 8, 8), "scaling_factor": 0.5,
              "prompt": torch.ones(1, 77, 16), "pooled": torch.ones(1, 8)}
    torch.save(record, tmp_path / "0.pt")
    batches = [[{"cache_index": 0}] for _ in range(5)]
    torch.manual_seed(123)
    expected = [_cached_batch(batch, tmp_path, "cpu", torch.float32)[0] for batch in batches]
    torch.manual_seed(123)
    with PreparationPool(batches, lambda batch: _load_cached_records(batch, tmp_path), lambda _: 100,
                         {"workers": 4, "budget_bytes": 1000}, headroom=lambda: 1000) as pool:
        actual = [_batch_from_records(records, "cpu", torch.float32)[0] for records in pool]
    for left, right in zip(expected, actual):
        torch.testing.assert_close(left, right)
