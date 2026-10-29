"""Agent Nexus inventory model: assets, edges, findings.

The scanner emits one Inventory per run, serialised as JSON with schema
``agent-nexus/inventory@0.1``. Everything here is metadata: no prompts,
outputs, document contents or secret values are ever stored.
"""
from __future__ import annotations

import datetime as _dt
import json
from dataclasses import dataclass, field, asdict
from typing import Any

SCHEMA = "agent-nexus/inventory@0.1"
SEVERITIES = ("critical", "high", "medium", "low", "info")

# Asset kinds used across connectors.
AGENT = "agent"                    # orchestrating agent (Bedrock Agent, AgentCore runtime, ...)
MCP_SERVER = "mcp_server"          # anything that serves tools over MCP (incl. AgentCore gateways)
TOOL = "tool"                      # a callable capability (action group, gateway target, lambda)
KNOWLEDGE_BASE = "knowledge_base"
DATA_SOURCE = "data_source"
MODEL = "model"                    # foundation, custom, imported or self-hosted model
GUARDRAIL = "guardrail"
PRINCIPAL = "principal"            # IAM identity seen invoking models
REGISTRY_RECORD = "registry_record"


@dataclass
class Asset:
    id: str
    kind: str
    name: str
    platform: str
    region: str | None = None
    arn: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)
    tags: dict[str, str] = field(default_factory=dict)


@dataclass
class Edge:
    source: str
    target: str
    type: str


@dataclass
class Finding:
    id: str
    rule: str
    severity: str
    asset_id: str
    title: str
    detail: str
    evidence: dict[str, Any] = field(default_factory=dict)


class Inventory:
    def __init__(self, platform: str, account: str | None = None):
        self.platform = platform
        self.account = account
        self.started_at = _now()
        self.finished_at: str | None = None
        self.regions: list[str] = []
        self.assets: dict[str, Asset] = {}
        self.edges: list[Edge] = []
        self.findings: list[Finding] = []
        self.errors: list[dict[str, str]] = []
        self.stats: dict[str, Any] = {}
        self._edge_keys: set[tuple[str, str, str]] = set()

    # -- building ------------------------------------------------------
    def add(self, kind: str, id: str, name: str, region: str | None = None, arn: str | None = None,
            attributes: dict[str, Any] | None = None, tags: dict[str, str] | None = None) -> Asset:
        """Add or merge an asset. Later calls fill in attributes the first call lacked."""
        if id in self.assets:
            a = self.assets[id]
            for k, v in (attributes or {}).items():
                if v is not None and a.attributes.get(k) in (None, "", [], {}):
                    a.attributes[k] = v
            a.tags.update(tags or {})
            a.arn = a.arn or arn
            a.region = a.region or region
            if name and (not a.name or a.name == a.id):
                a.name = name
            return a
        a = Asset(id=id, kind=kind, name=name or id, platform=self.platform, region=region, arn=arn,
                  attributes={k: v for k, v in (attributes or {}).items() if v is not None}, tags=dict(tags or {}))
        self.assets[id] = a
        return a

    def link(self, source: str, target: str, type: str) -> None:
        key = (source, target, type)
        if key not in self._edge_keys:
            self._edge_keys.add(key)
            self.edges.append(Edge(source, target, type))

    def flag(self, rule: str, severity: str, asset_id: str, title: str, detail: str, **evidence: Any) -> None:
        assert severity in SEVERITIES, severity
        fid = f"{rule}:{asset_id}"
        if any(f.id == fid for f in self.findings):
            return
        self.findings.append(Finding(fid, rule, severity, asset_id, title, detail, evidence))

    def error(self, region: str | None, service: str, operation: str, message: str) -> None:
        self.errors.append({"region": region or "global", "service": service, "operation": operation, "error": message})

    # -- output --------------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        order = {s: i for i, s in enumerate(SEVERITIES)}
        kinds: dict[str, int] = {}
        for a in self.assets.values():
            kinds[a.kind] = kinds.get(a.kind, 0) + 1
        return {
            "schema": SCHEMA,
            "platform": self.platform,
            "account": self.account,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at or _now(),
            "regions": self.regions,
            "summary": {"assets": kinds, "findings": {s: sum(f.severity == s for f in self.findings) for s in SEVERITIES},
                        "errors": len(self.errors), **self.stats},
            "assets": [asdict(a) for a in sorted(self.assets.values(), key=lambda a: (a.kind, a.name))],
            "edges": [asdict(e) for e in self.edges],
            "findings": [asdict(f) for f in sorted(self.findings, key=lambda f: (order[f.severity], f.rule))],
            "errors": self.errors,
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, default=str)


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()
