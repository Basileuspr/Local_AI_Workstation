"""Signature-checked image decoding for files explicitly selected by the owner."""
from contextlib import contextmanager
from PIL import Image
from services.image_manager_metadata import open_local_image


@contextmanager
def open_upload_image(source):
    # The local reader bypasses Pillow's generic pixel-count veto without
    # changing global decoder policy. Format/structure errors still propagate.
    Image.init()
    with open_local_image(source, formats=set(Image.ID)) as image:
        yield image
