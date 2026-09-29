"""Build ZIP copies from explicitly uploaded files; never read client paths."""
import os
import re
import tempfile
import zipfile
from pathlib import Path

MAX_ENTRIES = 1000
MAX_BYTES = 512 * 1024 * 1024


def archive_path(value):
    if not isinstance(value, str) or len(value.encode("utf-8")) > 1024:
        raise ValueError("Invalid package path.")
    parts = value.split("/")
    if any(not part or part in (".", "..") or re.search(r'[\\<>:"|?*\x00-\x1f]', part)
           or part.endswith((" ", "."))
           or re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", part, re.I) for part in parts):
        raise ValueError("Package paths must be safe relative file names.")
    return value


def package_name(value):
    name = re.sub(r'[\\/<>:"|?*\x00-\x1f]', "_", value.strip())[:120].strip(" .")
    if name.lower().endswith(".zip"):
        name = name[:-4].strip(" .")
    if not name:
        name = "Package"
    if re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", name, re.I):
        name = "_" + name
    return name + ".zip"


def build_package(files, entries, compression="compressed"):
    if not files or len(files) != len(entries) or len(entries) > MAX_ENTRIES:
        raise ValueError(f"Choose between 1 and {MAX_ENTRIES} files and folders.")
    if compression not in ("compressed", "stored"):
        raise ValueError("Choose compressed or stored ZIP format.")
    paths = {}
    for entry in entries:
        if not isinstance(entry, dict) or type(entry.get("directory")) is not bool:
            raise ValueError("Invalid package entry.")
        path = archive_path(entry.get("path"))
        key = path.casefold()
        if key in paths:
            raise ValueError("Package paths must be unique, including letter case.")
        paths[key] = entry["directory"]
    for path in paths:
        parts = path.split("/")
        for end in range(1, len(parts)):
            if paths.get("/".join(parts[:end])) is False:
                raise ValueError("A file and folder cannot share the same package path.")
    if sum(file.size or 0 for file in files) > MAX_BYTES:
        raise ValueError("Packages can contain up to 512 MiB of source files.")

    descriptor, target = tempfile.mkstemp(prefix="law-package-", suffix=".zip")
    os.close(descriptor)
    target = Path(target)
    try:
        total = 0
        method = zipfile.ZIP_DEFLATED if compression == "compressed" else zipfile.ZIP_STORED
        with zipfile.ZipFile(target, "w", compression=method, compresslevel=6 if method == zipfile.ZIP_DEFLATED else None) as archive:
            for file, entry in zip(files, entries):
                file.file.seek(0)
                if entry["directory"]:
                    if file.file.read(1):
                        raise ValueError("Folder entries cannot contain file data.")
                    archive.writestr(entry["path"] + "/", b"")
                    continue
                with archive.open(entry["path"], "w") as output:
                    while chunk := file.file.read(1024 * 1024):
                        total += len(chunk)
                        if total > MAX_BYTES:
                            raise ValueError("Packages can contain up to 512 MiB of source files.")
                        output.write(chunk)
        return target
    except BaseException:
        target.unlink(missing_ok=True)
        raise
