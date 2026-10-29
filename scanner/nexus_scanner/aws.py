"""Read-only AWS scanner for Agent Nexus.

Finds AI agents, MCP servers, tools, knowledge bases, models (including
self-hosted open-weight models) and who is invoking them, across one AWS
account and a set of regions.

Discovery sources
-----------------
* Amazon Bedrock Agents      agents, action groups, knowledge bases, collaborators, aliases
* Amazon Bedrock AgentCore   agent runtimes (HTTP / MCP / A2A), MCP gateways and their targets,
                             AgentCore registry records
* Amazon Bedrock             imported (open-weight) models, custom models, marketplace endpoints,
                             guardrails
* Amazon SageMaker           real-time endpoints serving LLMs (vLLM, TGI, LMI, ...), weights id
                             from container environment / JumpStart tags, 30-day invocations
* Amazon ECS                 task definitions running LLM inference servers
* AWS CloudTrail             InvokeModel / Converse calls per IAM principal (shadow AI signal)
* API Gateway (opt-in)       HTTP probe for A2A agent cards on each API's base URL

Only control-plane metadata is read. Prompts, outputs, document contents
and environment-variable *values* are never read into the inventory.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time
import urllib.request
from collections import defaultdict
from typing import Any, Callable, Iterable

from . import model as M

ClientFactory = Callable[[str, str], Any]

INVOKE_EVENTS = {"InvokeModel", "InvokeModelWithResponseStream", "Converse", "ConverseStream"}
HIGH_POWER_SIGNATURES = {"AMAZON.CodeInterpreter", "ANTHROPIC.Computer", "ANTHROPIC.Bash", "ANTHROPIC.TextEditor"}
OWNER_KEYS = {"owner", "team", "businessowner", "business-owner", "agent-nexus:owner", "application-owner"}
SECRET_NAME = re.compile(r"(SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIAL|(?<!MAX_)TOKEN(?!S))", re.I)
CROSS_REGION_PREFIXES = ("us.", "eu.", "apac.", "global.", "us-gov.", "ca.", "jp.", "au.")
SERVER_IMAGES = [
    ("vllm", "vLLM"), ("text-generation-inference", "TGI"), ("pytorch-tgi", "TGI"), ("tgi-inference", "TGI"),
    ("djl-inference", "DJL LMI"), ("djl-lmi", "DJL LMI"), ("ollama", "Ollama"), ("sglang", "SGLang"),
    ("tensorrt-llm", "TensorRT-LLM"), ("tritonserver", "Triton"), ("llama.cpp", "llama.cpp"), ("llamacpp", "llama.cpp"),
    ("text-embeddings-inference", "TEI"), ("pytorch-tei", "TEI"), ("huggingface-pytorch-inference", "HF Inference"),
]
MODEL_ENV_KEYS = ("HF_MODEL_ID", "MODEL_ID", "OPTION_MODEL_ID", "HF_MODEL", "MODEL_NAME", "SM_MODEL_ID")
FAMILIES = [("gpt-oss", "gpt-oss"), ("llama", "Llama"), ("mixtral", "Mistral"), ("mistral", "Mistral"), ("gemma", "Gemma"),
            ("qwen", "Qwen"), ("deepseek", "DeepSeek"), ("phi-", "Phi"), ("falcon", "Falcon"), ("granite", "Granite"),
            ("olmo", "OLMo"), ("bge-", "BGE"), ("e5-", "E5")]
OPEN_WEIGHT_PROVIDERS = {"meta", "mistral", "deepseek", "qwen"}


def paginate(client: Any, op: str, key: str, token: str = "nextToken", out_token: str | None = None,
             limit: int | None = None, **kwargs: Any) -> Iterable[dict]:
    """Iterate list results by following next tokens. Works for any boto3-style client."""
    out_token = out_token or token
    count, nxt = 0, None
    while True:
        args = dict(kwargs)
        if nxt:
            args[token] = nxt
        page = getattr(client, op)(**args)
        for item in page.get(key, []) or []:
            yield item
            count += 1
            if limit and count >= limit:
                return
        nxt = page.get(out_token)
        if not nxt:
            return


def owner_of(tags: dict[str, str]) -> str | None:
    for k, v in tags.items():
        if k.lower() in OWNER_KEYS and v:
            return v
    return None


def server_of(image: str | None) -> str | None:
    img = (image or "").lower()
    for needle, name in SERVER_IMAGES:
        if needle in img:
            return name
    return None


def family_of(model_id: str | None) -> str | None:
    mid = (model_id or "").lower()
    for needle, name in FAMILIES:
        if needle in mid:
            return name
    return None


def role_name(arn: str | None) -> str | None:
    """Return the IAM role name from a role ARN or an STS assumed-role ARN."""
    if not arn:
        return None
    m = re.search(r":assumed-role/([^/]+)/", arn) or re.search(r":role/(?:.*/)?([^/]+)$", arn)
    return m.group(1) if m else None


class AwsScanner:
    def __init__(self, client: ClientFactory, regions: list[str], account: str | None = None,
                 home_regions: list[str] | None = None, days: int = 30, max_events: int = 5000,
                 skip: Iterable[str] = (), probe_agent_cards: bool = False,
                 available: Callable[[str, str], bool] | None = None,
                 fetch: Callable[[str], tuple[int, str]] | None = None,
                 log: Callable[[str], None] | None = None, now: dt.datetime | None = None):
        self.client = client
        self.regions = regions
        self.home = set(home_regions or [])
        self.days = days
        self.max_events = max_events
        self.skip = set(skip)
        self.probe = probe_agent_cards
        self.available = available or (lambda svc, region: True)
        self.fetch = fetch or _http_get
        self.log = log or (lambda msg: None)
        self.now = now or dt.datetime.now(dt.timezone.utc)
        self.inv = M.Inventory("aws", account)
        self.inv.regions = list(regions)
        self._usage: dict[str, dict[str, Any]] = {}
        self._kb_seen: set[str] = set()

    # ------------------------------------------------------------------
    def run(self) -> M.Inventory:
        steps = [
            ("bedrock-agent", "agents", self._bedrock_agents),
            ("bedrock-agentcore-control", "agentcore", self._agentcore),
            ("bedrock", "models", self._bedrock_models),
            ("sagemaker", "sagemaker", self._sagemaker),
            ("ecs", "ecs", self._ecs),
            ("cloudtrail", "cloudtrail", self._cloudtrail),
        ]
        if self.probe:
            steps.append(("apigateway", "probe", self._probe_agent_cards))
        for region in self.regions:
            for service, name, fn in steps:
                if name in self.skip:
                    continue
                if not self.available(service, region):
                    self.inv.stats.setdefault("unavailable", []).append(f"{service}@{region}")
                    continue
                self.log(f"[{region}] {name}")
                self._safe(region, service, name, fn, region)
        self._attribute_usage()
        self._residency()
        self.inv.finished_at = M._now()
        return self.inv

    def _safe(self, region: str, service: str, op: str, fn: Callable, *args: Any) -> Any:
        try:
            return fn(*args)
        except Exception as e:  # one failing call must never stop the scan
            code = getattr(e, "response", {}).get("Error", {}).get("Code") if hasattr(e, "response") else None
            self.inv.error(region, service, op, f"{code or type(e).__name__}: {e}")
            return None

    def _tags(self, call: Callable[[], Any]) -> dict[str, str]:
        try:
            raw = call()
        except Exception:
            return {}
        if isinstance(raw, dict):
            raw = raw.get("tags", raw.get("Tags", raw))
        if isinstance(raw, list):
            return {t.get("Key", t.get("key")): t.get("Value", t.get("value", "")) for t in raw}
        return dict(raw or {})

    # ------------------------------------------------------------------
    # Amazon Bedrock Agents
    def _bedrock_agents(self, region: str) -> None:
        ba = self.client("bedrock-agent", region)
        for s in paginate(ba, "list_agents", "agentSummaries"):
            agent = ba.get_agent(agentId=s["agentId"])["agent"]
            arn = agent["agentArn"]
            aliases = list(paginate(ba, "list_agent_aliases", "agentAliasSummaries", agentId=s["agentId"]))
            deployed = [a.get("agentAliasName") for a in aliases if a.get("agentAliasId") != "TSTALIASID"]
            tags = self._tags(lambda: ba.list_tags_for_resource(resourceArn=arn))
            guard = agent.get("guardrailConfiguration") or {}
            a = self.inv.add(M.AGENT, arn, agent.get("agentName", s["agentId"]), region, arn, {
                "service": "Amazon Bedrock Agents", "agentId": s["agentId"], "status": agent.get("agentStatus"),
                "description": agent.get("description"), "role": agent.get("agentResourceRoleArn"),
                "orchestration": agent.get("orchestrationType"), "collaboration": agent.get("agentCollaboration"),
                "memory": bool((agent.get("memoryConfiguration") or {}).get("enabledMemoryTypes")),
                "guardrail": guard.get("guardrailIdentifier"), "guardrailVersion": guard.get("guardrailVersion"),
                "deployedAliases": deployed, "environment": "Deployed" if deployed else "Draft only",
                "updatedAt": agent.get("updatedAt"), "owner": owner_of(tags), "discoveredVia": "bedrock-agent:ListAgents",
            }, tags)
            if agent.get("foundationModel"):
                self.inv.link(arn, self._bedrock_model(agent["foundationModel"], region), "uses_model")
            if guard.get("guardrailIdentifier"):
                gid = self._guardrail_id(guard["guardrailIdentifier"], region)
                self.inv.add(M.GUARDRAIL, gid, guard["guardrailIdentifier"], region)
                self.inv.link(arn, gid, "protected_by")
            else:
                self.inv.flag("AGENT_NO_GUARDRAIL", "medium", arn, "Agent has no Bedrock guardrail",
                              f"{a.name} runs without a guardrail for harmful content, PII or prompt attacks.")
            if not owner_of(tags):
                self.inv.flag("NO_OWNER", "low", arn, "Agent has no owner tag",
                              f"Tag {a.name} with an owner so someone is accountable for it.")
            self._action_groups(ba, arn, s["agentId"], region)
            for kb in paginate(ba, "list_agent_knowledge_bases", "agentKnowledgeBaseSummaries",
                               agentId=s["agentId"], agentVersion="DRAFT"):
                kb_id = self._knowledge_base(ba, kb["knowledgeBaseId"], region)
                self.inv.link(arn, kb_id, "reads")
            for c in paginate(ba, "list_agent_collaborators", "agentCollaboratorSummaries",
                              agentId=s["agentId"], agentVersion="DRAFT"):
                alias = (c.get("agentDescriptor") or {}).get("aliasArn", "")
                m = re.match(r"arn:aws[\w-]*:bedrock:([\w-]+):(\d+):agent-alias/([A-Z0-9]+)/", alias)
                if m:
                    peer = f"arn:aws:bedrock:{m.group(1)}:{m.group(2)}:agent/{m.group(3)}"
                    self.inv.add(M.AGENT, peer, c.get("collaboratorName") or m.group(3), m.group(1), peer)
                    self.inv.link(arn, peer, "delegates_to")

    def _action_groups(self, ba: Any, agent_arn: str, agent_id: str, region: str) -> None:
        for g in paginate(ba, "list_agent_action_groups", "actionGroupSummaries", agentId=agent_id, agentVersion="DRAFT"):
            d = ba.get_agent_action_group(agentId=agent_id, agentVersion="DRAFT", actionGroupId=g["actionGroupId"])["agentActionGroup"]
            ex = d.get("actionGroupExecutor") or {}
            sig = d.get("parentActionSignature")
            fns = [f.get("name") for f in ((d.get("functionSchema") or {}).get("functions") or [])]
            api = d.get("apiSchema") or {}
            tid = f"{agent_arn}/action-group/{g['actionGroupId']}"
            self.inv.add(M.TOOL, tid, d.get("actionGroupName", g["actionGroupId"]), region, None, {
                "service": "Bedrock action group", "state": d.get("actionGroupState"),
                "executor": "Lambda" if ex.get("lambda") else "Return control to caller" if ex.get("customControl") else ("Built-in " + sig if sig else None),
                "lambdaArn": ex.get("lambda"), "functions": fns or None,
                "apiSchema": "S3" if api.get("s3") else "Inline OpenAPI" if api.get("payload") else None,
                "builtIn": sig, "description": d.get("description"),
            })
            self.inv.link(agent_arn, tid, "calls")
            if sig in HIGH_POWER_SIGNATURES:
                self.inv.flag("HIGH_POWER_TOOL", "high", tid, f"Agent can use {sig}",
                              "Code execution or computer control lets the agent take open-ended actions. "
                              "Confirm sandboxing and human approval.", signature=sig)

    def _knowledge_base(self, ba: Any, kb_id: str, region: str) -> str:
        kb = ba.get_knowledge_base(knowledgeBaseId=kb_id)["knowledgeBase"]
        arn = kb.get("knowledgeBaseArn") or f"aws:{region}:knowledge-base:{kb_id}"
        if arn in self._kb_seen:
            return arn
        self._kb_seen.add(arn)
        cfg = kb.get("knowledgeBaseConfiguration") or {}
        vec = cfg.get("vectorKnowledgeBaseConfiguration") or cfg.get("managedKnowledgeBaseConfiguration") or {}
        self.inv.add(M.KNOWLEDGE_BASE, arn, kb.get("name", kb_id), region, arn, {
            "service": "Bedrock Knowledge Base", "type": cfg.get("type"), "status": kb.get("status"),
            "storage": (kb.get("storageConfiguration") or {}).get("type"), "role": kb.get("roleArn"),
        })
        if vec.get("embeddingModelArn"):
            self.inv.link(arn, self._bedrock_model(vec["embeddingModelArn"], region), "embeds_with")
        for ds in paginate(ba, "list_data_sources", "dataSourceSummaries", knowledgeBaseId=kb_id):
            d = ba.get_data_source(knowledgeBaseId=kb_id, dataSourceId=ds["dataSourceId"])["dataSource"]
            c = d.get("dataSourceConfiguration") or {}
            loc = (c.get("s3Configuration") or {}).get("bucketArn")
            did = f"{arn}/data-source/{ds['dataSourceId']}"
            self.inv.add(M.DATA_SOURCE, did, d.get("name", ds["dataSourceId"]), region, None, {
                "type": c.get("type"), "location": loc, "status": d.get("status"),
                "external": c.get("type") in ("WEB", "CONFLUENCE", "SALESFORCE", "SHAREPOINT"),
            })
            self.inv.link(arn, did, "indexes")
            if c.get("type") == "WEB":
                self.inv.flag("WEB_CRAWL_SOURCE", "medium", did, "Knowledge base indexes public web pages",
                              "Crawled web content is untrusted input and a common route for indirect prompt injection.")
        return arn

    def _guardrail_id(self, ident: str, region: str) -> str:
        return ident if ident.startswith("arn:") else f"aws:{region}:guardrail:{ident}"

    def _bedrock_model(self, ref: str, region: str) -> str:
        """Register a Bedrock model reference (id, foundation-model ARN or inference profile)."""
        base = ref.split("/")[-1]
        profile = None
        for p in CROSS_REGION_PREFIXES:
            if base.startswith(p):
                profile, base = p.rstrip("."), base[len(p):]
                break
        provider = base.split(".")[0] if "." in base else None
        open_weight = provider in OPEN_WEIGHT_PROVIDERS or "gpt-oss" in base
        mid = f"aws:bedrock-model:{base}"
        self.inv.add(M.MODEL, mid, base, region if not profile else None, None, {
            "service": "Amazon Bedrock", "provider": provider,
            "type": "Open-weight (Bedrock serverless)" if open_weight else "Foundation model (Bedrock)",
            "family": family_of(base), "inferenceProfile": profile, "openWeight": open_weight,
        })
        if profile:
            self.inv.flag("CROSS_REGION_INFERENCE", "medium", mid, f"Cross-region inference profile '{profile}'",
                          f"Requests to {base} may be processed outside the calling region. Check data residency obligations.",
                          profile=profile)
        return mid

    # ------------------------------------------------------------------
    # Amazon Bedrock AgentCore
    def _agentcore(self, region: str) -> None:
        ac = self.client("bedrock-agentcore-control", region)
        for r in paginate(ac, "list_agent_runtimes", "agentRuntimes"):
            d = ac.get_agent_runtime(agentRuntimeId=r["agentRuntimeId"])
            arn = d.get("agentRuntimeArn") or r["agentRuntimeArn"]
            proto = (d.get("protocolConfiguration") or {}).get("serverProtocol", "HTTP")
            art = d.get("agentRuntimeArtifact") or {}
            env_names = sorted((d.get("environmentVariables") or {}).keys())  # names only, never values
            jwt = (d.get("authorizerConfiguration") or {}).get("customJWTAuthorizer")
            kind = M.MCP_SERVER if proto == "MCP" else M.AGENT
            self.inv.add(kind, arn, d.get("agentRuntimeName", r["agentRuntimeId"]), region, arn, {
                "service": "AgentCore Runtime", "protocol": proto, "status": d.get("status"),
                "version": d.get("agentRuntimeVersion"), "network": (d.get("networkConfiguration") or {}).get("networkMode"),
                "auth": "Custom JWT" if jwt else "IAM (SigV4)", "role": d.get("roleArn"),
                "artifact": (art.get("containerConfiguration") or {}).get("containerUri")
                            or ("Code " + (art.get("codeConfiguration") or {}).get("runtime", "") if art.get("codeConfiguration") else None),
                "envVarNames": env_names or None, "description": d.get("description"),
                "discoveredVia": "bedrock-agentcore:ListAgentRuntimes",
            })
            secrets = [n for n in env_names if SECRET_NAME.search(n)]
            if secrets:
                self.inv.flag("SECRET_IN_ENV", "high", arn, "Credentials passed as environment variables",
                              f"Variables {', '.join(secrets)} look like secrets. Move them to AgentCore Identity or Secrets Manager.",
                              variables=secrets)
        for g in paginate(ac, "list_gateways", "items"):
            d = ac.get_gateway(gatewayIdentifier=g["gatewayId"])
            arn = d.get("gatewayArn", f"aws:{region}:gateway:{g['gatewayId']}")
            pe = d.get("policyEngineConfiguration") or {}
            auth = d.get("authorizerType", g.get("authorizerType"))
            self.inv.add(M.MCP_SERVER, arn, d.get("name", g["gatewayId"]), region, arn, {
                "service": "AgentCore Gateway", "protocol": d.get("protocolType", "MCP"), "endpoint": d.get("gatewayUrl"),
                "auth": auth, "policyEngine": pe.get("mode"), "waf": bool(d.get("webAclArn")),
                "role": d.get("roleArn"), "status": d.get("status"), "discoveredVia": "bedrock-agentcore:ListGateways",
            })
            if auth == "NONE":
                self.inv.flag("MCP_NO_AUTH", "critical", arn, "MCP gateway accepts unauthenticated requests",
                              f"Anyone who can reach {d.get('gatewayUrl', 'this gateway')} can list and call its tools.")
            if not pe:
                self.inv.flag("MCP_NO_POLICY", "low", arn, "No policy engine on MCP gateway",
                              "Tool calls are not checked against a Cedar policy before they run.")
            elif pe.get("mode") == "LOG_ONLY":
                self.inv.flag("MCP_POLICY_LOG_ONLY", "low", arn, "Gateway policy is in log-only mode",
                              "Policy violations are recorded but not blocked.")
            for t in paginate(ac, "list_gateway_targets", "items", gatewayIdentifier=g["gatewayId"]):
                self._gateway_target(ac, arn, g["gatewayId"], t, region)
        for reg in paginate(ac, "list_registries", "registries"):
            for rec in paginate(ac, "list_registry_records", "registryRecords", registryId=reg["registryId"]):
                rid = rec.get("recordArn") or f"aws:{region}:registry-record:{rec['recordId']}"
                self.inv.add(M.REGISTRY_RECORD, rid, rec.get("name", rec["recordId"]), region, rec.get("recordArn"), {
                    "service": "AgentCore Registry", "registry": reg.get("name"), "descriptorType": rec.get("descriptorType"),
                    "approval": rec.get("status"), "version": rec.get("recordVersion"),
                })

    def _gateway_target(self, ac: Any, gw_arn: str, gw_id: str, t: dict, region: str) -> None:
        d = ac.get_gateway_target(gatewayIdentifier=gw_id, targetId=t["targetId"])
        cfg = d.get("targetConfiguration") or {}
        mcp, http, inf = cfg.get("mcp") or {}, cfg.get("http") or {}, cfg.get("inference") or {}
        endpoint, ttype, runtime = None, t.get("targetType"), None
        if mcp.get("mcpServer"):
            ttype, endpoint = "Remote MCP server", mcp["mcpServer"].get("endpoint")
        elif mcp.get("lambda"):
            ttype = "Lambda"
        elif mcp.get("openApiSchema"):
            ttype = "OpenAPI"
        elif mcp.get("smithyModel"):
            ttype = "Smithy (AWS service)"
        elif mcp.get("apiGateway"):
            ttype = "API Gateway"
        elif mcp.get("connector"):
            ttype = "Connector " + ((mcp["connector"].get("source") or {}).get("connectorId") or "")
        elif http.get("agentcoreRuntime"):
            ttype, runtime = "AgentCore runtime", http["agentcoreRuntime"].get("arn")
        elif http.get("passthrough"):
            ttype = "Passthrough " + http["passthrough"].get("protocolType", "")
            endpoint = http["passthrough"].get("endpoint")
        elif inf.get("provider"):
            ttype, endpoint = "Inference provider", inf["provider"].get("endpoint")
        creds = sorted({c.get("credentialProviderType") for c in d.get("credentialProviderConfigurations") or [] if c.get("credentialProviderType")})
        tid = f"{gw_arn}/target/{t['targetId']}"
        self.inv.add(M.TOOL, tid, d.get("name", t.get("name", t["targetId"])), region, None, {
            "service": "AgentCore Gateway target", "targetType": ttype, "endpoint": endpoint,
            "lambdaArn": (mcp.get("lambda") or {}).get("lambdaArn"), "outboundAuth": creds or None,
            "status": d.get("status"), "description": d.get("description"),
        })
        self.inv.link(gw_arn, tid, "exposes")
        if runtime:
            self.inv.link(tid, runtime, "routes_to")
        if endpoint and not re.search(r"\.amazonaws\.com(/|:|$)", endpoint):
            host = re.sub(r"^https?://", "", endpoint).split("/")[0]
            ext = f"external:{host}"
            self.inv.add(M.MCP_SERVER if "MCP" in (ttype or "") else M.TOOL, ext, host, None, None, {
                "service": "External endpoint", "endpoint": endpoint, "publisher": "Third party (unverified)",
            })
            self.inv.link(tid, ext, "proxies")
            self.inv.flag("EXTERNAL_ENDPOINT", "medium", tid, f"Gateway target calls an external service ({host})",
                          "Data leaves AWS for a service outside your account. Verify the publisher, contract and data handling.",
                          endpoint=endpoint)

    # ------------------------------------------------------------------
    # Amazon Bedrock models and guardrails
    def _bedrock_models(self, region: str) -> None:
        b = self.client("bedrock", region)
        for m in paginate(b, "list_imported_models", "modelSummaries"):
            tags = self._tags(lambda: b.list_tags_for_resource(resourceARN=m["modelArn"]))
            self.inv.add(M.MODEL, m["modelArn"], m.get("modelName"), region, m["modelArn"], {
                "service": "Bedrock Custom Model Import", "type": "Open-weight (imported weights)", "openWeight": True,
                "architecture": m.get("modelArchitecture"), "family": family_of(m.get("modelArchitecture")) or family_of(m.get("modelName")),
                "createdAt": m.get("creationTime"), "owner": owner_of(tags),
            }, tags)
            self._open_weight_finding(m["modelArn"], m.get("modelName"), tags, "Bedrock Custom Model Import")
        for m in paginate(b, "list_custom_models", "modelSummaries"):
            self.inv.add(M.MODEL, m["modelArn"], m.get("modelName"), region, m["modelArn"], {
                "service": "Bedrock custom model", "type": f"Fine-tuned ({m.get('customizationType', 'custom')})",
                "baseModel": m.get("baseModelName"), "status": m.get("modelStatus"), "createdAt": m.get("creationTime"),
            })
            if m.get("baseModelArn"):
                self.inv.link(m["modelArn"], self._bedrock_model(m["baseModelArn"], region), "derived_from")
        for e in paginate(b, "list_marketplace_model_endpoints", "marketplaceModelEndpoints"):
            self.inv.add(M.MODEL, e["endpointArn"], e.get("modelSourceIdentifier", e["endpointArn"]).split("/")[-1], region, e["endpointArn"], {
                "service": "Bedrock Marketplace", "type": "Marketplace model endpoint", "status": e.get("status"),
                "source": e.get("modelSourceIdentifier"),
            })
        for p in paginate(b, "list_provisioned_model_throughputs", "provisionedModelSummaries"):
            if p.get("foundationModelArn"):
                mid = self._bedrock_model(p["foundationModelArn"], region)
                self.inv.assets[mid].attributes["provisionedThroughput"] = p.get("provisionedModelName")
        for g in paginate(b, "list_guardrails", "guardrails"):
            self.inv.add(M.GUARDRAIL, g["arn"], g.get("name", g["id"]), region, g["arn"], {
                "service": "Bedrock Guardrails", "version": g.get("version"), "status": g.get("status"),
            })
            alias = f"aws:{region}:guardrail:{g['id']}"
            if alias in self.inv.assets:  # an agent referenced it by id before we listed it
                for e in self.inv.edges:
                    if e.target == alias:
                        self.inv.link(e.source, g["arn"], e.type)
                self.inv.edges = [e for e in self.inv.edges if e.target != alias]
                del self.inv.assets[alias]

    def _open_weight_finding(self, asset_id: str, name: str | None, tags: dict, where: str) -> None:
        if owner_of(tags):
            self.inv.flag("OPEN_WEIGHT_MODEL", "low", asset_id, f"Self-hosted open-weight model: {name}",
                          f"Running on {where}. Confirm the licence, the weights' provenance and that it is in the AI register.")
        else:
            self.inv.flag("OPEN_WEIGHT_NO_OWNER", "high", asset_id, f"Open-weight model with no owner: {name}",
                          f"Running on {where} with no owner tag. Likely shadow AI: find the owner, confirm the data it "
                          "processes and register it or shut it down.")

    # ------------------------------------------------------------------
    # Amazon SageMaker (self-hosted LLMs)
    def _sagemaker(self, region: str) -> None:
        sm = self.client("sagemaker", region)
        cw = None
        for e in paginate(sm, "list_endpoints", "Endpoints", token="NextToken", StatusEquals="InService"):
            name = e["EndpointName"]
            d = sm.describe_endpoint(EndpointName=name)
            containers: list[dict] = []
            if d.get("EndpointConfigName"):
                cfg = sm.describe_endpoint_config(EndpointConfigName=d["EndpointConfigName"])
                for v in cfg.get("ProductionVariants", []):
                    if v.get("ModelName"):
                        containers += self._sm_model_containers(sm, v["ModelName"])
            for ic in paginate(sm, "list_inference_components", "InferenceComponents", token="NextToken", EndpointNameEquals=name):
                icd = sm.describe_inference_component(InferenceComponentName=ic["InferenceComponentName"])
                spec = icd.get("Specification") or {}
                if spec.get("Container"):
                    containers.append(spec["Container"])
                if spec.get("ModelName"):
                    containers += self._sm_model_containers(sm, spec["ModelName"])
            tags = self._tags(lambda: sm.list_tags(ResourceArn=e["EndpointArn"]))
            js = next((v for k, v in tags.items() if k.endswith("jumpstart-model-id")), None)
            for c in containers:
                env = c.get("Environment") or {}
                server = server_of(c.get("Image"))
                model_id = next((env[k] for k in MODEL_ENV_KEYS if env.get(k)), None) or js
                if not server and not model_id:
                    continue  # classic ML endpoint, not a GenAI workload
                if cw is None:
                    cw = self._safe(region, "cloudwatch", "client", self.client, "cloudwatch", region)
                calls = self._sm_invocations(cw, name, [v.get("VariantName") for v in d.get("ProductionVariants", [])]) if cw else None
                mid = f"{e['EndpointArn']}/model/{model_id or server}"
                self.inv.add(M.MODEL, mid, model_id or f"{server} on {name}", region, e["EndpointArn"], {
                    "service": "SageMaker endpoint", "endpoint": name, "type": "Open-weight (self-hosted)", "openWeight": True,
                    "server": server, "image": (c.get("Image") or "").split("@")[0], "modelId": model_id,
                    "family": family_of(model_id), "source": "JumpStart" if js else ("Hugging Face" if model_id and "/" in model_id else None),
                    "invocations": calls, "owner": owner_of(tags), "discoveredVia": "sagemaker:ListEndpoints",
                }, tags)
                self._open_weight_finding(mid, model_id or name, tags, f"SageMaker endpoint {name}")

    def _sm_model_containers(self, sm: Any, model_name: str) -> list[dict]:
        m = sm.describe_model(ModelName=model_name)
        return ([m["PrimaryContainer"]] if m.get("PrimaryContainer") else []) + list(m.get("Containers") or [])

    def _sm_invocations(self, cw: Any, endpoint: str, variants: list[str | None]) -> int | None:
        total, start = 0, self.now - dt.timedelta(days=self.days)
        try:
            for v in [x for x in variants if x]:
                r = cw.get_metric_statistics(Namespace="AWS/SageMaker", MetricName="Invocations",
                                             Dimensions=[{"Name": "EndpointName", "Value": endpoint}, {"Name": "VariantName", "Value": v}],
                                             StartTime=start, EndTime=self.now, Period=86400, Statistics=["Sum"])
                total += int(sum(p.get("Sum", 0) for p in r.get("Datapoints", [])))
            return total
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Amazon ECS (containers running inference servers)
    def _ecs(self, region: str) -> None:
        ecs = self.client("ecs", region)
        for td in paginate(ecs, "list_task_definitions", "taskDefinitionArns", status="ACTIVE", limit=300):
            d = ecs.describe_task_definition(taskDefinition=td)["taskDefinition"]
            for c in d.get("containerDefinitions", []):
                server = server_of(c.get("image"))
                if not server:
                    continue
                env = {x.get("name"): x.get("value") for x in c.get("environment") or [] if x.get("name") in MODEL_ENV_KEYS}
                model_id = next((env[k] for k in MODEL_ENV_KEYS if env.get(k)), None)
                mid = f"{td}/container/{c.get('name')}"
                self.inv.add(M.MODEL, mid, model_id or f"{server} ({d.get('family')})", region, td, {
                    "service": "ECS task definition", "type": "Open-weight (self-hosted)", "openWeight": True,
                    "server": server, "image": (c.get("image") or "").split("@")[0], "modelId": model_id,
                    "family": family_of(model_id), "taskFamily": d.get("family"), "role": d.get("taskRoleArn"),
                })
                self._open_weight_finding(mid, model_id or d.get("family"), {}, f"ECS task {d.get('family')}")

    # ------------------------------------------------------------------
    # AWS CloudTrail (who is calling which model)
    def _cloudtrail(self, region: str) -> None:
        ct = self.client("cloudtrail", region)
        start = self.now - dt.timedelta(days=min(self.days, 90))
        seen = 0
        for ev in paginate(ct, "lookup_events", "Events", token="NextToken", limit=self.max_events,
                           LookupAttributes=[{"AttributeKey": "EventSource", "AttributeValue": "bedrock.amazonaws.com"}],
                           StartTime=start, EndTime=self.now):
            seen += 1
            if ev.get("EventName") not in INVOKE_EVENTS:
                continue
            try:
                body = json.loads(ev.get("CloudTrailEvent") or "{}")
            except ValueError:
                continue
            principal = (body.get("userIdentity") or {}).get("arn")
            model_ref = (body.get("requestParameters") or {}).get("modelId")
            if not principal or not model_ref:
                continue
            key = role_name(principal) or principal
            u = self._usage.setdefault(key, {"arn": principal, "calls": 0, "models": defaultdict(int), "regions": set(),
                                             "first": None, "last": None, "agents": set()})
            u["calls"] += 1
            u["models"][(model_ref, region)] += 1
            u["regions"].add(region)
            t = str(ev.get("EventTime") or body.get("eventTime") or "")
            u["first"] = min(filter(None, [u["first"], t])) if t else u["first"]
            u["last"] = max(filter(None, [u["last"], t])) if t else u["last"]
            ua = (body.get("userAgent") or "").lower()
            for sig in ("strands", "langchain", "langgraph", "crewai", "llamaindex", "autogen", "bedrock-agentcore"):
                if sig in ua:
                    u["agents"].add(sig)
            if seen % 50 == 0:
                time.sleep(0.6)  # LookupEvents is limited to 2 requests per second
        self.inv.stats.setdefault("cloudtrailEventsRead", 0)
        self.inv.stats["cloudtrailEventsRead"] += seen

    def _attribute_usage(self) -> None:
        roles: dict[str, str] = {}
        for a in self.inv.assets.values():
            rn = role_name(a.attributes.get("role"))
            if rn and a.kind in (M.AGENT, M.MCP_SERVER, M.MODEL, M.KNOWLEDGE_BASE):
                roles[rn] = a.id
        for key, u in self._usage.items():
            pid = f"aws:principal:{key}"
            self.inv.add(M.PRINCIPAL, pid, key, None, u["arn"], {
                "calls": u["calls"], "firstSeen": u["first"], "lastSeen": u["last"], "regions": sorted(u["regions"]),
                "frameworks": sorted(u["agents"]) or None, "days": self.days,
            })
            for (ref, region), n in u["models"].items():
                mid = self._bedrock_model(ref, region)
                self.inv.link(pid, mid, "invokes")
                cur = self.inv.assets[mid].attributes
                cur["invocations"] = (cur.get("invocations") or 0) + n
            if key in roles:
                self.inv.link(pid, roles[key], "identity_of")
            else:
                models = ", ".join(sorted({r for r, _ in u["models"]}))
                self.inv.flag("UNATTRIBUTED_MODEL_USE", "medium" if u["calls"] < 1000 else "high", pid,
                              f"{u['calls']:,} model calls not linked to any registered agent",
                              f"{key} called {models} in the last {self.days} days but is not the identity of any agent "
                              "Nexus knows about. This is how shadow AI usually shows up.",
                              calls=u["calls"], frameworks=sorted(u["agents"]))

    # ------------------------------------------------------------------
    # Optional: A2A agent cards behind API Gateway
    def _probe_agent_cards(self, region: str) -> None:
        bases: list[str] = []
        apigw = self.client("apigateway", region)
        for api in paginate(apigw, "get_rest_apis", "items", token="position"):
            for st in apigw.get_stages(restApiId=api["id"]).get("item", []):
                bases.append(f"https://{api['id']}.execute-api.{region}.amazonaws.com/{st['stageName']}")
        v2 = self._safe(region, "apigatewayv2", "client", self.client, "apigatewayv2", region)
        if v2:
            for api in paginate(v2, "get_apis", "Items", token="NextToken"):
                if api.get("ApiEndpoint"):
                    bases.append(api["ApiEndpoint"])
        for base in bases:
            for path in ("/.well-known/agent-card.json", "/.well-known/agent.json"):
                status, body = self.fetch(base.rstrip("/") + path)
                if status != 200:
                    continue
                try:
                    card = json.loads(body)
                except ValueError:
                    continue
                if not isinstance(card, dict) or not card.get("name"):
                    continue
                aid = f"a2a:{base}"
                skills = [s.get("name") or s.get("id") for s in card.get("skills") or [] if isinstance(s, dict)]
                self.inv.add(M.AGENT, aid, card["name"], region, None, {
                    "service": "A2A agent (API Gateway)", "protocol": "A2A", "card": base + path, "url": card.get("url"),
                    "version": card.get("version"), "description": card.get("description"), "skills": skills or None,
                    "provider": (card.get("provider") or {}).get("organization"), "discoveredVia": "A2A agent card probe",
                })
                break

    # ------------------------------------------------------------------
    def _residency(self) -> None:
        if not self.home:
            return
        for a in list(self.inv.assets.values()):
            if a.region and a.region not in self.home and a.kind in (M.AGENT, M.MCP_SERVER, M.MODEL, M.KNOWLEDGE_BASE):
                self.inv.flag("OUTSIDE_HOME_REGION", "medium", a.id, f"{a.name} runs in {a.region}",
                              f"Outside your home regions ({', '.join(sorted(self.home))}). Check data residency obligations.",
                              region=a.region)


def _http_get(url: str, timeout: float = 4.0) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "agent-nexus-scanner/0.1", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (URL built from API Gateway ids)
            return r.status, r.read(256_000).decode("utf-8", "replace")
    except Exception:
        return 0, ""
