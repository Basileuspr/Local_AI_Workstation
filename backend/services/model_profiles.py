"""Metadata-derived starting settings; saved desktop profiles travel per request."""
import re

from config import settings
from services.thinking_trace import thinking_options, thinking_setting

MAX_CONTEXT = 262144


def trained_context(info):
    values = [v for k, v in (info.get('model_info') or {}).items()
              if str(k).endswith('.context_length') and type(v) is int and v > 0]
    return max(values) if values else None


def default_profile(info):
    trained = trained_context(info)
    ceiling = min(trained or settings.num_ctx, MAX_CONTEXT)
    context = min(settings.num_ctx, ceiling)
    choices = thinking_options(info)
    think = False if any(value is False for value in choices) else thinking_setting(info)
    sampling = {'temperature': .7, 'topP': .9, 'topK': 40, 'repeatPenalty': 1.1}
    for wire, field, low, high in [('temperature', 'temperature', 0, 2), ('top_p', 'topP', 0, 1),
                                    ('top_k', 'topK', 0, 1000), ('repeat_penalty', 'repeatPenalty', 0, 2)]:
        match = re.search(r'^' + wire + r'\s+([\d.]+)\s*$', info.get('parameters') or '', re.M)
        if match:
            try:
                value = float(match[1])
                if low <= value <= high:
                    sampling[field] = int(value) if field == 'topK' else value
            except ValueError:
                pass
    return {'contextWindow': context, 'responseLength': min(2048 if think not in (None, False) else 1024, max(128, context // 2)),
            'thinking': think, 'thinkingChoices': choices, 'maxContext': ceiling,
            'contextKnown': trained is not None, **sampling}
