"""Queryable context budgets; tokenizer-independent estimates and provider receipts."""
import math
import re
import time

import httpx
from config import settings

_limits = {}
_runtime_limits = {}


def remember_runtime_limit(model, limit):
    if type(limit) is int and limit >= 512:
        _runtime_limits[model] = (time.monotonic(), limit)


def effective_limit(model, trained=None):
    limit = min(trained, settings.num_ctx) if trained else settings.num_ctx
    runtime = _runtime_limits.get(model)
    if runtime and time.monotonic() - runtime[0] < 600:
        limit = min(limit, runtime[1])
    return limit


def remember_limit(model, model_info):
    lengths = [value for key, value in model_info.items()
               if str(key).endswith(".context_length") and type(value) is int and value > 0]
    trained = max(lengths) if lengths else None
    _limits[model] = (time.monotonic(), trained)
    return effective_limit(model, trained)


async def model_limit(model):
    cached = _limits.get(model)
    if cached and time.monotonic() - cached[0] < 600:
        return effective_limit(model, cached[1])
    try:
        async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
            response = await client.post(f"{settings.ollama_base_url}/api/show", json={"model": model})
            response.raise_for_status()
            return remember_limit(model, response.json().get("model_info") or {})
    except (httpx.HTTPError, ValueError, AttributeError):
        return effective_limit(model)


def estimate_text(text):
    text = str(text or "")
    return max(math.ceil(len(text) / 3), math.ceil(len(text.encode('utf-8')) / 2.5)) + math.ceil(len(re.findall(r"[{}\[\]();:=<>`]", text)) / 4)


def payload_usage(payload, provider=None):
    messages = payload.get("messages") or []
    system = sum(6 + estimate_text(item.get("content")) for item in messages if item.get("role") == "system")
    images = sum(len(item.get("images") or []) for item in messages) * 2048
    import json
    tools = estimate_text(json.dumps(payload['tools'], ensure_ascii=False)) if payload.get('tools') else 0
    estimated = sum(6 + estimate_text(item.get("content")) + estimate_text(item.get('thinking'))
                    + (estimate_text(json.dumps(item['tool_calls'], ensure_ascii=False)) if item.get('tool_calls') else 0)
                    for item in messages) + images + tools
    estimated = math.ceil(estimated * max(1, payload.get('_context_token_scale', 1)))
    limit = payload.get("options", {}).get("num_ctx", settings.num_ctx)
    output = payload.get("options", {}).get("num_predict", -1)
    output_reserve = output if output > 0 else min(4096, math.floor(limit * .45))
    exact = (provider or {}).get("prompt_eval_count")
    if type(exact) is not int or exact < 0:
        exact = None
    generated = (provider or {}).get("eval_count")
    if type(generated) is not int or generated < 0:
        generated = None
    used = exact if exact is not None else estimated
    return {"model": payload.get("model"), "configured_context_limit": limit,
            "count_kind": "provider_reported" if exact is not None else "estimate",
            "estimated_prompt_tokens": estimated, "prompt_tokens": used,
            "system_tokens_estimate": system, "image_tokens_estimate": images,
            "generated_tokens": generated, "remaining_tokens": max(0, limit - used - (generated or 0)),
            "output_reserve": output_reserve, "input_budget_remaining": max(0, limit - used - output_reserve - 512),
            "summarization_occurred": any(str(item.get("content", "")).startswith("Rolling session context") for item in messages),
            "application_trimming": bool(payload.get('_context_budget', {}).get('application_trimming')), "provider_trimming": "unknown",
            "input_target": payload.get('_context_budget', {}).get('input_target'),
            "adjustments": payload.get('_context_notices', []), "tool_tokens_estimate": tools,
            "over_budget_estimate": estimated + output_reserve + 512 > limit,
            "limitations": "Provider prompt counts describe the processed request, not the whole saved chat. Image/template estimates vary by model. Provider trimming is not reliably reported."}
