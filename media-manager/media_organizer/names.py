"""File-name helpers shared by date and classification rules."""
import re

# '020_Snapchat-1.mp4', '01 - clip.mp4': sequence numbers added by export/copy tools.
# Only 1-3 digits, so a leading year ('2019 Trip.mp4') or camera date is never stripped.
_SEQ_PREFIX_RE = re.compile(r"^(\d{1,3})[ _.\-]+(?=\S)")


def split_sequence_prefix(stem: str) -> tuple[str, str]:
    """Return (stem without a leading sequence number, the removed prefix or '')."""
    m = _SEQ_PREFIX_RE.match(stem)
    if m and m.end() < len(stem):
        return stem[m.end():], m.group(0)
    return stem, ""
