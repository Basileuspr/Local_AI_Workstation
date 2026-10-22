"""Opt-in, single public-page smoke check using disposable local app data."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='https://www.python.org/about/')
parser.add_argument('--no-image', action='store_true')
args = parser.parse_args()
work = Path(tempfile.mkdtemp(prefix='law-web-preview-live-'))
os.environ['LAW_DATA_DIR'] = str(work / 'data')
os.environ['LAW_WEB_SYSTEM_DIR'] = str(work / 'web-system')
os.environ['LAW_LOG_DIR'] = str(work / 'logs')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from services.web_lookup import Lookup
from services import image_store


async def main():
    manager = Lookup()
    try:
        job = manager.start('preview', args.url, not args.no_image)
        stage = None
        while not manager.tasks[job['id']].done():
            current = manager.state(job['id'])
            if current['stage'] != stage:
                stage = current['stage']
                print(json.dumps({'stage':stage}), flush=True)
            await asyncio.wait({manager.tasks[job['id']]}, timeout=2)
        result = manager.state(job['id'])
        source = result.get('source') or {}
        images = source.get('images', [])
        report = {'status':result['status'], 'url':source.get('url'), 'title':source.get('title'),
                  'characters':source.get('char_count', 0), 'description':source.get('description'),
                  'images':len(images), 'image_bytes_readable':all(image_store.get_bytes(i['src']) is not None for i in images),
                  'warnings':result['warnings'], 'image_warnings':source.get('image_warnings', []),
                  'error':result.get('error'), 'artifacts':str(work), 'general_search_verified':False}
        (work / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report), flush=True)
        if not source.get('text') or (not args.no_image and not images):
            raise SystemExit('The requested live text/image preview was not fully verified. See report.')
    finally:
        await manager.close()


asyncio.run(main())
