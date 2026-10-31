"""Versioned, bounded inputs for repeatable model evaluations."""
from __future__ import annotations

from typing import Literal
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Check(Strict):
    kind: Literal['exact', 'contains', 'not_contains', 'json_equals']
    value: str = Field(min_length=1, max_length=8000)

    @model_validator(mode='after')
    def valid_json(self):
        if self.kind == 'json_equals':
            import json
            json.dumps(json.loads(self.value), allow_nan=False)
        return self


class Message(Strict):
    role: Literal['user', 'assistant']
    content: str = Field(min_length=1, max_length=16000)


class Case(Strict):
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,64}$')
    name: str = Field(min_length=1, max_length=150)
    category: Literal['instructions', 'coding', 'data', 'facts', 'updates', 'live_freshness']
    messages: list[Message] = Field(min_length=1, max_length=12)
    checks: list[Check] = Field(default_factory=list, max_length=20)
    rubric: str = Field(min_length=1, max_length=4000)
    reference: str = Field(default='', max_length=16000)
    source: str = Field(default='', max_length=2000)
    checked_at: AwareDatetime | None = None
    valid_until: AwareDatetime | None = None

    @model_validator(mode='after')
    def evidence(self):
        if self.messages[-1].role != 'user':
            raise ValueError('The last message must be a user request.')
        if self.category == 'live_freshness' and not all((self.reference, self.source, self.checked_at, self.valid_until)):
            raise ValueError('Live freshness cases need a reference, source, checked_at and valid_until.')
        if self.valid_until and (not self.checked_at or self.valid_until <= self.checked_at):
            raise ValueError('valid_until must follow checked_at.')
        return self


class Suite(Strict):
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(default='', max_length=2000)
    cases: list[Case] = Field(min_length=1, max_length=40)

    @model_validator(mode='after')
    def unique(self):
        if len({case.id for case in self.cases}) != len(self.cases):
            raise ValueError('Case IDs must be unique.')
        if sum(len(m.content) for c in self.cases for m in c.messages) > 160000:
            raise ValueError('Suite prompts exceed 160,000 characters.')
        return self


class Target(Strict):
    kind: Literal['ollama', 'manual']
    model: str = Field(min_length=1, max_length=200)

    @field_validator('model')
    @classmethod
    def trimmed(cls, value):
        if not value.strip():
            raise ValueError('Enter the exact model/version.')
        return value.strip()


class RunRequest(Strict):
    suite_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    targets: list[Target] = Field(min_length=1, max_length=4)
    repeats: int = Field(default=1, ge=1, le=5)
    context_tokens: int = Field(default=4096, ge=2048, le=32768)
    output_tokens: int = Field(default=1024, ge=128, le=4096)
    temperature: float = Field(default=0, ge=0, le=2)
    seed: int = Field(default=42, ge=0, le=2147483647)
    timeout_seconds: int = Field(default=300, ge=30, le=1800)

    @model_validator(mode='after')
    def unique(self):
        if len({(t.kind, t.model) for t in self.targets}) != len(self.targets):
            raise ValueError('Targets must be unique.')
        if self.output_tokens > self.context_tokens // 2:
            raise ValueError('Output tokens must fit within half the context.')
        return self


class ScheduleRequest(Strict):
    request: RunRequest
    interval_hours: int = Field(default=24, ge=1, le=720)
    max_runs: int = Field(default=30, ge=1, le=365)

    @model_validator(mode='after')
    def local_only(self):
        if any(t.kind != 'ollama' for t in self.request.targets):
            raise ValueError('Schedules accept local models only. Add online responses to individual runs.')
        return self


class ExternalResponse(Strict):
    response: str = Field(min_length=1, max_length=128000)
    conditions: str = Field(min_length=1, max_length=2000)


class Review(Strict):
    request_accuracy: int = Field(ge=0, le=4)
    factual_accuracy: int = Field(ge=0, le=4)
    freshness: int | None = Field(default=None, ge=0, le=4)
    notes: str = Field(default='', max_length=4000)
