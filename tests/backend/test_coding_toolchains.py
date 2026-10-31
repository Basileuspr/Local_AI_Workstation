import os

from services import coding_toolchains


def test_discovers_portable_jdk_without_path_or_java_home(tmp_path, monkeypatch):
    monkeypatch.setattr(coding_toolchains, 'managed_root', lambda: tmp_path)
    monkeypatch.setattr(coding_toolchains.shutil, 'which', lambda _: None)
    monkeypatch.delenv('JAVA_HOME', raising=False)
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path / 'no-android-toolchain'))
    suffix = '.exe' if os.name == 'nt' else ''
    binary = tmp_path / 'jdk' / 'jdk-fixture' / 'bin'
    binary.mkdir(parents=True)
    for name in ['java', 'javac']:
        (binary / (name + suffix)).write_bytes(b'not an executable')

    tools = coding_toolchains.installed()

    assert tools['java'] == str((binary / ('java' + suffix)).resolve())
    assert tools['javac'] == str((binary / ('javac' + suffix)).resolve())
