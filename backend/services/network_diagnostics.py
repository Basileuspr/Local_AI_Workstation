"""Best-effort local listener inventory. No network probes or firewall changes."""
import ipaddress
import socket
import threading
import time
from urllib.parse import urlsplit

from config import settings

_lock = threading.Lock()
_cached = None
_checked = 0


def inspect_network():
    import psutil
    result = {"local_api": f"http://127.0.0.1:{settings.port}", "addresses": [], "warnings": [], "listeners_checked": False}
    try:
        states = psutil.net_if_stats()
        for name, addresses in psutil.net_if_addrs().items():
            if name in states and not states[name].isup:
                continue
            for entry in addresses:
                if entry.family != socket.AF_INET:
                    continue
                address = ipaddress.ip_address(entry.address)
                if any(address in ipaddress.ip_network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10")):
                    result["addresses"].append({"name": name, "address": str(address)})
    except (OSError, psutil.Error, ValueError):
        result["warnings"].append("Network adapter addresses could not be read. Use ipconfig to choose this PC's private IPv4 address.")
    try:
        ollama = urlsplit(settings.ollama_base_url)
        port = ollama.port or (443 if ollama.scheme == "https" else 80)
        if ollama.hostname not in {"localhost", "127.0.0.1", "::1"}:
            result["warnings"].append("Ollama is configured at a remote address. PC bridge does not secure direct Ollama access.")
        listeners = psutil.net_connections(kind="tcp")
        exposed = sorted({item.laddr.ip for item in listeners if item.status == psutil.CONN_LISTEN and
                          item.laddr.port == port and not ipaddress.ip_address(item.laddr.ip).is_loopback})
        result["listeners_checked"] = True
        if exposed:
            result["warnings"].append("A listener on the Ollama port is bound beyond this PC (" + ", ".join(exposed) +
                "). For local-only Ollama, set OLLAMA_HOST=127.0.0.1:11434 in its launch environment and restart Ollama after work finishes. PC bridge does not need direct network access to Ollama.")
    except (OSError, psutil.Error, ValueError):
        result["warnings"].append("Listener exposure could not be checked with current OS permissions. This does not confirm that Ollama is local-only.")
    return result


def snapshot():
    global _cached, _checked
    with _lock:
        if _cached is None or time.monotonic() - _checked > 15:
            _cached = inspect_network()
            _checked = time.monotonic()
        return _cached
