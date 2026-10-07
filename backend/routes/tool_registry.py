"""Authenticated discovery, validated execution and exact single-use action review."""
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from services.tool_execution import validate_call, dispatch, create_plan, decide_plan

from services.tool_registry import build_registry, registry_markdown

router = APIRouter(prefix="/tools", tags=["tool-registry"])


class ToolCall(BaseModel):
    model_config = {'extra': 'forbid'}
    tool_id: str = Field(min_length=1, max_length=80)
    arguments: dict = Field(default_factory=dict)


class ToolDecision(BaseModel):
    model_config = {'extra': 'forbid'}
    approved: bool


@router.post('/execute')
async def execute_tool(request: Request, call: ToolCall):
    registry = _registry(request)
    tool = validate_call(registry, call.tool_id, call.arguments)
    if tool['execution'].get('requires_review'):
        return {'status': 'pending', 'plan': create_plan(tool, call.arguments)}
    return await dispatch(request.app, tool, call.arguments)


@router.post('/plans/{plan_id}/decision')
async def review_tool_plan(request: Request, plan_id: str, decision: ToolDecision):
    return await decide_plan(request.app, _registry(request), plan_id, decision.approved)


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
