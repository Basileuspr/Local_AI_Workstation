import socket
from types import SimpleNamespace as NS

import psutil
from services import network_diagnostics as network


def adapters(monkeypatch):
    monkeypatch.setattr(psutil, "net_if_stats", lambda: {"Wi-Fi": NS(isup=True), "Old VPN": NS(isup=False)})
    monkeypatch.setattr(psutil, "net_if_addrs", lambda: {
        "Wi-Fi": [NS(family=socket.AF_INET, address="192.168.1.20")],
        "Old VPN": [NS(family=socket.AF_INET, address="10.0.0.8")],
    })
    monkeypatch.setattr(network, "settings", NS(port=8123, ollama_base_url="http://127.0.0.1:11434"))


def test_detects_wildcard_ollama_and_only_suggests_active_private_adapters(monkeypatch):
    adapters(monkeypatch)
    monkeypatch.setattr(psutil, "net_connections", lambda **kwargs: [
        NS(status=psutil.CONN_LISTEN, laddr=NS(port=11434, ip="::")),
        NS(status=psutil.CONN_LISTEN, laddr=NS(port=8123, ip="127.0.0.1")),
    ])
    result = network.inspect_network()
    assert result["local_api"] == "http://127.0.0.1:8123"
    assert result["addresses"] == [{"name": "Wi-Fi", "address": "192.168.1.20"}]
    assert result["listeners_checked"]
    assert "bound beyond this PC" in result["warnings"][0]


def test_unavailable_permissions_are_not_reported_as_secure(monkeypatch):
    adapters(monkeypatch)
    def denied(**kwargs):
        raise psutil.AccessDenied()
    monkeypatch.setattr(psutil, "net_connections", denied)
    result = network.inspect_network()
    assert not result["listeners_checked"]
    assert "does not confirm" in result["warnings"][0]
