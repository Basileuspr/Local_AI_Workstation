"""Observe local Tailscale and private Serve setup; never configure the network."""
import json
import os
import re
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
    public_hosts = set()
    for config in configs:
        funnel = config.get('AllowFunnel', {})
        if not isinstance(funnel, dict):
            return []
        for host, enabled in funnel.items():
            if enabled:
                try:
                    origin = urlsplit('https://' + host)
                    public_hosts.add((origin.hostname, origin.port or 443))
                except (TypeError, ValueError):
                    return []
    for config in configs:
        web, tcp, funnel = config.get('Web', {}), config.get('TCP', {}), config.get('AllowFunnel', {})
        if not all(isinstance(item, dict) for item in (web, tcp, funnel)):
            continue
        for host, entry in web.items():
            try:
                if not isinstance(entry, dict) or funnel.get(host) or value.get('AllowFunnel', {}).get(host):
                    continue
                origin = urlsplit('https://' + host)
                if (origin.hostname, origin.port or 443) in public_hosts:
                    continue
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


def tailscale_executable():
    executable = shutil.which('tailscale')
    if not executable and os.name == 'nt':
        candidate = Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'Tailscale' / 'tailscale.exe'
        if candidate.is_file():
            executable = str(candidate)
    return executable


def read_status(executable, *arguments):
    result = subprocess.run([executable, *arguments], capture_output=True, timeout=6,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if result.returncode or len(result.stdout) > 262144:
        raise ValueError('Tailscale status unavailable')
    value = json.loads(result.stdout)
    if not isinstance(value, dict):
        raise ValueError('Unexpected Tailscale status')
    return value


def discover_connection(port=8766):
    executable = tailscale_executable()
    if not executable:
        raise ValueError('Tailscale is not installed here. Enter the HTTPS address from your existing private connection setup.')
    try:
        candidates = serve_connections(read_status(executable, 'serve', 'status', '--json'), port)
    except (OSError, subprocess.SubprocessError, ValueError):
        raise ValueError('Could not read Tailscale Serve status. Open Tailscale and check your existing private connection.') from None
    if not candidates:
        raise ValueError('No private HTTPS Serve address forwards to this listen port. Check the port or enter your existing HTTPS address. No network settings were changed.')
    return {'connections': candidates}


def tailscale_status(port=8766):
    """Return only this device's usable address, never peers, users or auth URLs."""
    def snapshot(state, message, **extra):
        return {'state': state, 'message': message, 'connections': [], 'suggested_origin': '',
                'serve_ready': False, **extra}

    executable = tailscale_executable()
    if not executable:
        return snapshot('missing', 'Tailscale is not installed on this desktop.')
    try:
        status = read_status(executable, 'status', '--json', '--peers=false')
        state = status.get('BackendState')
        if state in {'NeedsLogin', 'NeedsMachineAuth'}:
            return snapshot('login_required', 'Sign in to Tailscale and approve this device to detect its address.')
        device = status.get('Self')
        if state != 'Running' or not isinstance(device, dict) or device.get('Online') is not True:
            return snapshot('disconnected', 'Tailscale is disconnected. Connect it to detect the current address.')
        hostname = device.get('DNSName', '')
        hostname = hostname.lower().removesuffix('.') if isinstance(hostname, str) else ''
        label = r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
        if len(hostname) > 230 or not re.fullmatch(rf'{label}(?:\.{label})+\.ts\.net', hostname):
            return snapshot('connected', 'Tailscale is connected, but its HTTPS device name is unavailable. Check MagicDNS.')
        serve = read_status(executable, 'serve', 'status', '--json')
        connections = [value for value in serve_connections(serve, port)
                       if urlsplit(value['origin']).hostname == hostname]
        if connections:
            return snapshot('connected', f'Tailscale is connected. Private HTTPS forwarding is configured for port {port}.',
                            connections=connections, serve_ready=True)
        # Do not suggest a default HTTPS origin that already serves something
        # else, uses Funnel, or has an unrecognized configuration.
        configs = [serve]
        foreground = serve.get('Foreground', {})
        if not isinstance(foreground, dict):
            raise ValueError('Unexpected foreground setup')
        configs.extend(foreground.values())
        for config in configs:
            if not isinstance(config, dict):
                raise ValueError('Unexpected Serve setup')
            web, tcp, funnel = (config.get(key, {}) for key in ('Web', 'TCP', 'AllowFunnel'))
            if not all(isinstance(value, dict) for value in (web, tcp, funnel)):
                raise ValueError('Unexpected Serve setup')
            if '443' in tcp or any(host in web or funnel.get(host) for host in (hostname, hostname + ':443')):
                return snapshot('connected', f'Tailscale is connected, but its default HTTPS address has another or public setup. Configure a private Serve route to port {port}.')
        return snapshot('connected', f'Tailscale is connected. You can fill its address, but private HTTPS Serve forwarding to port {port} still needs setup.',
                        suggested_origin='https://' + hostname)
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        return snapshot('unavailable', 'Tailscale status is unavailable. Open Tailscale; detection will retry automatically.')
