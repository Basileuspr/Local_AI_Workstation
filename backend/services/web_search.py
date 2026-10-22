"""Documented search providers; no model calls, browser sessions or saved keys."""
import json
import os
import re
from urllib.parse import quote, urlencode, urlsplit

from services import web_state
from services.web_access import PageText, WebError, normalize_url, MAX_URL
from services.web_sanitize import clean

BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search'
_session_key = ''


def api_key():
    return _session_key or os.environ.get('LAW_BRAVE_SEARCH_API_KEY', '').strip()


def plain(value, limit):
    if not isinstance(value, str):
        return ''
    parser = PageText()
    parser.feed('<body>' + value[:8000] + '</body>')
    return clean(' '.join(parser.text().split()))[:limit]


def search_config(value=None):
    global _session_key
    if value is not None:
        provider = value.get('provider')
        if provider not in {'wikipedia', 'searxng', 'brave'}:
            raise WebError('Select a supported search provider.')
        endpoint = ''
        if provider == 'searxng':
            raw = value.get('endpoint', '')
            if urlsplit(raw).query or urlsplit(raw).fragment:
                raise WebError('The SearXNG endpoint must not contain a query or fragment.')
            endpoint = normalize_url(web_state.public_url(raw)).rstrip('/')
        key = value.get('api_key')
        if hasattr(key, 'get_secret_value'):
            key = key.get_secret_value()
        if key and (not isinstance(key, str) or not re.fullmatch(r'[\x21-\x7e]{1,512}', key)):
            raise WebError('The API key must contain only printable characters with no spaces.')
        # Only nonsensitive provider preferences go to the existing settings DB.
        web_state.set_setting('search', {'provider': provider, 'endpoint': endpoint})
        if value.get('clear_api_key'):
            _session_key = ''
        elif key:
            _session_key = key
    config = web_state.setting('search', {'provider': 'wikipedia', 'endpoint': ''})
    return {**config, 'key_configured': bool(api_key()),
            'key_source': 'session' if _session_key else ('environment' if api_key() else 'none')}


async def search(query, retriever, config):
    query = query.strip()
    if not 2 <= len(query) <= 300:
        raise WebError('Enter a search query between 2 and 300 characters.')
    if clean(query) != query:
        raise WebError('Remove credentials from the search query.')
    provider = config['provider']
    options = {}
    if provider == 'brave':
        key = api_key()
        if not key:
            raise WebError('Add a Brave Web Search API key in Search provider settings, or configure SearXNG.')
        url = BRAVE_URL + '?' + urlencode({'q': query, 'count': 10, 'safesearch': 'moderate', 'text_decorations': 'false'})
        options['brave_key'] = key
    elif provider == 'searxng':
        endpoint = normalize_url(web_state.public_url(config.get('endpoint', '')))
        if urlsplit(endpoint).query:
            raise WebError('The search endpoint must not contain a query.')
        url = endpoint + '?' + urlencode({'q': query, 'format': 'json', 'safesearch': 1})
    elif provider == 'wikipedia':
        url = 'https://en.wikipedia.org/w/api.php?' + urlencode({
            'action': 'query', 'list': 'search', 'srsearch': query, 'srlimit': 10, 'format': 'json', 'maxlag': 5})
    else:
        raise WebError('Select a supported search provider.')
    if len(url) > MAX_URL:
        raise WebError('The query is too long after URL encoding. Shorten it and search again.')
    origin = urlsplit(url)
    same_origin = lambda u: (urlsplit(u).scheme, urlsplit(u).netloc) == (origin.scheme, origin.netloc)
    try:
        _, status, _, body = await retriever.raw(url, boundary=same_origin, max_bytes=1024 * 1024, **options)
    except WebError as exc:
        hint = ' The SearXNG endpoint must allow JSON responses.' if provider == 'searxng' else ''
        raise WebError(str(exc) + hint) from None
    if status != 200:
        raise WebError('Search provider unavailable. Check its configuration and try later.')
    try:
        data = json.loads(body)
        if not isinstance(data, dict) or data.get('error'):
            raise ValueError()
        if provider == 'wikipedia':
            rows = data['query']['search']
        elif provider == 'brave':
            rows = data.get('web', {}).get('results', [])
        else:
            rows = data['results']
        if not isinstance(rows, list):
            raise ValueError()
    except (ValueError, KeyError, TypeError, AttributeError):
        raise WebError('Search provider returned an unreadable response. For SearXNG, verify JSON is enabled.') from None
    results, seen = [], set()
    for index, row in enumerate(rows[:50]):
        if not isinstance(row, dict):
            continue
        raw = row.get('url', '')
        if provider == 'wikipedia':
            if not isinstance(row.get('title'), str):
                continue
            raw = 'https://en.wikipedia.org/wiki/' + quote(row['title'].replace(' ', '_'), safe='')
        try:
            url = web_state.public_url(raw) if isinstance(raw, str) else ''
        except (ValueError, WebError):
            continue
        if not url or url in seen:
            continue
        seen.add(url)
        snippet = plain(row.get('description') or row.get('content') or row.get('snippet'), 600)
        results.append({'url': url, 'title': plain(row.get('title'), 300) or urlsplit(url).hostname,
                        'snippet': snippet, 'domain': urlsplit(url).hostname, 'provider': provider,
                        'provenance': 'search_snippet', 'score': 1 / (index + 1)})
        if len(results) >= 10:
            break
    return results
