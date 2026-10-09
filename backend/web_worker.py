"""Independent, single-writer public-web monitor. No HTTP server or desktop token."""
import argparse
import asyncio
import os
from pathlib import Path
import signal
import time
from uuid import uuid4


async def serve(crawler=None, *, stop=None, poll=2):
    from config import settings
    from services import web_state as state
    from services.web_crawler import Crawler
    from services.process_lock import acquire
    from services.maintenance_paths import import_journal
    def maintenance():
        return import_journal(settings.data_dir).exists() or (settings.data_dir/'.reset-in-progress.json').exists()
    if maintenance():return
    try:lock=acquire(state.root()/'worker')
    except RuntimeError:return  # Task scheduler and manual CLI cannot double-own.
    owner=uuid4().hex;stop=stop or asyncio.Event();crawler=crawler or Crawler()
    def running():return not stop.is_set() and not maintenance() and state.setting('background_enabled',False)
    async def pulse():
        while running():
            state.heartbeat(owner,'running',time.time());await asyncio.sleep(min(poll,2))
    state.recover(owner,time.time());heartbeat=asyncio.create_task(pulse())
    try:
        while running():
            state.due(time.time());row=state.claim(owner,time.time())
            if row:await crawler.process(row,owner,running=running)
            else:
                try:await asyncio.wait_for(stop.wait(),poll)
                except TimeoutError:pass
    finally:
        heartbeat.cancel();await asyncio.gather(heartbeat,return_exceptions=True)
        state.heartbeat(owner,'stopped',time.time());lock.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root',required=True,type=Path)
    args=parser.parse_args()
    os.environ['LAW_DATA_DIR']=str(args.data_root.resolve())
    async def start():
        stop=asyncio.Event()
        def shutdown(*_):stop.set()
        signal.signal(signal.SIGTERM,shutdown);signal.signal(signal.SIGINT,shutdown)
        await serve(stop=stop)
    try:asyncio.run(start())
    except Exception:
        # Never log addresses, fetched bodies, provider credentials or tokens.
        raise SystemExit('Web monitor stopped unexpectedly; checkpoints are retained.') from None


if __name__=='__main__':main()
