r"""R02 synthetic benchmark. Never imports the backend against real user data.

Cold means an empty APPLICATION metadata cache, not a flushed Windows disk
cache. Bytes are session JSON file bytes parsed, not physical device I/O.
Run with venv\Scripts\python.exe -B scripts/benchmark-session-metadata.py
    --output docs/application-review/benchmarks/session-metadata.json
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import statistics
import sys
import tempfile
import time


def baseline_summaries(store):
    """The pre-R02 algorithm: parse every session to return six summary fields."""
    summaries = []
    for path in store.SESSIONS_DIR.glob("*.json"):
        with open(path, encoding="utf-8") as stream:
            session = json.load(stream)
        summaries.append({"id": session["id"], "title": session["title"],
            "created_at": session["created_at"], "updated_at": session["updated_at"],
            "model": session.get("model"), "message_count": len(session.get("messages", []))})
    return sorted(summaries, key=lambda item: item["updated_at"], reverse=True)


def baseline_images(store, hidden=False):
    """Pre-R02 unlocked-image algorithm, using already-stable synthetic IDs.

    Fixtures need no legacy writes. Vault inspection is included, and inline
    hashing was conditional on locks in the original algorithm.
    """
    from services import image_vault
    assert not image_vault.locked_hashes()
    images = []
    for path in store.SESSIONS_DIR.glob("*.json"):
        with open(path, encoding="utf-8") as stream:
            session = json.load(stream)
        store._ensure_stable_ids(session)
        messages = session["messages"]
        hidden_ids = set(session["hidden_gallery_image_ids"])
        for message_index in range(len(messages) - 1, -1, -1):
            message = messages[message_index]
            records = store._message_image_records(message)
            for image_index in range(len(records) - 1, -1, -1):
                record = records[image_index]
                image_id = record["id"]
                if (image_id in hidden_ids) != hidden:
                    continue
                images.append({
                    "id": f"{session['id']}:{message['id']}:{image_id}",
                    "session_id": session["id"], "session_title": session["title"],
                    "message_id": message["id"], "image_id": image_id,
                    "message_index": message_index, "image_index": image_index,
                    "name": record.get("name") or f"Chat image {image_index + 1}",
                    "type": record.get("type"), "size": record.get("size"),
                    **({"seed": record["seed"]} if "seed" in record else {}),
                    "source": record.get("source") or "uploaded",
                    "updated_at": session["updated_at"],
                    "url": f"/sessions/{session['id']}/images/by-id/{message['id']}/{image_id}",
                })
    return sorted(images, key=lambda item: item["updated_at"], reverse=True)


@contextmanager
def read_meter(directory):
    original = json.load
    counter = {"session_json_reads": 0, "session_json_bytes": 0}
    def load(stream, *args, **kwargs):
        path = Path(stream.name)
        if path.parent == directory:
            counter["session_json_reads"] += 1
            counter["session_json_bytes"] += path.stat().st_size
        return original(stream, *args, **kwargs)
    json.load = load
    try:
        yield counter
    finally:
        json.load = original


def measure(directory, function, repeats=1):
    samples = []
    value = None
    for _ in range(repeats):
        with read_meter(directory) as counter:
            start = time.perf_counter()
            value = function()
            elapsed = (time.perf_counter() - start) * 1000
        samples.append({"ms": round(elapsed, 3), **counter})
    return {"median_ms": round(statistics.median(s["ms"] for s in samples), 3),
            "samples": samples}, value


def fixtures(directory, count):
    directory.mkdir()
    for index in range(count):
        messages = [{"id": f"m-{m}", "role": "user" if m % 2 == 0 else "assistant",
                     "content": "Synthetic retained conversation. " + "x" * 1024}
                    for m in range(40)]
        for image in range(3):
            messages[image * 10 + 1]["generatedImages"] = [{"id": f"image-{image}",
                "src": "blob:" + f"{index * 3 + image:064x}", "name": f"image-{image}.png",
                "type": "image/png", "size": 123456, "seed": image}]
        value = {"id": f"chat-{index:05d}", "title": f"Synthetic chat {index}",
            "created_at": "2026-09-01T00:00:00", "updated_at": f"2026-09-30T12:{index % 60:02d}:00",
            "model": "synthetic", "messages": messages, "hidden_gallery_image_ids": ["image-2"]}
        (directory / f"{value['id']}.json").write_text(json.dumps(value), encoding="utf-8")


def run(sizes, repeats):
    with tempfile.TemporaryDirectory(prefix="law-r02-benchmark-") as temporary:
        scratch = Path(temporary)
        # Set every application data location before importing settings/services.
        os.environ.update(LAW_DATA_DIR=str(scratch / "data"), LAW_LOG_DIR=str(scratch / "logs"),
                          LAW_MODELS_DIR=str(scratch / "models"), PYTHONDONTWRITEBYTECODE="1")
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
        from services import session_store as store
        results = []
        for size in sizes:
            directory = scratch / f"sessions-{size}"
            fixtures(directory, size)
            store.SESSIONS_DIR = directory
            record = {"chats": size, "total_session_json_bytes": sum(p.stat().st_size for p in directory.glob("*.json"))}
            old = lambda: (baseline_summaries(store), baseline_images(store), baseline_images(store, True))
            new = lambda: (store.list_sessions(), store.list_session_image_inventory())
            record["before_three_lists"], baseline = measure(directory, old, repeats)
            store.clear_session_metadata_cache()
            record["after_cold_two_lists"], actual = measure(directory, new)
            assert actual == (baseline[0], {"images": baseline[1], "hidden_images": baseline[2]})
            record["after_warm_two_lists"], _ = measure(directory, new, repeats)
            for label, function in (("summaries", store.list_sessions),
                                    ("image_inventory", store.list_session_image_inventory),
                                    ("visible_images", store.list_session_images),
                                    ("hidden_images", lambda: store.list_session_images(True))):
                store.clear_session_metadata_cache()
                record[f"after_cold_{label}"], _ = measure(directory, function)
                record[f"after_warm_{label}"], _ = measure(directory, function, repeats)
            assert len(actual[1]["images"]) == size * 2
            assert len(actual[1]["hidden_images"]) == size
            results.append(record)
            print(f"{size} chats: before {record['before_three_lists']['median_ms']} ms; "
                  f"cold {record['after_cold_two_lists']['median_ms']} ms; "
                  f"warm {record['after_warm_two_lists']['median_ms']} ms", flush=True)
        return {"measured_at_utc": datetime.now(timezone.utc).isoformat(),
            "python": platform.python_version(), "platform": platform.platform(),
            "method": "Synthetic service calls; before = summary + visible + hidden scans; after = summary + combined image inventory. Exact metadata equality asserted.",
            "fixture": {"messages_per_chat": 40, "content_padding_characters_per_message": 1024,
                        "images_per_chat": 3, "hidden_images_per_chat": 1, "images": "Blob references; no image payload files or user data"},
            "warm_repeats": repeats,
            "limits": ["Cold means an empty application metadata cache, not a flushed filesystem/device cache.",
                       "Session JSON bytes = sum of file sizes for full json.load reads; physical disk I/O is not measured.",
                       "Synthetic latency is not the user's library latency. HTTP serialization, renderer work, and GPU execution are excluded.",
                       "Warm requests still enumerate/stat every session and return all requested metadata. Cache is process-local and rebuilt after restart."],
            "results": results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sizes", nargs="+", type=int, default=[100, 1000, 5000])
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if any(size < 1 or size > 10000 for size in args.sizes) or not 1 <= args.repeats <= 20:
        parser.error("Use 1–10,000 chats per size and 1–20 repeats")
    report = run(args.sizes, args.repeats)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
