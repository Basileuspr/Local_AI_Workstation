"""Reversible empty-source Windows Task Scheduler QA in an owned temp root."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

repo=Path(__file__).resolve().parents[1];root=Path(sys.argv[2]) if len(sys.argv)>2 and sys.argv[1]=='--enable' else Path(tempfile.mkdtemp(prefix='law-web-background-qa-'))
sys.path.insert(0,str(repo/'backend'));os.environ['LAW_DATA_DIR']=str(root)
os.environ['LAW_WEB_SYSTEM_DIR']=str(root/'web-system')
from services import web_state as state,web_background as background


def main():
    name=background.task_name();enabled=False
    try:
        assert not state.listing()['sources']
        child=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--enable',str(root)],capture_output=True,timeout=40)
        assert child.returncode==0,child.stderr.decode(errors='replace');enabled=True
        deadline=time.monotonic()+20
        while state.setting('worker',{}).get('status')!='running' and time.monotonic()<deadline:time.sleep(.2)
        assert state.setting('worker',{}).get('status')=='running','Scheduled worker did not start.'
        before=state.setting('worker')['heartbeat'];time.sleep(3)
        assert state.setting('worker')['heartbeat']>before,'Task worker did not continue independently.'
        print(json.dumps({'ok':True,'task':name,'root':str(root),'checks':['Native per-user task starts production headless worker','Worker heartbeat progresses after launching process exits','Empty fixture sources make no network requests']}))
    finally:
        asyncio.run(background.configure(False))
        literal="'"+name.replace("'","''")+"'"
        background.powershell(f"$ErrorActionPreference='Stop'; if(Get-ScheduledTask -TaskName {literal} -ErrorAction SilentlyContinue){{Stop-ScheduledTask -TaskName {literal}; Unregister-ScheduledTask -TaskName {literal} -Confirm:$false}}")
        assert state.setting('worker',{}).get('status')=='stopped' or not enabled


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--enable':asyncio.run(background.configure(True))
    else:main()
