"""Read an already configured private Tailscale Serve proxy; never configure it."""
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.parse import urlsplit

from .connection_setup import MobileListen


def serve_connections(value, port):
    found = {}
    if not isinstance(value, dict):
        return []
    configs = [value]
    foreground = value.get('Foreground', {})
    if isinstance(foreground, dict):
        configs.extend(item for item in foreground.values() if isinstance(item, dict))
    for config in configs:
        web, tcp, funnel = config.get('Web', {}), config.get('TCP', {}), config.get('AllowFunnel', {})
        if not all(isinstance(item, dict) for item in (web, tcp, funnel)):
            continue
        for host, entry in web.items():
            try:
                if not isinstance(entry, dict) or funnel.get(host) or value.get('AllowFunnel', {}).get(host):
                    continue
                origin = urlsplit('https://' + host)
                if not tcp.get(str(origin.port or 443), {}).get('HTTPS'):
                    continue
                handlers = entry.get('Handlers', {})
                proxy = urlsplit(handlers.get('/', {}).get('Proxy', ''))
                if (proxy.scheme != 'http' or proxy.hostname not in {'127.0.0.1', 'localhost'} or proxy.port != port
                        or proxy.path not in {'', '/'} or proxy.username or proxy.password or proxy.query or proxy.fragment):
                    continue
                setup = MobileListen(origin='https://' + host, port=port).model_dump()
                found[setup['origin']] = setup
            except (ValueError, TypeError, AttributeError):
                continue
    return [found[key] for key in sorted(found)]


def discover_connection(port=8766):
    executable = shutil.which('tailscale')
    if not executable and os.name == 'nt':
        candidate = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'Tailscale' / 'tailscale.exe'
        if candidate.is_file():
            executable = str(candidate)
    if not executable:
        raise ValueError('Tailscale is not installed here. Enter the HTTPS address from your existing private connection setup.')
    try:
        result = subprocess.run([executable, 'serve', 'status', '--json'], capture_output=True, timeout=6,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode or len(result.stdout) > 262144:
            raise ValueError()
        candidates = serve_connections(json.loads(result.stdout), port)
    except (OSError, subprocess.SubprocessError, ValueError):
        raise ValueError('Could not read Tailscale Serve status. Open Tailscale and check your existing private connection.') from None
    if not candidates:
        raise ValueError('No private HTTPS Serve address forwards to this listen port. Check the port or enter your existing HTTPS address. No network settings were changed.')
    return {'connections': candidates}
