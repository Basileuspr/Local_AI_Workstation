from services.gpu_coordination import GpuCoordinator


def test_gpu_coordinator_allows_only_one_local_owner():
    coordinator = GpuCoordinator()

    assert coordinator.acquire("image-generation")
    assert coordinator.current_owner() == "image-generation"
    assert not coordinator.acquire("lora:test-run")

    coordinator.release("image-generation")
    assert coordinator.current_owner() is None
    assert coordinator.acquire("lora:test-run")


def test_gpu_coordinator_ignores_release_from_non_owner():
    coordinator = GpuCoordinator()
    assert coordinator.acquire("lora:test-run")

    assert not coordinator.release("image-generation")
    assert coordinator.current_owner() == "lora:test-run"
    assert not coordinator.acquire("image-generation")

    assert coordinator.release("lora:test-run")

