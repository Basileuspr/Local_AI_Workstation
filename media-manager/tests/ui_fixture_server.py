"""Disposable browser-test server; creates generated clips in a temporary folder."""
import json
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from unittest.mock import patch

from media_organizer import scan
from media_organizer.tools import find_tool
from media_organizer.ui_server import make_server


def main():
    with tempfile.TemporaryDirectory(prefix="organizer_browser_") as temp:
        root = Path(temp)
        source = root / "source"
        source.mkdir()
        ffmpeg = Path(find_tool("ffprobe").path).with_name("ffmpeg.exe")
        duplicates = '--duplicates' in sys.argv
        dimensions = '1280x720' if duplicates else '320x240'
        for name, color in [("VID_20200615_120000.mp4", "navy"), ("VID_20240820_153000.mp4", "teal"), ("VID_20240820_160000.mp4", "purple")]:
            subprocess.run([str(ffmpeg), "-v", "error", "-f", "lavfi", "-i", f"color=c={color}:s={dimensions}:d=1",
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source / name)], check=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if duplicates:
            copies = source / 'Backup copy'
            copies.mkdir()
            for name in ('VID_20200615_120000.mp4', 'VID_20240820_153000.mp4'):
                shutil.copy2(source / name, copies / name)
        image_source = root / 'images'
        if '--images' in sys.argv:
            image_source.mkdir()
            for i, color in enumerate(('red', 'blue', 'green', 'white')):
                subprocess.run([str(ffmpeg), '-v', 'error', '-f', 'lavfi', '-i', f'color={color}:s={80+i*20}x60', '-frames:v', '1', '-threads', '1', str(image_source / f'{i+1}.jpg')], check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        server = make_server(reports=str(root / "runs"))
        catalog_folders = []
        if '--catalog' in sys.argv:
            templates = root / 'templates'; templates.mkdir()
            for year, color in zip(range(2016, 2021), ('red', 'blue', 'green', 'orange', 'white')):
                subprocess.run([str(ffmpeg), '-v', 'error', '-f', 'lavfi', '-i', f'color={color}:s=320x240:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(templates / f'VID_{year}0615_120000.mp4')], check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            for i in range(5):
                folder = root / f'Videos {i+1}'; shutil.copytree(templates, folder); catalog_folders.append(str(folder))
                scan.run_scan(scan.ScanOptions(str(folder), str(root/'archive'), str(root/'runs'), use_exiftool=False, quiet=True), out=lambda *_:None)
            scan.run_scan(scan.ScanOptions(catalog_folders[0], str(root/'archive'), str(root/'runs'), use_exiftool=False, quiet=True), out=lambda *_:None)
        original_process_file = scan.process_file

        def delayed_process_file(candidate, index, context):
            # Stagger real analysis so the browser can observe measured progress.
            if not duplicates:
                time.sleep(index * 2)
            return original_process_file(candidate, index, context)
        print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}", "source": str(source),
                          "destination": str(root / "archive"), "reports": str(root / "runs"), "imageSource": str(image_source), "catalogFolders": catalog_folders}), flush=True)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with patch('media_organizer.scan.process_file', side_effect=delayed_process_file):
                sys.stdin.readline()
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == "__main__":
    main()
