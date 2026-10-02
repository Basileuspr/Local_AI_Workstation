"""Authenticated, read-only tool discovery. No invocation/dispatch endpoint."""
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from services.tool_registry import build_registry, registry_markdown

router = APIRouter(prefix="/tools", tags=["tool-registry"])


def _registry(request):
    return build_registry(request.app.openapi())


@router.get("/registry")
def get_registry(request: Request, q: str = Query("", max_length=200), category: str = Query("", max_length=80)):
    """Versioned tool catalog with self-contained JSON input schemas."""
    registry = _registry(request)
    query = q.strip().casefold()
    registry["tools"] = [tool for tool in registry["tools"]
                         if (not category or tool["category"].casefold() == category.casefold())
                         and (not query or query in " ".join(str(tool[key]) for key in
                              ("id", "name", "description", "category", "workspace", "requirements")).casefold())]
    return registry


@router.get("/registry.md", response_class=PlainTextResponse)
def get_registry_markdown(request: Request):
    """Compact plain-text Markdown suitable for a local model's context."""
    return registry_markdown(_registry(request))


@router.get("/registry/{tool_id}")
def get_tool(request: Request, tool_id: str):
    """Fetch one full contract by stable tool ID."""
    registry = _registry(request)
    for tool in registry["tools"]:
        if tool["id"] == tool_id:
            return {"schema_version": registry["schema_version"], "tool": tool}
    raise HTTPException(404, "Tool not found in the registry")
