"""Versioned manual-review metadata shared by image and future media adapters."""
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from typing import Literal
from pathlib import Path
import stat

STATUS_TO_RATING = {'unreviewed': None, 'reviewed': None, 'accepted': 'liked', 'rejected': 'disliked'}
RATING_TO_STATUS = {None: 'unreviewed', 'liked': 'accepted', 'disliked': 'rejected'}


class ReviewFields(BaseModel):
    # Requests are patches: omission preserves data; empty text/list clears it.
    model_config = ConfigDict(extra='forbid')
    rating: Literal['liked', 'disliked'] | None = None
    caption: str = Field(default='', max_length=10000)
    tags: list[str] = Field(default_factory=list, max_length=100)
    category: str = Field(default='', max_length=120)
    project: str = Field(default='', max_length=120)
    favorite: StrictBool = False
    review_status: Literal['unreviewed', 'reviewed', 'accepted', 'rejected'] = 'unreviewed'


class MediaRecord(ReviewFields):
    """Read contract. Identity/location come from adapters, never edit requests."""
    schema_version: Literal[1] = 1
    media_id: str
    media_type: Literal['image', 'video']
    path: str | None = None
    file_state: Literal['present', 'missing', 'unavailable', 'changed', 'unchecked'] = 'unchecked'
    metadata: dict = Field(default_factory=dict)


def location(resolve, *, previous_path=None, expected_signature=None, signature=None):
    """Check filesystem metadata only; never follow an adapter-rejected path."""
    path = previous_path
    try:
        resolved = Path(resolve()).absolute()
        path = str(resolved)
        info = resolved.stat()
        state = 'present' if stat.S_ISREG(info.st_mode) else 'unavailable'
        if state == 'present' and signature and signature(info) != expected_signature:
            state = 'changed'
    except FileNotFoundError:
        state = 'missing'
    except (OSError, ValueError):
        state = 'unavailable'
    return {'path': path, 'file_state': state}


def media_record(source, identifier, *, media_type='image', manual=None, details=None, **file_location):
    return MediaRecord.model_validate({**metadata(manual), 'media_id': f'{source}:{identifier}',
        'media_type': media_type, 'metadata': details or {}, **file_location}).model_dump()


def metadata(value=None):
    """Read legacy records without modifying them or their original bytes."""
    value = value or {}
    rating = value.get('rating')
    return {'schema_version': 1, 'rating': rating,
            'caption': value.get('caption', ''), 'tags': list(value.get('tags', [])),
            'category': value.get('category', ''), 'project': value.get('project', ''),
            'favorite': bool(value.get('favorite', rating == 'liked')),
            'review_status': value.get('review_status', RATING_TO_STATUS[rating])}


def patch(current, changes):
    """Validate before writing; keep the legacy rating and status synchronized."""
    changes = ReviewFields.model_validate(changes).model_dump(exclude_unset=True)
    if 'tags' in changes:
        tags = [tag.strip() for tag in changes['tags']]
        if any(not tag or len(tag) > 80 for tag in tags):
            raise ValueError('Tags need 1 to 80 characters.')
        changes['tags'] = list(dict.fromkeys(tags))
    for field in ('category', 'project'):
        if field in changes: changes[field] = changes[field].strip()
    if 'review_status' in changes:
        rating = STATUS_TO_RATING[changes['review_status']]
        if 'rating' in changes and changes['rating'] != rating:
            raise ValueError('Review status and rating disagree.')
        changes['rating'] = rating
    elif 'rating' in changes:
        changes['review_status'] = RATING_TO_STATUS[changes['rating']]
    return {**metadata(current), **changes}
