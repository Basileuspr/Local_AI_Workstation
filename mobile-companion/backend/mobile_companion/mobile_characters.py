"""Phone profile intake using the workstation character store and public images."""
import hashlib
import json
import re

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from services import character_resources, image_library
from services.faces import bank

router = APIRouter(prefix='/api/characters')
ID = re.compile(r'^[a-f0-9]{32}$')
FIELDS = ('id', 'name', 'bio', 'notes', 'tags', 'created_at', 'updated_at')


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=120)
    bio: str = Field(default='', max_length=20000)
    notes: str = Field(default='', max_length=10000)
    tags: list[str] = Field(default_factory=list, max_length=40)

    @field_validator('name')
    @classmethod
    def valid_name(cls, value):
        value = value.strip()
        if not value or any(ord(character) < 32 for character in value):
            raise ValueError('Enter a character name without control characters.')
        return value

    @field_validator('tags')
    @classmethod
    def valid_tags(cls, value):
        if any(len(tag.strip()) > 60 for tag in value):
            raise ValueError('Tags must be at most 60 characters.')
        return value


class ProfileEdit(ProfileInput):
    expected_revision: str = Field(pattern=r'^[a-f0-9]{64}$')


class ImageLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    image_id: str = Field(pattern=r'^[a-f0-9]{32}$')


def revision(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def read_profile(character_id):
    if not ID.fullmatch(character_id):
        raise HTTPException(404, 'Character unavailable')
    try:
        with bank.LOCK:
            return bank._read(character_id)
    except ValueError:
        raise HTTPException(404, 'Character unavailable') from None


def visible_images():
    # The shared inventory rechecks vault locks. Do not forward paths, hashes,
    # review-only uploads or hidden/missing images to the phone.
    return {item['id']: {'id': item['id'], 'name': item['name'], 'url': '/api/media/library/' + item['id']}
            for item in image_library.public_index()['images']
            if ID.fullmatch(item['id']) and not item.get('hidden') and not item.get('review_only')
            and item.get('file_state') != 'missing'}


def snapshot(data):
    images, links = visible_images(), []
    for link in data.get('resources', []):
        if link['kind'] != 'image':
            continue
        image = images.get(link['target_id'])
        links.append({'id': link['id'], 'available': image is not None,
                      **({'image_id': image['id'], 'name': image['name'], 'url': image['url'], 'note': link.get('note', '')}
                         if image else {'name': 'Unavailable image reference'})})
    return {**{key: data.get(key) for key in FIELDS}, 'revision': revision(data), 'images': links}


@router.get('')
def characters(search: str = Query('', max_length=200), offset: int = Query(0, ge=0), limit: int = Query(24, ge=1, le=48)):
    query = search.strip().casefold()
    items = [{key: item.get(key) for key in ('id', 'name', 'tags', 'updated_at')}
             for item in bank.list_characters() if query in (item['name'] + ' ' + ' '.join(item['tags'])).casefold()]
    return {'characters': items[offset:offset + limit], 'total': len(items)}


@router.get('/images')
def images(search: str = Query('', max_length=200), offset: int = Query(0, ge=0), limit: int = Query(24, ge=1, le=48)):
    query = search.strip().casefold()
    items = [image for image in visible_images().values() if query in image['name'].casefold()]
    return {'images': items[offset:offset + limit], 'total': len(items)}


@router.post('', status_code=201)
def create(body: ProfileInput):
    try:
        data = bank.create_character(**body.model_dump())
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return snapshot(data)


@router.get('/{character_id}')
def profile(character_id: str):
    return snapshot(read_profile(character_id))


@router.patch('/{character_id}')
def edit(character_id: str, body: ProfileEdit):
    try:
        with bank.LOCK:
            current = read_profile(character_id)
            if revision(current) != body.expected_revision:
                raise HTTPException(409, 'Character changed on the desktop. Your draft is kept; reload saved values before trying again.')
            data = bank.update_character(character_id, **body.model_dump(exclude={'expected_revision'}, exclude_unset=True))
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return snapshot(data)


@router.post('/{character_id}/images')
def link_image(character_id: str, body: ImageLink):
    read_profile(character_id)
    if body.image_id not in visible_images():
        raise HTTPException(404, 'Image unavailable')
    try:
        character_resources.add(character_id, 'image', body.image_id)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return snapshot(read_profile(character_id))


@router.delete('/{character_id}/images/{link_id}')
def unlink_image(character_id: str, link_id: str):
    with bank.LOCK:
        data = read_profile(character_id)
        if not ID.fullmatch(link_id) or not any(link['id'] == link_id and link['kind'] == 'image' for link in data.get('resources', [])):
            raise HTTPException(404, 'Image reference unavailable')
        character_resources.unlink(character_id, link_id)
    return snapshot(read_profile(character_id))
