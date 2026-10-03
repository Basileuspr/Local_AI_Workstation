"""Official embed URLs, explicit Discord delivery, and local playback recordings.

No user tokens are discovered or stored. Network calls happen only on Send.
"""
import json
from pathlib import Path
import re
import uuid
from urllib.parse import urlsplit
import httpx
from config import settings
from services import linked_apps, storage_libraries as storage

ROOT = settings.data_dir / 'artifacts' / 'playback'
MAX_AUDIO = 64 * 1024**2
MAX_ATTACHMENT = 10 * 1024**2


def embed_url(service, value):
    if service == 'spotify':
        match = re.fullmatch(r'spotify:(track|album|artist|playlist|episode|show):([A-Za-z0-9]{22})', value.strip())
        if not match:
            parsed = urlsplit(value.strip())
            if parsed.scheme != 'https' or parsed.netloc != 'open.spotify.com':
                raise ValueError('Paste an https://open.spotify.com link or a Spotify URI.')
            match = re.fullmatch(r'/(?:intl-[a-z-]+/)?(?:embed/)?(track|album|artist|playlist|episode|show)/([A-Za-z0-9]{22})/?', parsed.path)
        if not match: raise ValueError('Choose a Spotify track, album, artist, playlist, episode or show link.')
        return f'https://open.spotify.com/embed/{match[1]}/{match[2]}'
    if service == 'discord':
        if not re.fullmatch(r'\d{17,20}', value.strip()):
            raise ValueError('Enter the Discord server ID. Enable its Server Widget in Discord server settings.')
        return f'https://discord.com/widget?id={value.strip()}&theme=dark'
    raise ValueError('Unsupported linked application.')


def discord_payload(content='', title='', description='', image_name=''):
    if len(content) > 2000 or len(title) > 256 or len(description) > 4096:
        raise ValueError('Discord content, title or description exceeds its size limit.')
    payload = {'content': content, 'allowed_mentions': {'parse': []}}
    if title or description or image_name:
        embed = {key: value for key, value in [('title', title), ('description', description)] if value}
        if image_name: embed['image'] = {'url': 'attachment://' + image_name}
        payload['embeds'] = [embed]
    return payload


async def send_discord(value, attachments):
    # Construct the target from fixed origins. Redirects are deliberately disabled.
    auth = {}
    if value['method'] == 'webhook':
        parsed = urlsplit(value['webhook'].strip())
        if parsed.scheme != 'https' or parsed.netloc != 'discord.com' or not re.fullmatch(r'/api/(?:v\d+/)?webhooks/\d{17,20}/[A-Za-z0-9_.-]{20,200}', parsed.path):
            raise ValueError('Use an official https://discord.com/api/webhooks/... URL.')
        url = 'https://discord.com' + parsed.path + '?wait=true'
    elif value['method'] == 'bot':
        if not re.fullmatch(r'\d{17,20}', value['channel_id']) or not re.fullmatch(r'[A-Za-z0-9_.-]{20,200}', value['bot_token']):
            raise ValueError('Provide a channel ID and your bot token. Personal account tokens are unsupported.')
        url = f'https://discord.com/api/v10/channels/{value["channel_id"]}/messages'
        auth = {'Authorization': 'Bot ' + value['bot_token']}
    else: raise ValueError('Choose Webhook or Bot.')
    if len(attachments) > 10 or sum(len(raw) for _, raw, _ in attachments) > MAX_ATTACHMENT:
        raise ValueError('Choose at most 10 attachments, totaling no more than 10 MiB.')
    image = next((name for name, _, mime in attachments if mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')), '')
    payload = discord_payload(value['content'], value['title'], value['description'], image)
    if not (value['content'] or payload.get('embeds') or attachments): raise ValueError('Add a message, embed or file.')
    files = [(f'files[{index}]', (name, raw, mime)) for index, (name, raw, mime) in enumerate(attachments)]
    if files: payload['attachments'] = [{'id': i, 'filename': name} for i, (name, _, _) in enumerate(attachments)]
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            response = await client.post(url, headers=auth,
                **({'data': {'payload_json': json.dumps(payload)}, 'files': files} if files else {'json': payload}))
    except httpx.HTTPError as exc:
        raise ValueError('Discord could not be reached. No delivery confirmation was received; check Discord before retrying.') from None
    if response.status_code == 429: raise ValueError('Discord rate limited this request. Wait before retrying.')
    if not response.is_success: raise ValueError(f'Discord declined the request ({response.status_code}). Check the destination, bot permissions or webhook.')
    try: result = response.json()
    except ValueError: result = {}
    return {'ok': True, 'message_id': result.get('id'), 'channel_id': result.get('channel_id')}


def save_recording(raw):
    if not raw or len(raw) > MAX_AUDIO or not raw.startswith(b'\x1a\x45\xdf\xa3'):
        raise ValueError('Choose a captured WebM recording no larger than 64 MiB.')
    ident = uuid.uuid4().hex
    target = storage.resolve(ROOT / f'{ident}.webm', create=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    return {'id': ident, 'name': 'spotify-playback.webm', 'size': len(raw)}


def recording(ident):
    if not re.fullmatch(r'[a-f0-9]{32}', ident): raise FileNotFoundError('Recording not found.')
    file = storage.resolve(ROOT / f'{ident}.webm')
    if file.is_symlink() or not file.is_file(): raise FileNotFoundError('Recording not found.')
    return file


def phone_readiness():
    release = Path.home() / 'Downloads/scrcpy-win64-v3.3.4/scrcpy-win64-v3.3.4'
    source = Path.home() / 'Downloads/scrcpy-master/scrcpy-master'
    return {'ready': (release / 'scrcpy.exe').is_file() and (release / 'adb.exe').is_file(),
            'release': str(release) if (release / 'scrcpy.exe').is_file() else '',
            'source_available': (source / 'README.md').is_file(),
            'description': 'scrcpy mirrors and controls an Android phone; it does not emulate Android. USB debugging and device authorization are required. Audio forwarding requires Android 11 or later.'}
