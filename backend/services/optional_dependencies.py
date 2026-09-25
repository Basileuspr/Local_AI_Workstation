"""Feature-local failures must not prevent the desktop API from starting."""

import importlib


class FeatureUnavailable(RuntimeError):
    pass


def require(module: str, feature: str, requirements: str):
    try:
        return importlib.import_module(module)
    except (ImportError, OSError, RuntimeError) as exc:
        raise FeatureUnavailable(
            f"{feature} is unavailable on this installation. Its Python package or a native "
            f"Windows library could not load. Install {requirements} in the app's venv and "
            "restart the app. Other workspaces can still be used."
        ) from exc
