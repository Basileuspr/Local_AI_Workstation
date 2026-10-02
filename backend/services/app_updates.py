"""Explicit, read-only update discovery. The operator selects the release feed."""
import os
from urllib.parse import urlsplit

import httpx
from packaging.version import Version, InvalidVersion
from services.software_specs import read_json
from config import PROJECT_ROOT


async def check_updates(root=PROJECT_ROOT, manifest_url=None, client=None):
    current = read_json(root / "package.json").get("version")
    result = {"current_version": current, "latest_version": None, "status": "unable_to_check",
              "automatic_update": False, "source": None}
    url = manifest_url if manifest_url is not None else os.environ.get("LAW_UPDATE_MANIFEST_URL", "")
    if not url:
        return {**result, "detail": "No release feed configured. Set LAW_UPDATE_MANIFEST_URL to an HTTPS JSON manifest containing version."}
    try:
        parsed = urlsplit(url)
    except ValueError:
        return {**result, "detail": "Invalid release feed URL."}
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        return {**result, "detail": "The release feed must be an HTTPS URL without credentials or a fragment."}
    result["source"] = url
    try:
        async def read(connection):
            async with connection.stream("GET", url, headers={"Accept": "application/json"}) as response:
                response.raise_for_status()
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 65536:
                        raise ValueError("Release manifest too large")
                import json
                return json.loads(data)
        if client is None:
            async with httpx.AsyncClient(timeout=8, trust_env=False, follow_redirects=False) as connection:
                manifest = await read(connection)
        else:
            manifest = await read(client)
        latest = manifest["version"]
        if not isinstance(latest, str) or len(latest) > 80:
            raise ValueError("Invalid version")
        current_version, latest_version = Version(current), Version(latest)
        return {**result, "latest_version": latest,
                "status": "update_available" if latest_version > current_version else "up_to_date",
                "detail": "Release feed checked. Installation is a separate action."}
    except (httpx.HTTPError, ValueError, TypeError, KeyError, InvalidVersion):
        return {**result, "detail": "Unable to read a valid release manifest. Check connectivity and feed configuration."}
