import asyncio
import threading
from types import SimpleNamespace

import pytest

from services import cpu_assistance as cpu, lora_store


def test_modes_leave_cpu_capacity_and_bound_ram(monkeypatch):
    monkeypatch.setattr(cpu.psutil, "cpu_count", lambda **_: 8)
    monkeypatch.setattr(cpu, "memory_headroom", lambda: 4 * 1024**3)
    assert cpu.assistance_plan({"cpu_assistance": "light", "preload_ram_mb": 512})["budget_bytes"] == 64 * cpu.MIB
    assert cpu.assistance_plan({})["workers"] == 2
    assert cpu.assistance_plan({"cpu_assistance": "balanced"})["workers"] == 4
    assert cpu.assistance_plan({"cpu_assistance": "balanced", "preload_ram_mb": 32})["budget_bytes"] == 32 * cpu.MIB
    monkeypatch.setattr(cpu, "memory_headroom", lambda: 10 * cpu.MIB)
    assert cpu.assistance_plan({"cpu_assistance": "balanced"})["workers"] == 1


def test_headroom_reserves_ram_for_os_and_model_allocations(monkeypatch):
    monkeypatch.setattr(cpu.psutil, "virtual_memory", lambda: SimpleNamespace(available=1024**3, total=16 * 1024**3))
    assert cpu.memory_headroom() == 0


@pytest.mark.parametrize("settings", [{"cpu_assistance": "turbo"}, {"cpu_assistance": {}}, {"preload_ram_mb": 0}, {"preload_ram_mb": 4096}, {"preload_ram_mb": 64.5}, {"preload_ram_mb": True}])
def test_bad_settings_are_rejected(settings):
    with pytest.raises(ValueError):
        cpu.validate_settings(settings)


def test_preloading_overlaps_consumer_without_reordering_or_exceeding_budget():
    second_started = threading.Event()
    def load(item):
        if item == 1:
            second_started.set()
        return item
    plan = {"workers": 4, "budget_bytes": 20, "mode": "balanced"}
    with cpu.PreparationPool(range(8), load, lambda _: 10, plan, headroom=lambda: 100) as pool:
        assert next(pool) == 0
        assert second_started.wait(2)
        assert list(pool) == list(range(1, 8))
        assert pool.snapshot()["peak_estimated_preload_mb"] <= 20 / cpu.MIB
        assert pool.peak_estimated_bytes <= 20
    assert all(not thread.is_alive() for thread in pool.executor._threads)


def test_pressure_or_large_inputs_disable_speculative_preloading():
    loaded = []
    headroom = [100]
    plan = {"workers": 2, "budget_bytes": 20, "mode": "auto"}
    with cpu.PreparationPool(range(3), lambda item: loaded.append(item) or item, lambda _: 30, plan, headroom=lambda: headroom[0]) as pool:
        assert next(pool) == 0
        assert loaded == [0]
        headroom[0] = 0
        assert next(pool) == 1
        assert loaded == [0, 1]
        assert pool.serial_fallbacks == 2
        assert not pool.pending


def test_worker_error_cleans_up_pending_threads():
    def load(item):
        if item == 0:
            raise ValueError("Cannot decode image")
        return item
    pool = cpu.PreparationPool(range(8), load, lambda _: 1, {"workers": 2, "budget_bytes": 20}, headroom=lambda: 100)
    with pytest.raises(ValueError, match="decode"):
        with pool:
            list(pool)
    assert pool.closed and not pool.pending
    assert all(not thread.is_alive() for thread in pool.executor._threads)


def test_async_cancellation_joins_cpu_preparation_before_exiting():
    async def scenario():
        started = threading.Event()
        release = threading.Event()
        def load(item):
            started.set()
            assert release.wait(3)
            return item
        pool = cpu.PreparationPool(range(2), load, lambda _: 1, {"workers": 1, "budget_bytes": 20}, headroom=lambda: 100)
        async def consume():
            async for _ in cpu.prepared_items(pool):
                pass
        task = asyncio.create_task(consume())
        assert await asyncio.to_thread(started.wait, 2)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert pool.closed
        assert all(not thread.is_alive() for thread in pool.executor._threads)
    asyncio.run(scenario())


def test_cpu_settings_roundtrip_and_reject_invalid_updates(lora_paths):
    project = lora_store.create_project("CPU settings")
    assert project["settings"]["cpu_assistance"] == "auto"
    settings = {**project["settings"], "cpu_assistance": "balanced", "preload_ram_mb": 512}
    saved = lora_store.update_project(project["id"], {"settings": settings})
    assert saved["settings"]["preload_ram_mb"] == 512
    with pytest.raises(ValueError):
        lora_store.update_project(project["id"], {"settings": {**settings, "preload_ram_mb": -1}})
    assert lora_store.get_project(project["id"])["settings"]["preload_ram_mb"] == 512
