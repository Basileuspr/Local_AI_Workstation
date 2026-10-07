"""Validated local dispatch and single-use review plans; never accept URLs or credentials from a model."""
import asyncio
import copy
import json
import re
import time
import uuid
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from jsonschema import Draft202012Validator

from services.session_guard import expected_token

MAX_ARGUMENT_BYTES = 64000
PLAN_TTL = 600
_plans = {}


def execution_policy(tool):
    endpoint = tool.get('endpoint') or {}
    if tool['availability'] != 'registered':
        return {'callable': False, 'reason': 'No registered backend route.'}
    if endpoint.get('content_type') not in (None, 'application/json'):
        return {'callable': False, 'reason': 'Use the workspace to supply uploaded files.'}
    if tool['id'] == 'discord_send':
        return {'callable': False, 'reason': 'Use the explicit Send control and supply credentials outside model context.'}
    if tool['id'].endswith(('_export', '_download')):
        return {'callable': False, 'reason': 'Download this file in its workspace.'}
    # A GET may still require review if it starts network or filesystem work.
    review = endpoint.get('method') != 'GET' or any(effect in tool['effects'] for effect in (
        'writes_app_data', 'writes_files', 'moves_source_files', 'deletes_files', 'system_changes', 'network', 'cancels_work'))
    return {'callable': True, 'requires_review': review,
            'reason': 'Review the exact arguments before execution.' if review else 'Runs when selected in opt-in chat tool use.'}


def _strict_schema(value):
    value = copy.deepcopy(value)
    if isinstance(value, dict):
        if value.get('type') == 'object' and 'properties' in value:
            value.setdefault('additionalProperties', False)
        return {key: _strict_schema(child) for key, child in value.items()}
    if isinstance(value, list):
        return [_strict_schema(child) for child in value]
    return value


def validate_call(registry, tool_id, arguments):
    tool = next((item for item in registry['tools'] if item['id'] == tool_id), None)
    if not tool or not execution_policy(tool)['callable']:
        raise HTTPException(400, 'This tool is not executable. Use its workspace.')
    try:
        serialized = json.dumps(arguments, allow_nan=False)
    except (TypeError, ValueError):
        raise HTTPException(422, 'Tool arguments must be a JSON object.')
    if len(serialized.encode()) > MAX_ARGUMENT_BYTES:
        raise HTTPException(413, 'Tool arguments exceed the size limit.')
    if not isinstance(arguments, dict) or 'header' in arguments or 'cookie' in arguments:
        raise HTTPException(422, 'Model-supplied headers and cookies are forbidden.')
    error = next(Draft202012Validator(_strict_schema(tool['input_schema'])).iter_errors(arguments), None)
    if error:
        location = '.'.join(map(str, error.absolute_path)) or 'arguments'
        raise HTTPException(422, f'Invalid tool arguments at {location} ({error.validator}).')
    if 'law_token' in arguments.get('query', {}):
        raise HTTPException(422, 'Credentials are supplied only by the trusted host.')
    for value in arguments.get('path', {}).values():
        if not isinstance(value, (str, int)) or str(value) in ('.', '..') or re.search(r'[/\\%?#\x00-\x1f]', str(value)):
            raise HTTPException(422, 'Invalid path identifier.')
    return tool


def create_plan(tool, arguments, *, cancel_event=None):
    for ident, entry in list(_plans.items()):
        if entry['expires'] <= time.monotonic():
            if not entry['future'].done(): entry['future'].set_result({'status': 'expired'})
            _plans.pop(ident, None)
    if len(_plans) >= 64:
        raise HTTPException(429, 'Too many tool actions await review.')
    ident = uuid.uuid4().hex
    plan = {'id': ident, 'tool_id': tool['id'], 'name': tool['name'],
            'arguments': copy.deepcopy(arguments), 'effects': tool['effects'],
            'status': 'pending', 'expires_in_seconds': PLAN_TTL}
    _plans[ident] = {'plan': plan, 'expires': time.monotonic() + PLAN_TTL,
                     'future': asyncio.get_running_loop().create_future(), 'cancel_event': cancel_event}
    return copy.deepcopy(plan)


def discard_plan(ident):
    entry = _plans.pop(ident, None)
    if entry and not entry['future'].done(): entry['future'].set_result({'status': 'cancelled'})


async def dispatch(app, tool, arguments):
    path = tool['endpoint']['path']
    for name, value in arguments.get('path', {}).items():
        path = path.replace('{' + name + '}', quote(str(value), safe=''))
    if '{' in path:
        raise HTTPException(422, 'Missing path identifier.')
    # Internal ASGI dispatch retains route validation, session guard and maintenance gate.
    # No model-selected URL, proxy, header, shell command or redirect is accepted.
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8000',
                                 headers={'X-LAW-Session': expected_token()}, trust_env=False) as client:
        response = await client.request(tool['endpoint']['method'], path,
                                        params=arguments.get('query'), json=arguments.get('body'))
    content_type = response.headers.get('content-type', '')
    if 'application/json' not in content_type:
        return {'status': 'failed', 'http_status': response.status_code, 'error': 'This tool returns a download; use its workspace.'}
    return {'status': 'completed' if response.is_success else 'failed',
            'http_status': response.status_code, 'result': response.json()}


async def decide_plan(app, registry, ident, approved):
    entry = _plans.pop(ident, None)  # Claim before awaiting: approval cannot replay.
    if not entry:
        raise HTTPException(404, 'Tool plan expired or already used.')
    future = entry['future']
    try:
        if entry.get('cancel_event') is not None and entry['cancel_event'].is_set():
            result = {'status': 'cancelled'}
        elif entry['expires'] <= time.monotonic():
            result = {'status': 'expired'}
        elif not approved:
            result = {'status': 'denied'}
        else:
            plan = entry['plan']
            tool = validate_call(registry, plan['tool_id'], plan['arguments'])
            result = await dispatch(app, tool, plan['arguments'])
        if not future.done(): future.set_result(result)
        return result
    except BaseException:
        if not future.done(): future.set_result({'status': 'failed', 'error': 'Tool execution interrupted.'})
        raise


def plan_future(ident):
    return _plans[ident]['future']


def model_tools(registry, selected):
    return [{'type': 'function', 'function': {
        'name': tool['id'].replace('.', '__'),
        'description': tool['description'] + (' Requires human review.' if tool['execution'].get('requires_review') else ''),
        'parameters': _strict_schema(tool['input_schema'])}}
        for tool in registry['tools'] if tool['id'] in selected and tool['llm_callable']]
