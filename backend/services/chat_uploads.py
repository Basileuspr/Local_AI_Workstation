"""Stream original chat images to disk and append a reference-only user turn."""
import math
import shutil
import tempfile
from pathlib import Path
from uuid import uuid4
from services import image_library, image_store, image_vault, session_store


def save_image(session_id, name, stream, model=None):
    if session_store.get_session(session_id) is None:
        raise LookupError('Chat not found')
    name = Path((name or 'Image').replace('\\', '/')).name
    with tempfile.TemporaryDirectory(prefix='law-chat-upload-') as directory:
        source = Path(directory) / 'image'
        with source.open('xb') as output:
            shutil.copyfileobj(stream, output, 1024 * 1024)
        info = image_library.inspect_file(source, name)
        if info['type'] not in {'image/png', 'image/jpeg', 'image/webp'}:
            raise ValueError('Choose a still PNG, JPEG or WebP image.')
        image_vault.require_public(info['sha256'])
        with source.open('rb') as content:
            reference = image_store.put_stream(content)
    message_id = uuid4().hex
    message = {'id': message_id, 'role': 'user',
        'content': f'[Image uploaded: {name} ({math.floor(info["size"] / 1024 + .5):,} KB)]',
        'images': [reference], 'imagePreviews': [{'id': uuid4().hex, 'src': reference,
            'name': name, 'type': info['type'], 'size': info['size']}]}
    saved = session_store.append_messages(session_id, [message], model=model)
    if saved is None:
        raise LookupError('Chat was deleted while saving the image')
    return {**session_store.public_session(saved), 'uploaded_message_id': message_id}
