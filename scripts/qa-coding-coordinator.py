"""Explicit local-model acceptance on disposable Git projects, never the app checkout.

python scripts/qa-coding-coordinator.py --live --output <outside-repo-folder> [--compare]
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Allow local Ollama inference')
    parser.add_argument('--model', default='gpt-oss:20b')
    parser.add_argument('--context', type=int, default=8192)
    parser.add_argument('--output', required=True)
    parser.add_argument('--compare', action='store_true', help='Also run the same fixture without the separate reviewer')
    args = parser.parse_args()
    if not args.live:
        parser.error('Use --live to explicitly enable local model inference.')
    root = Path(args.output).resolve()
    if root.exists():
        parser.error('Choose a new output folder; existing evidence is never overwritten.')
    if root.is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error('Acceptance output must stay outside the source checkout.')
    root.mkdir(parents=True)
    for key, folder in [('LAW_DATA_DIR', 'data'), ('LAW_LOG_DIR', 'logs'), ('LAW_MODELS_DIR', 'models'), ('LAW_IMAGE_MANAGER_DIR', 'images')]:
        os.environ[key] = str(root / folder)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
    from services.coding_coordinator import CodingCoordinator
    from services.coding_project import git, digest

    async def exercise():
        results = []
        for mode in (['coordinator', 'single-agent'] if args.compare else ['coordinator']):
            project = root / mode
            project.mkdir()
            git(project, 'init')
            git(project, 'config', 'user.name', 'Local acceptance fixture')
            git(project, 'config', 'user.email', 'fixture@example.invalid')
            (project / 'arithmetic.py').write_text('def add(a, b):\n    """Return the sum of two numbers."""\n    return a - b\n', encoding='utf-8')
            (project / 'check.py').write_text('from arithmetic import add\nassert add(2, 3) == 5\nassert add(-4, 4) == 0\nassert add(0, 0) == 0\nprint("3 arithmetic checks passed")\n', encoding='utf-8')
            (project / 'AGENTS.md').write_text('Read arithmetic.py and check.py. Fix only arithmetic.py. Do not modify checks. Preserve user-notes.txt. Do not commit or push.\n', encoding='utf-8')
            (project / 'user-notes.txt').write_text('original\n', encoding='utf-8')
            git(project, 'add', '.')
            git(project, 'commit', '-m', 'Acceptance fixture')
            (project / 'user-notes.txt').write_text('Pre-existing user edit: keep exactly.\n', encoding='utf-8')
            before = digest((project / 'user-notes.txt').read_bytes())
            check_before = digest((project / 'check.py').read_bytes())
            head = git(project, 'rev-parse', 'HEAD')
            manager = CodingCoordinator(root / ('runs-' + mode))
            started = time.monotonic()
            task = await manager.start(str(project), 'Fix add so it returns the sum. Inspect the source and checks, preserve the existing user notes, make the smallest change, run the configured arithmetic check, and finish.',
                args.model, [{'name': 'Arithmetic checks', 'argv': [sys.executable, 'check.py'], 'timeout_seconds': 30}],
                context_tokens=args.context, max_rounds=16, review=mode == 'coordinator')
            last = None
            while not manager._task.done():
                current = manager.get(task['id'])
                marker = (current['status'], current['phase'])
                if marker != last:
                    print(mode, *marker, flush=True)
                    last = marker
                await asyncio.sleep(2)
            await manager._task
            result = manager.get(task['id'])
            assertions = {
                'completed': result['status'] == 'completed',
                'checks_passed': bool(result['check_results']) and result['check_results'][-1]['passed'],
                'notes_preserved': digest((project / 'user-notes.txt').read_bytes()) == before,
                'checks_unchanged': digest((project / 'check.py').read_bytes()) == check_before,
                'head_unchanged': git(project, 'rev-parse', 'HEAD') == head,
                'only_requested_file_changed': [change['path'] for change in result['changes']] == ['arithmetic.py'],
            }
            report = {'mode': mode, 'model': args.model, 'seconds': round(time.monotonic() - started, 2),
                      'assertions': assertions, 'run': result}
            (root / (mode + '.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
            results.append(report)
            print(json.dumps({'mode': mode, 'seconds': report['seconds'], 'assertions': assertions}), flush=True)
        (root / 'summary.json').write_text(json.dumps([{key: item[key] for key in ('mode', 'model', 'seconds', 'assertions')} for item in results], indent=2), encoding='utf-8')
        return all(all(item['assertions'].values()) for item in results)
    return 0 if asyncio.run(exercise()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
