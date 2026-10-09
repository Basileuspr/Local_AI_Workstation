"""Fixed per-user Windows task, started only by the trusted desktop control."""
import asyncio
import base64
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import time

from config import settings
from services import web_state as state


def task_name():
    return 'LocalAIWorkstation-Web-'+hashlib.sha256(str(settings.data_dir.resolve()).lower().encode()).hexdigest()[:12]


def busy():
    if not state.root().exists():return False
    worker=state.setting('worker',{})
    return state.setting('background_enabled',False) or worker.get('status')!='stopped' and time.time()-worker.get('heartbeat',0)<15


def script(enabled):
    # All paths come from the running app, never a request or model argument.
    literal=lambda value:"'"+str(value).replace("'","''")+"'"
    name=literal(task_name())
    if not enabled:
        return f"$ErrorActionPreference='Stop'; if(Get-ScheduledTask -TaskName {name} -ErrorAction SilentlyContinue){{Disable-ScheduledTask -TaskName {name} | Out-Null}}"
    python=Path(sys.executable);hidden=python.with_name('pythonw.exe')
    if hidden.exists():python=hidden
    worker=Path(__file__).resolve().parents[1]/'web_worker.py'
    args=subprocess.list2cmdline(['-B',str(worker),'--data-root',str(settings.data_dir.resolve())])
    return f"""$ErrorActionPreference='Stop'
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action=New-ScheduledTaskAction -Execute {literal(python)} -Argument {literal(args)} -WorkingDirectory {literal(worker.parent)}
$login=New-ScheduledTaskTrigger -AtLogOn -User $identity
$watch=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$options=New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName {name} -Action $action -Trigger @($login,$watch) -Principal $principal -Settings $options -Description 'Local AI Workstation configured public web monitors. No credentials or model inference.' -Force | Out-Null
Start-ScheduledTask -TaskName {name}
"""


def powershell(code):
    encoded=base64.b64encode(code.encode('utf-16le')).decode()
    result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',encoded],
        capture_output=True,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if result.returncode:raise ValueError('Windows could not configure the background web task. Check Task Scheduler permissions; sources and checkpoints were preserved.')


async def configure(enabled):
    if os.name!='nt':raise ValueError('This desktop control requires Windows Task Scheduler. Use the documented headless worker/service on other systems.')
    state.set_setting('background_enabled',enabled)
    try:await asyncio.to_thread(powershell,script(enabled))
    except Exception:
        if enabled:state.set_setting('background_enabled',False)
        raise
    if not enabled:
        # Cooperative stop interrupts the active fetch before reporting quiescence.
        for _ in range(100):
            if not busy():break
            await asyncio.sleep(.1)
    return state.listing()
