"""Application limits shared by image requests and workflow execution."""

MAX_IMAGE_STEPS = 200
MAX_IMAGE_GUIDANCE = 30
MIN_IMAGE_SIDE = 256
MAX_IMAGE_SIDE = 2048
STANDARD_IMAGE_SIDE = 1536


def resolution_limits(vram_bytes=None):
    """Conservative selectable ceilings, not a guarantee that every request fits."""
    gib = (vram_bytes or 8 * 1024 ** 3) / 1024 ** 3
    normal, extended = (1024, 1280) if gib <= 4 else (1024, 1536) if gib <= 6 else (1536, 2048)
    return {"min_side": MIN_IMAGE_SIDE, "standard_max_side": normal, "extended_max_side": extended,
            "vram_bytes": vram_bytes}


def current_resolution_limits():
    try:
        import torch
        memory = torch.cuda.get_device_properties(0).total_memory if torch.cuda.is_available() else None
    except (ImportError, AttributeError, OSError, RuntimeError):
        memory = None
    return resolution_limits(memory)


def validate_dimensions(width, height, allow_long_wait=False, limits=None):
    limits = limits or resolution_limits()
    maximum = limits["extended_max_side" if allow_long_wait else "standard_max_side"]
    if any(value < MIN_IMAGE_SIDE or value > maximum or value % 8 for value in (width, height)):
        raise ValueError(f"Image dimensions must be multiples of 8 from {MIN_IMAGE_SIDE} through {maximum}. Enable longer waits for larger sizes.")
