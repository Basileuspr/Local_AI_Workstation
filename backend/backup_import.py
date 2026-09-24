"""Validated offline backup import, with a durable journal and retained old data."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path

from maintenance import MARKER, checked_root, is_link, scan, write_atomic
from services.process_lock import acquire
from services.maintenance_paths import import_journal as journal_path

FORMAT = "local-workstation-backup-v1"
MAX_MANIFEST = 64 * 1024 * 1024
MAX_PREFERENCES = 16 * 1024 * 1024
MAX_FILES = 250_000


def storage_values(value):
    if not isinstance(value, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in value.items()):
        raise ValueError("Backup desktop preferences must contain string keys and values.")
    if len(json.dumps(value).encode("utf-8")) > MAX_PREFERENCES:
        raise ValueError("Backup desktop preferences are too large.")
    return value


def _json(payload):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError("Backup JSON contains duplicate keys.")
            result[key] = value
        return result
    try:
        return json.loads(payload, object_pairs_hook=unique)
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError("Backup contains invalid JSON.") from None


def _safe_name(name):
    if not isinstance(name, str) or not name or len(name) > 4096:
        raise ValueError("Backup contains an invalid file path.")
    for part in name.split("/"):
        if (not part or part in {".", ".."} or part.endswith((" ", "."))
                or any(ord(c) < 32 or c in '\\:*?"<>|' for c in part)
                or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:\..*)?", part)):
            raise ValueError("Backup contains an unsafe file path.")
    if name.startswith("data/") and name.split("/")[1].casefold() in {MARKER.casefold(), ".backend.lock"}:
        raise ValueError("Backup contains temporary maintenance state.")
    return name


def _digest(handle):
    handle.seek(0)
    digest = hashlib.sha256()
    while chunk := handle.read(1024 * 1024): digest.update(chunk)
    handle.seek(0)
    return digest.hexdigest()


def validate_backup(source, root=None, expected_digest=None, staging=None):
    """Validate and optionally stream to a fresh staging directory; never extractall."""
    root = checked_root(root)
    source = Path(source).absolute()
    if source.resolve() != source or source.resolve().is_relative_to(root) or not source.is_file() or is_link(source):
        raise ValueError("Choose a regular backup ZIP outside app data without redirected folders.")
    try:
        with source.open("rb") as handle:
            digest = _digest(handle)
            if expected_digest is not None and digest != expected_digest:
                raise ValueError("The selected backup changed. Select and review it again.")
            with zipfile.ZipFile(handle) as archive:
                infos = archive.infolist()
                if len(infos) > MAX_FILES + 2: raise ValueError("Backup contains too many files.")
                names = {}
                for info in infos:
                    if info.orig_filename != info.filename: raise ValueError("Backup contains an unsafe file path.")
                    name = _safe_name(info.filename)
                    mode = info.external_attr >> 16
                    if info.is_dir() or info.flag_bits & 1 or stat.S_IFMT(mode) not in {0, stat.S_IFREG}:
                        raise ValueError("Backup must contain regular, unencrypted files only.")
                    if name.casefold() in names: raise ValueError("Backup contains duplicate or conflicting paths.")
                    names[name.casefold()] = info
                # Windows paths are case-insensitive, including directory names.
                for name in names:
                    parts = name.split("/")
                    if any("/".join(parts[:n]) in names for n in range(1, len(parts))):
                        raise ValueError("Backup contains conflicting file and folder paths.")
                if "manifest.json" not in names or names["manifest.json"].filename != "manifest.json":
                    raise ValueError("Choose an EXPORT BACK-UP archive. Metadata ZIPs cannot be imported.")
                if names["manifest.json"].file_size > MAX_MANIFEST: raise ValueError("Backup manifest is too large.")
                manifest = _json(archive.read("manifest.json"))
                if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("content_backup") is not True:
                    raise ValueError("This backup format/version is not supported.")
                files = manifest.get("files")
                if not isinstance(files, list) or not files or len(files) > MAX_FILES:
                    raise ValueError("Backup file manifest is invalid.")
                expected = set()
                total = 0
                for entry in files:
                    if not isinstance(entry, dict): raise ValueError("Backup file manifest is invalid.")
                    name = _safe_name(entry.get("path"))
                    if name != "desktop/local-storage.json" and not name.startswith("data/"):
                        raise ValueError("Backup contains an unsupported content location.")
                    size, checksum = entry.get("bytes"), entry.get("sha256")
                    if type(size) is not int or size < 0 or not isinstance(checksum, str) or not re.fullmatch("[a-f0-9]{64}", checksum):
                        raise ValueError("Backup file length or checksum is invalid.")
                    if name in expected or name.casefold() not in names or names[name.casefold()].filename != name:
                        raise ValueError("Backup manifest does not match its files.")
                    if names[name.casefold()].file_size != size: raise ValueError("Backup file length does not match its manifest.")
                    if name == "desktop/local-storage.json" and size > MAX_PREFERENCES:
                        raise ValueError("Backup desktop preferences are too large.")
                    expected.add(name)
                    total += size
                if "desktop/local-storage.json" not in expected or {info.filename for info in infos} != expected | {"manifest.json", "RESTORE.txt"}:
                    raise ValueError("Backup has missing or unlisted files.")
                if staging is not None and shutil.disk_usage(staging).free < total + 16 * 1024 * 1024:
                    raise ValueError("Not enough free disk space to stage this backup. Current data was not replaced.")
                preferences = None
                for entry in files:
                    name = entry["path"]
                    target = None
                    if staging is not None and name.startswith("data/"):
                        target = staging.joinpath(*name.split("/")[1:])
                        if not target.resolve().is_relative_to(staging): raise ValueError("Unsafe backup extraction path.")
                        target.parent.mkdir(parents=True, exist_ok=True)
                    checksum, count, payload = hashlib.sha256(), 0, bytearray()
                    with archive.open(name) as reader:
                        writer = target.open("xb") if target is not None else None
                        try:
                            while chunk := reader.read(1024 * 1024):
                                count += len(chunk)
                                if count > entry["bytes"]: raise ValueError("Backup expanded beyond its declared file size.")
                                checksum.update(chunk)
                                if writer: writer.write(chunk)
                                if name == "desktop/local-storage.json": payload.extend(chunk)
                            if writer:
                                import os
                                writer.flush()
                                os.fsync(writer.fileno())
                        finally:
                            if writer: writer.close()
                    if count != entry["bytes"] or checksum.hexdigest() != entry["sha256"]:
                        raise ValueError("Backup checksum verification failed. Current data was not replaced.")
                    if name == "desktop/local-storage.json": preferences = storage_values(_json(payload))
                # Detect source replacement/modification during review/extraction.
                if _digest(handle) != digest: raise ValueError("Backup changed while it was being verified.")
                return {"archive": str(source), "sha256": digest, "desktop_storage": preferences,
                        "report": {"files": len(files) - 1, "bytes": total, "created_at": str(manifest.get("created_at", "Unknown"))[:100]}}
    except (zipfile.BadZipFile, EOFError, NotImplementedError):
        raise ValueError("Backup ZIP is damaged or uses unsupported compression.") from None


def _transaction(root):
    journal = journal_path(root)
    if not journal.exists(): return None
    if is_link(journal) or journal.resolve() != journal or journal.stat().st_size > 16384:
        raise ValueError("Import recovery journal is unsafe.")
    record = _json(journal.read_bytes())
    if not isinstance(record, dict) or record.get("version") != 1 or record.get("phase") not in {"prepared", "installed", "rolled-back"}:
        raise ValueError("Import recovery journal is invalid.")
    for key, suffix in [("staging", "stage-"), ("recovery", "before-")]:
        path = Path(record.get(key, "")).absolute()
        if path.parent != root.parent or not path.name.startswith(f".law-import-{root.name}-{suffix}") or path.resolve() != path:
            raise ValueError("Import recovery path is unsafe.")
        if path.exists():
            if is_link(path) or not path.is_dir(): raise ValueError("Import recovery path is unsafe.")
            scan(path)
        record[key] = str(path)
    return record


def import_status(root=None):
    root = checked_root(root)
    record = _transaction(root)
    return {"pending": record is not None, "recovery": record["recovery"] if record else None}


def import_backup(source, digest, confirmation, previous_storage, root=None):
    if confirmation != "IMPORT": raise ValueError("Type IMPORT to replace current app data.")
    if not isinstance(digest, str) or not re.fullmatch("[a-f0-9]{64}", digest):
        raise ValueError("Select and review the backup before importing.")
    root = checked_root(root)
    if journal_path(root).exists(): raise ValueError("Recover the interrupted import first.")
    if (root / MARKER).exists(): raise ValueError("Complete the interrupted reset before importing.")
    storage_values(previous_storage)
    scan(root)
    root.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".law-import-{root.name}-stage-", dir=root.parent)).resolve()
    try:
        validated = validate_backup(source, root, expected_digest=digest, staging=staging)
        recovery = Path(tempfile.mkdtemp(prefix=f".law-import-{root.name}-before-", dir=root.parent)).resolve()
        write_atomic(recovery / "desktop-local-storage.json", previous_storage)
        (recovery / "RECOVERY.txt").write_text("Private pre-import recovery copy. data/ contains the previous app data; desktop-local-storage.json contains its desktop preferences. Keep this folder until you are satisfied with the imported backup. If import was interrupted, use Recover previous data on the Dashboard. Do not merge these files into an active data directory.\n", encoding="utf-8")
        record = {"version": 1, "phase": "prepared", "staging": str(staging), "recovery": str(recovery)}
        write_atomic(journal_path(root), record)
        # The journal prevents new backend startup. Probe the old writer lock
        # before moving its directory; Windows requires the handle closed first.
        with acquire(root): pass
        scan(root)
        root.rename(recovery / "data")
        staging.rename(root)
        record["phase"] = "installed"
        write_atomic(journal_path(root), record)
        return {"ok": True, "desktop_storage": validated["desktop_storage"], "recovery": str(recovery)}
    except BaseException:
        # Once journaled, keep all material for retry/recovery. Before that,
        # only remove the verified, newly-created staging folder we own.
        if not journal_path(root).exists() and staging.exists():
            if staging.resolve().parent != root.parent or not staging.name.startswith(f".law-import-{root.name}-stage-"):
                raise ValueError("Unsafe staging cleanup path.")
            scan(staging)
            shutil.rmtree(staging)
        raise


def rollback_import(root=None):
    root = checked_root(root)
    record = _transaction(root)
    if not record: return {"pending": False}
    recovery, staging = Path(record["recovery"]), Path(record["staging"])
    preferences = storage_values(_json((recovery / "desktop-local-storage.json").read_bytes()))
    scan(root)
    if root.exists():
        with acquire(root): pass
    previous = recovery / "data"
    if previous.exists():
        if root.exists():
            retained = recovery / "imported-data"
            if retained.exists(): raise ValueError("Recovery already contains imported data; manual review is required.")
            root.rename(retained)
        previous.rename(root)
    elif not root.exists():
        raise ValueError("Previous app data is unavailable. The backend remains stopped.")
    if staging.exists(): staging.rename(recovery / "staged-data")
    record["phase"] = "rolled-back"
    write_atomic(journal_path(root), record)
    return {"pending": True, "desktop_storage": preferences, "recovery": str(recovery)}


def finish_import(root=None):
    root = checked_root(root)
    record = _transaction(root)
    if not record or record["phase"] not in {"installed", "rolled-back"}:
        raise ValueError("Import is not ready to finish.")
    journal_path(root).unlink()
    return {"ok": True}
