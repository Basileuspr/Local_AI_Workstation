"""One desktop backend writer per data directory, including orphaned launches."""
def acquire(data_dir):
    data_dir.mkdir(parents=True, exist_ok=True)
    handle = open(data_dir / ".backend.lock", "a+b")
    try:
        handle.seek(0, 2)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        import os
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise RuntimeError("Another backend owns this app data folder. Quit the previous workstation backend before restarting.") from None
    return handle  # Hold open for the process lifetime; never store a credential.
