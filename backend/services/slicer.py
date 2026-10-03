"""Bounded, local CuraEngine jobs. Source files and Cura profiles are read only."""
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import uuid
from config import settings
from services import linked_apps, storage_libraries as storage

ROOT = settings.data_dir / 'artifacts' / 'slices'
MAX_FILE = 50 * 1024**2
_lock = threading.Lock()
_job = None
_process = None
_thread = None
_stop = threading.Event()
MATERIALS = {'pla': (200, 60), 'petg': (235, 75), 'abs': (245, 100)}


def readiness():
    try:
        engine, definitions = linked_apps.cura_installation()
        machines = [{'id': 'fdmprinter', 'name': 'Generic single-extruder printer · 220 × 220 × 250 mm'}]
        for file in sorted(definitions.glob('*.def.json')):
            try:
                value = json.loads(file.read_text(encoding='utf-8'))
                if value.get('metadata', {}).get('visible') and 'machine_extruder_trains' in value.get('metadata', {}):
                    trains = value['metadata']['machine_extruder_trains']
                    if len(trains) == 1:
                        machines.append({'id': file.name[:-9], 'name': value.get('name', file.stem)})
            except (ValueError, OSError):
                continue
        return {'ready': True, 'engine': str(engine), 'machines': machines, 'formats': ['stl']}
    except ValueError as exc:
        return {'ready': False, 'message': str(exc), 'machines': [], 'formats': ['stl']}


def status():
    with _lock:
        return {'job': dict(_job) if _job else None}


def start(raw, filename, options):
    global _job, _thread
    if not filename.lower().endswith('.stl') or not raw or len(raw) > MAX_FILE:
        raise ValueError('Choose a nonempty STL file no larger than 50 MiB.')
    engine, definitions = linked_apps.cura_installation()
    ready = readiness()
    if options['machine'] not in {machine['id'] for machine in ready['machines']}:
        raise ValueError('Choose a listed single-extruder printer profile.')
    if options['machine'] == 'fdmprinter' and not options['generic_confirmed']:
        raise ValueError('Confirm the generic printer dimensions before slicing.')
    with _lock:
        if (_thread and _thread.is_alive()) or (_job and _job['status'] in ('queued', 'running', 'stopping')):
            raise ValueError('Stop or finish the current slice first.')
        ident = uuid.uuid4().hex
        folder = storage.resolve(ROOT / ident, create=True)
        folder.mkdir(parents=True, exist_ok=False)
        (folder / 'input.stl').write_bytes(raw)
        name = re.sub(r'[^\w .-]', '_', Path(filename.replace('\\', '/')).stem)[:80].strip(' .') or 'model'
        _job = {'id': ident, 'status': 'queued', 'name': name + '.gcode', 'progress': 0, 'phase': 'Preparing',
                'elapsed_seconds': 0, 'options': options, 'message': ''}
        _stop.clear()
        _thread = threading.Thread(target=_run, args=(ident, folder, engine, definitions, options), daemon=True)
        _thread.start()
        return dict(_job)


def _run(ident, folder, engine, definitions, options):
    global _process
    started = time.monotonic()
    try:
        machine = definitions / (options['machine'] + '.def.json')
        data = json.loads(machine.read_text(encoding='utf-8'))
        extruder = data.get('metadata', {}).get('machine_extruder_trains', {}).get('0', 'fdmextruder')
        if not re.fullmatch(r'[\w-]+', extruder): raise ValueError('Invalid extruder definition.')
        extruder_file = definitions / (extruder + '.def.json')
        if not extruder_file.is_file():
            extruder_file = definitions.parent / 'extruders' / (extruder + '.def.json')
        if not extruder_file.is_file(): raise ValueError('The printer extruder definition is missing.')
        temperature, bed = MATERIALS[options['material']]
        values = {'layer_height': options['layer_height'], 'layer_height_0': options['layer_height'],
                  'infill_sparse_density': options['infill'], 'infill_line_distance': 0 if options['infill'] == 0 else options['nozzle'] * 100 / options['infill'],
                  'support_enable': str(options['support']).lower(), 'machine_nozzle_size': options['nozzle'],
                  'material_print_temperature': temperature, 'material_print_temperature_layer_0': temperature,
                  'material_bed_temperature': bed, 'material_bed_temperature_layer_0': bed,
                  'material_diameter': 1.75, 'machine_extruder_count': 1, 'extruder_nr': 0,
                  'adhesion_extruder_nr': 0, 'support_extruder_nr': 0, 'support_infill_extruder_nr': 0,
                  'support_interface_extruder_nr': 0, 'support_roof_extruder_nr': 0, 'support_bottom_extruder_nr': 0,
                  'center_object': 'true'}
        for key in ('line_width','wall_line_width','wall_line_width_0','wall_line_width_x','skin_line_width',
                    'infill_line_width','support_line_width','support_interface_line_width','roofing_line_width',
                    'flooring_line_width','skirt_brim_line_width'):
            values[key] = options['nozzle']
        if options['machine'] == 'fdmprinter':
            values.update(machine_width=220, machine_depth=220, machine_height=250,
                          machine_heated_bed=str(options['heated_bed']).lower(),
                          machine_start_gcode='G28\nG92 E0', machine_end_gcode='M104 S0\nM140 S0\nM84')
        # The CLI normally drops parent settings that also contain children.
        command = [str(engine), 'slice', '-p', '--force-read-parent', '-j', str(machine)]
        for key, value in values.items(): command += ['-s', f'{key}={value}']
        command += ['-e0', '-j', str(extruder_file), '-s', f'machine_nozzle_size={options["nozzle"]}',
                    '-s', f'material_print_temperature={temperature}', '-s', 'material_diameter=1.75',
                    '-l', str(folder / 'input.stl'), '-o', str(folder / 'output.gcode')]
        env = {**os.environ, 'CURA_ENGINE_SEARCH_PATH': os.pathsep.join([str(definitions), str(definitions.parent / 'extruders')])}
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        with (folder / 'engine.log').open('w', encoding='utf-8') as log:
            process = subprocess.Popen(command, stdout=log, stderr=log, env=env, cwd=folder,
                                       creationflags=creationflags, shell=False)
            with _lock:
                _process = process; _job.update(status='running', phase='Slicing')
            while process.poll() is None:
                if _stop.wait(.3) or time.monotonic() - started > 300:
                    process.kill(); process.wait(timeout=10)
                    if not _stop.is_set(): raise ValueError('Slicing reached the five-minute limit.')
                    break
                with (folder / 'engine.log').open('rb') as reader:
                    reader.seek(max(0, (folder / 'engine.log').stat().st_size - 8000))
                    tail = reader.read(8000).decode('utf-8', errors='replace')
                matches = re.findall(r'Progress:([^:]+):\d+:\d+:([0-9.]+)', tail)
                with _lock:
                    _job['elapsed_seconds'] = round(time.monotonic() - started, 1)
                    if matches:
                        phase, progress = matches[-1]
                        _job.update(phase=phase, progress=min(99, round(float(progress) * 100)))
        if _stop.is_set():
            with _lock: _job.update(status='cancelled', phase='Stopped')
        elif process.returncode or not (folder / 'output.gcode').is_file() or not (folder / 'output.gcode').stat().st_size:
            raise ValueError('CuraEngine could not slice this model. Check the STL and selected printer profile.')
        else:
            with _lock: _job.update(status='complete', progress=100, phase='G-code ready', bytes=(folder / 'output.gcode').stat().st_size)
    except Exception as exc:
        with _lock: _job.update(status='failed', message=str(exc), phase='Failed')
    finally:
        with _lock:
            _process = None; _job['elapsed_seconds'] = round(time.monotonic() - started, 1)
            saved = dict(_job)
        (folder / 'result.json').write_text(json.dumps(saved), encoding='utf-8')


def cancel(ident):
    with _lock:
        if not _job or _job['id'] != ident: raise ValueError('Slice job not found.')
        if _job['status'] in ('queued', 'running', 'stopping'):
            _stop.set(); _job['status'] = 'stopping'
        return dict(_job)


def output(ident):
    if not re.fullmatch('[a-f0-9]{32}', ident): raise FileNotFoundError('Slice not found.')
    folder = storage.resolve(ROOT / ident)
    try: value = json.loads((folder / 'result.json').read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc: raise FileNotFoundError('Slice output is unavailable.') from exc
    file = folder / 'output.gcode'
    if value['status'] != 'complete' or file.is_symlink() or not file.is_file(): raise FileNotFoundError('Slice output is unavailable.')
    return file, value['name']
