import io
from types import SimpleNamespace

from services.desktop_control import watch_parent, contain_desktop_processes


def test_manual_server_does_not_listen_for_desktop_commands(monkeypatch):
    monkeypatch.delenv('LAW_DESKTOP_CONTROL', raising=False)
    server = SimpleNamespace(should_exit=False)
    assert watch_parent(server, io.StringIO('{"command":"shutdown"}\n')) is None
    assert not server.should_exit
    assert contain_desktop_processes() is None


def test_private_shutdown_command_uses_graceful_uvicorn_flag(monkeypatch):
    monkeypatch.setenv('LAW_DESKTOP_CONTROL', '1')
    server = SimpleNamespace(should_exit=False, force_exit=False)
    thread = watch_parent(server, io.StringIO('invalid\n[]\n{"command":"ignore"}\n{"command":"shutdown"}\n'))
    thread.join(timeout=2)
    assert not thread.is_alive()
    assert server.should_exit
    assert not server.force_exit


def test_parent_pipe_eof_also_shuts_down(monkeypatch):
    monkeypatch.setenv('LAW_DESKTOP_CONTROL', '1')
    server = SimpleNamespace(should_exit=False)
    thread = watch_parent(server, io.StringIO(''))
    thread.join(timeout=2)
    assert server.should_exit
