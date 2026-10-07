"""Explicit version checks against the project's published manifest or an override."""
import os
from urllib.parse import urlsplit

import httpx
from packaging.version import Version, InvalidVersion
from services.software_specs import read_json
from config import PROJECT_ROOT


DEFAULT_UPDATE_MANIFEST_URL = "https://raw.githubusercontent.com/Basileuspr/Local_AI_Workstation/main/package.json"


async def check_updates(root=PROJECT_ROOT, manifest_url=None, client=None):
    current = read_json(root / "package.json").get("version")
    result = {"current_version": current, "latest_version": None, "status": "unable_to_check",
              "automatic_update": False, "source": None}
    url = manifest_url if manifest_url is not None else os.environ.get("LAW_UPDATE_MANIFEST_URL", DEFAULT_UPDATE_MANIFEST_URL)
    if not isinstance(url, str):
        return {**result, "detail": "Invalid release feed URL."}
    url = url.strip()
    if not url:
        return {**result, "detail": "Update checking is disabled by an empty release feed setting. Remove LAW_UPDATE_MANIFEST_URL to use the project's published manifest, or set an HTTPS JSON manifest containing version."}
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
                    if len(data) + len(chunk) > 65536:
                        raise ValueError("Release manifest too large")
                    data.extend(chunk)
                import json
                return json.loads(data)
        if client is None:
            async with httpx.AsyncClient(timeout=8, trust_env=False, follow_redirects=False) as connection:
                manifest = await read(connection)
        else:
            manifest = await read(client)
        if url == DEFAULT_UPDATE_MANIFEST_URL and manifest.get("name") != "local_ai_workstation":
            raise ValueError("Unexpected application manifest")
        latest = manifest["version"]
        if not isinstance(latest, str) or len(latest) > 80:
            raise ValueError("Invalid version")
        current_version, latest_version = Version(current), Version(latest)
        return {**result, "latest_version": latest,
                "status": "update_available" if latest_version > current_version else "up_to_date",
                "detail": "Published version checked. This compares version numbers, not development commits that share a version. Installation is a separate action."}
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError, InvalidVersion):
        return {**result, "detail": "Unable to read a valid release manifest. Check connectivity and feed configuration."}
