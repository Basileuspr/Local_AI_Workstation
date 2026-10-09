"""Credentials have no role in public retrieval or local research evidence."""
import re
from services.app_logging import redact


def clean(value):
    text=redact(str(value))
    text=re.sub(r'((?:password|passwd|cookie|set-cookie|authorization|token|secret|sessionid|session|csrf|api[_ -]?key|x-local-files)["\']?\s*[:=]\s*)[^\r\n]*',r'\1[redacted]',text,flags=re.I)
    text=re.sub(r'(https?://)[^\s/]+:[^\s/]+@',r'\1',text,flags=re.I)
    return re.sub(r'([?&#](?:code|state|access_token|refresh_token|id_token|client_secret|password|token|session|csrf|signature|sig|key)=)[^&#\s"\']*',r'\1[redacted]',text,flags=re.I)
