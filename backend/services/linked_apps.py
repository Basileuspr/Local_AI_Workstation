"""Read technical process metadata without reading profiles or credentials."""
from pathlib import Path
import os
import psutil

NAMES = {'cura': {'ultimaker-cura.exe', 'cura.exe', 'curaengine.exe'},
         'discord': {'discord.exe'}, 'spotify': {'spotify.exe', 'spotifylauncher.exe'},
         'phone': {'scrcpy.exe', 'adb.exe'}}


def processes():
    found = {key: [] for key in NAMES}
    for process in psutil.process_iter(['pid', 'ppid', 'name', 'exe']):
        try:
            info = process.info
            for key, names in NAMES.items():
                if (info['name'] or '').lower() in names:
                    found[key].append({'pid': info['pid'], 'parent_pid': info['ppid'],
                                       'name': info['name'], 'executable': info['exe'] or ''})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return found


def cura_installation():
    candidates = [Path(os.environ['LAW_CURA_ENGINE'])] if os.environ.get('LAW_CURA_ENGINE') else []
    candidates += [Path(item['executable']).parent / 'CuraEngine.exe'
                   for item in processes()['cura'] if item['executable']]
    for directory in [Path(os.environ.get('ProgramFiles', 'C:/Program Files')),
                      Path(os.environ.get('LOCALAPPDATA', str(Path.home() / 'AppData/Local'))) / 'Programs']:
        if directory.is_dir():
            candidates += [folder / 'CuraEngine.exe' for folder in directory.glob('*Cura*')]
    for engine in candidates:
        definitions = engine.parent / 'share/cura/resources/definitions'
        if engine.is_file() and (definitions / 'fdmprinter.def.json').is_file():
            return engine.resolve(), definitions.resolve()
    raise ValueError('Open the installed Cura application, then refresh readiness, or set LAW_CURA_ENGINE to its CuraEngine executable.')
