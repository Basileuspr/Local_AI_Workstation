import json
import os
from pathlib import Path
import subprocess
import sys
import time

from services import web_state as state


def until(check,timeout=15):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        result=check()
        if result:return result
        time.sleep(.05)
    raise AssertionError('Worker fixture timed out.')


def test_independent_process_crash_recovery_and_single_writer(tmp_path,monkeypatch):
    monkeypatch.setenv('LAW_WEB_SYSTEM_DIR',str(tmp_path/'web-system'))
    fixture=Path(__file__).resolve().parents[1]/'fixtures'/'web_worker.py'
    state.set_setting('background_enabled',True)
    source=state.save_source(state.Source(name='Fixture',seed_url='https://site.example.com/',discover_sitemaps=False,discover_feeds=False,policy='notify_changes'))
    first=subprocess.Popen([sys.executable,str(fixture),str(tmp_path)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    second=None;duplicate=None
    try:
        until(lambda:state.listing()['jobs'] and state.listing()['jobs'][0]['checked']==1)
        uid=state.listing()['jobs'][0]['id']
        # A competing process exits without claiming or recovering our writer.
        duplicate=subprocess.run([sys.executable,str(fixture),str(tmp_path)],timeout=10,capture_output=True)
        assert duplicate.returncode==0 and state.job(uid)['state']=='RUNNING'
        first.kill();first.wait(timeout=5);(tmp_path/'release-second').touch()
        second=subprocess.Popen([sys.executable,str(fixture),str(tmp_path)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        until(lambda:state.job(uid)['state']=='COMPLETED')
        calls=(tmp_path/'requests.log').read_text().splitlines()
        assert calls.count(source['seed_url'])==1 and calls.count(source['seed_url']+'second')==2
        assert state.job(uid)['record']['checked']==2 and len(state.listing()['events'])==2
        state.set_setting('background_enabled',False);second.wait(timeout=10)
        assert second.returncode==0 and state.setting('worker')['status']=='stopped'
    finally:
        for process in (first,second):
            if process and process.poll() is None:process.kill();process.wait(timeout=5)
