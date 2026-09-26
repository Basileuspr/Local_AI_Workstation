"""Prototype local media organizer for large, messy phone-backup archives.

This first version handles .mp4 files only: it inventories, validates, hashes,
dates and classifies them, proposes a year-based destination (dry run), and
moves files only when explicitly asked to.
"""

__version__ = "0.1.0"
