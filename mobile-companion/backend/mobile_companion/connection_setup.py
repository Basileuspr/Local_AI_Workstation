"""Connection validation and offline setup retention; no listeners or job workers."""
import ipaddress
from urllib.parse import urlsplit
from pydantic import BaseModel, ConfigDict, Field, model_validator
from contextlib import closing
import json
import sqlite3


class MobileListen(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str = "127.0.0.1"
    port: int = Field(default=8766, ge=1024, le=65535)
    origin: str = Field(min_length=1, max_length=250)
    certificate: str = Field(default="", max_length=32767)
    private_key: str = Field(default="", max_length=32767)

    @model_validator(mode="after")
    def validate_listener(self):
        try:
            address = ipaddress.IPv4Address(self.address)
        except ValueError:
            raise ValueError("Use an explicit private IPv4 or 127.0.0.1 listener address.") from None
        private_ranges = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10")
        if self.address != "127.0.0.1" and not any(address in ipaddress.ip_network(network) for network in private_ranges):
            raise ValueError("Only loopback, private LAN and private VPN addresses are supported.")
        parsed = urlsplit(self.origin)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("Enter an HTTPS origin with no path, credentials or query.")
        if bool(self.certificate) != bool(self.private_key):
            raise ValueError("Provide both the trusted certificate and private-key paths.")
        if not self.certificate:
            if self.address != "127.0.0.1" or not parsed.hostname.endswith(".ts.net") or parsed.port not in {None, 443, 8443, 10000}:
                raise ValueError("Without certificate files, use 127.0.0.1 behind a private Tailscale Serve HTTPS origin ending in .ts.net.")
        elif parsed.hostname != self.address or (parsed.port or 443) != self.port:
            raise ValueError("Direct HTTPS origin must match the private listener address and port.")
        return self


def read_setup(root):
    """Read only the validated listener row, never devices, tokens or job content."""
    database = root / 'mobile' / 'bridge.sqlite3'
    if not database.exists():
        return None
    try:
        with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
            db.execute('PRAGMA trusted_schema=OFF')
            row = db.execute("SELECT value FROM settings WHERE key='listen'").fetchone()
        return MobileListen.model_validate_json(row[0]).model_dump() if row else None
    except (sqlite3.Error, ValueError):
        raise ValueError('Phone setup could not be read safely. Choose a full reset without retaining setup, or repair it first.') from None


def restore_setup(root, setup):
    if setup is None:
        return
    setup = MobileListen.model_validate(setup).model_dump()
    directory = root / 'mobile'
    directory.mkdir(exist_ok=True)
    # The old directory was removed. Build only the settings table; normal
    # startup creates empty access/job tables and still requires explicit Start.
    with closing(sqlite3.connect(directory / 'bridge.sqlite3')) as db, db:
        db.execute('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        db.execute('INSERT INTO settings VALUES (?,?)', ('listen', json.dumps(setup)))
