"""Model handoff under the running request's GPU lease, never on pane focus."""
import httpx

from services.request_queue import QueueCancelled, queue


def canonical_model(name):
    # A registry's port is not a tag. Ollama expands an omitted tag to :latest.
    return name if ":" in name.rsplit("/", 1)[-1] else name + ":latest"


def activity(job):
    return {"request_id": job.request_id, "session_id": job.session_id,
            "model": job.model, "stage": job.stage, "detail": job.stage_detail}


async def prepare_chat_model(job, model, base_url, *, options=None, request_queue=None):
    """Yield truthful progress before each provider operation; propagate failures.

    Empty generate requests load/unload without inference. Cancellation leaves
    admission with the handler until this operation has exited.
    """
    owner = request_queue or queue
    if owner.active is not job or job.status != "running":
        raise ValueError("Model changes require the running request's GPU lease")

    def check():
        if job.cancel_event.is_set():
            raise QueueCancelled("Model switch cancelled")

    def stage(value, detail):
        owner.set_stage(job, value, detail)
        return activity(job)

    check()
    yield stage("checking_model", f"Checking loaded models for {model}")
    async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=10.0)) as client:
        response = await client.get(f"{base_url}/api/ps")
        response.raise_for_status()
        loaded = list(dict.fromkeys(item.get("name") or item.get("model")
                     for item in response.json().get("models", [])
                     if item.get("name") or item.get("model")))
        others = [name for name in loaded if canonical_model(name) != canonical_model(model)]
        for name in others:
            check()
            yield stage("switching_models", f"Unloading {name}; next model: {model}")
            check()
            result = await client.post(f"{base_url}/api/generate",
                                      json={"model": name, "keep_alive": 0, "stream": False})
            result.raise_for_status()
            if result.json().get("error"):
                raise ValueError(result.json()["error"])
        check()
        if not any(canonical_model(name) == canonical_model(model) for name in loaded):
            yield stage("loading_model", f"Loading {model}")
            check()
            payload = {"model": model, "stream": False, "keep_alive": "5m"}
            if options:
                payload["options"] = options
            result = await client.post(f"{base_url}/api/generate", json=payload)
            result.raise_for_status()
            if result.json().get("error"):
                raise ValueError(result.json()["error"])
        check()
        # /ps verifies the handoff; never label a failed or incomplete unload ready.
        response = await client.get(f"{base_url}/api/ps")
        response.raise_for_status()
        names = [canonical_model(item.get("name") or item.get("model"))
                 for item in response.json().get("models", []) if item.get("name") or item.get("model")]
        if canonical_model(model) not in names or any(name != canonical_model(model) for name in names):
            raise ValueError("Model switch did not finish. Check Ollama and try again.")
    yield stage("responding", f"{model} is ready; preparing its response")
