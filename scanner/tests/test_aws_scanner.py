import datetime as dt
import json

from nexus_scanner import model as M
from nexus_scanner.aws import AwsScanner, family_of, role_name, server_of

from fake_aws import ACCT, AGENT1, AGENT2, GW, R, factory, fetch

NOW = dt.datetime(2026, 10, 29, tzinfo=dt.timezone.utc)


def scan(**kw):
    s = AwsScanner(factory(kw.pop("denied", None)), kw.pop("regions", [R]), account=ACCT, fetch=fetch, now=NOW, **kw)
    return s.run().to_dict()


def by_id(d):
    return {a["id"]: a for a in d["assets"]}


def rules(d):
    return {(f["rule"], f["asset_id"]) for f in d["findings"]}


def test_finds_bedrock_agents_across_pages_with_tools_kb_and_collaborators():
    d = scan()
    a = by_id(d)
    assert a[AGENT1]["name"] == "home-loan-preassess"
    assert a[AGENT1]["attributes"]["environment"] == "Deployed"
    assert a[AGENT2]["attributes"]["environment"] == "Draft only"
    assert a[AGENT1]["attributes"]["owner"] == "priya.natarajan"
    edges = {(e["source"], e["target"], e["type"]) for e in d["edges"]}
    assert (AGENT1, AGENT2, "delegates_to") in edges
    tools = [x for x in d["assets"] if x["kind"] == M.TOOL and x["id"].startswith(AGENT1)]
    assert {t["name"] for t in tools} == {"credit-bureau", "calc"}
    assert next(t for t in tools if t["name"] == "credit-bureau")["attributes"]["functions"] == ["bureau_enquiry", "credit_score"]
    kb = next(x for x in d["assets"] if x["kind"] == M.KNOWLEDGE_BASE)
    assert (AGENT1, kb["id"], "reads") in edges
    assert sum(1 for x in d["assets"] if x["kind"] == M.DATA_SOURCE) == 2


def test_agent_findings():
    r = rules(scan())
    assert ("AGENT_NO_GUARDRAIL", AGENT1) in r
    assert ("AGENT_NO_GUARDRAIL", AGENT2) not in r          # has a guardrail
    assert ("NO_OWNER", AGENT2) in r and ("NO_OWNER", AGENT1) not in r
    assert any(rule == "HIGH_POWER_TOOL" for rule, _ in r)
    assert any(rule == "WEB_CRAWL_SOURCE" for rule, _ in r)
    assert ("CROSS_REGION_INFERENCE", "aws:bedrock-model:anthropic.claude-sonnet-4-5-v1:0") in r


def test_guardrail_referenced_by_id_is_merged_with_listed_guardrail():
    d = scan()
    g = [x for x in d["assets"] if x["kind"] == M.GUARDRAIL]
    assert [x["name"] for x in g] == ["lending-guardrail"]
    assert any(e["source"] == AGENT2 and e["target"] == g[0]["id"] and e["type"] == "protected_by" for e in d["edges"])


def test_agentcore_runtimes_gateways_and_registry():
    d = scan()
    a = by_id(d)
    rt = next(x for x in d["assets"] if x["name"] == "settlement-tracker")
    assert rt["kind"] == M.AGENT and rt["attributes"]["protocol"] == "A2A"
    assert next(x for x in d["assets"] if x["name"] == "core-lending-mcp" and x["kind"] == M.MCP_SERVER)["attributes"]["auth"] == "Custom JWT"
    assert a[GW]["kind"] == M.MCP_SERVER and a[GW]["attributes"]["auth"] == "NONE"
    r = rules(d)
    assert ("MCP_NO_AUTH", GW) in r
    assert any(rule == "EXTERNAL_ENDPOINT" for rule, _ in r)
    assert "external:mcp.bureau.example.com.au" in a
    assert any(x["kind"] == M.REGISTRY_RECORD and x["attributes"]["approval"] == "APPROVED" for x in d["assets"])
    assert any(e["type"] == "routes_to" for e in d["edges"])


def test_secret_env_names_flagged_but_values_never_stored():
    d = scan()
    rt = next(x for x in d["assets"] if x["name"] == "settlement-tracker")
    assert rt["attributes"]["envVarNames"] == ["BROKER_API_KEY", "LOG_LEVEL", "MAX_TOKENS"]
    f = next(f for f in d["findings"] if f["rule"] == "SECRET_IN_ENV")
    assert f["evidence"]["variables"] == ["BROKER_API_KEY"]   # MAX_TOKENS is not a secret
    blob = json.dumps(d)
    for leaked in ("sk-live-abc123", "hf_secret", "SECRET SYSTEM PROMPT TEXT"):
        assert leaked not in blob


def test_open_weight_models_on_bedrock_sagemaker_and_ecs():
    d = scan()
    ow = {x["name"]: x for x in d["assets"] if x["kind"] == M.MODEL and x["attributes"].get("openWeight")}
    sm = ow["meta-llama/Llama-3.1-8B-Instruct"]
    assert sm["attributes"]["server"] == "vLLM" and sm["attributes"]["family"] == "Llama"
    assert sm["attributes"]["invocations"] == 1904
    assert sm["attributes"]["image"].endswith("vllm:0.6.3-gpu")          # digest stripped
    assert "llama31-8b-poc" in ow                                          # Bedrock Custom Model Import
    assert any(x["attributes"].get("server") == "Ollama" for x in ow.values())
    assert not any("xgboost" in (x["attributes"].get("image") or "") for x in d["assets"])  # classic ML ignored
    assert sum(1 for f in d["findings"] if f["rule"] == "OPEN_WEIGHT_NO_OWNER") == 3


def test_cloudtrail_usage_attributes_known_roles_and_flags_shadow_use():
    d = scan()
    a = by_id(d)
    known, shadow = a["aws:principal:HomeLoanAgentRole"], a["aws:principal:lending-ds-sandbox"]
    assert known["attributes"]["calls"] == 1 and shadow["attributes"]["calls"] == 2
    assert shadow["attributes"]["frameworks"] == ["langchain"]
    assert any(e["source"] == known["id"] and e["target"] == AGENT1 and e["type"] == "identity_of" for e in d["edges"])
    r = rules(d)
    assert ("UNATTRIBUTED_MODEL_USE", shadow["id"]) in r
    assert ("UNATTRIBUTED_MODEL_USE", known["id"]) not in r
    assert a["aws:bedrock-model:meta.llama3-1-70b-instruct-v1:0"]["attributes"]["openWeight"] is True


def test_agent_card_probe_is_opt_in():
    assert not any(x["attributes"].get("protocol") == "A2A" and "card" in x["attributes"] for x in scan()["assets"])
    d = scan(probe_agent_cards=True)
    card = next(x for x in d["assets"] if x["id"].startswith("a2a:"))
    assert card["name"] == "Broker Document Checker" and card["attributes"]["skills"] == ["Check income documents"]


def test_residency_and_errors_do_not_stop_scan():
    d = scan(regions=[R, "us-east-1"], home_regions=[R], denied={("ecs", R)})
    assert d["errors"] and d["errors"][0]["service"] == "ecs" and "AccessDenied" in d["errors"][0]["error"]
    assert any(x["name"] == "home-loan-preassess" for x in d["assets"])       # rest of scan still ran
    d2 = scan(regions=[R], home_regions=["ap-southeast-4"])
    assert any(f["rule"] == "OUTSIDE_HOME_REGION" and f["asset_id"] == AGENT1 for f in d2["findings"])


def test_skip_and_schema():
    d = scan(skip=["cloudtrail", "ecs"])
    assert d["schema"] == M.SCHEMA and d["account"] == ACCT
    assert not any(x["kind"] == M.PRINCIPAL for x in d["assets"])
    sev = [f["severity"] for f in d["findings"]]
    assert sev == sorted(sev, key=M.SEVERITIES.index)                   # most severe first


def test_helpers():
    assert role_name(f"arn:aws:sts::{ACCT}:assumed-role/MyRole/sess") == "MyRole"
    assert role_name(f"arn:aws:iam::{ACCT}:role/service-role/MyRole") == "MyRole"
    assert server_of("ghcr.io/huggingface/text-generation-inference:2.4") == "TGI"
    assert server_of("public.ecr.aws/docker/library/python:3.12") is None
    assert family_of("google/gemma-3-12b-it") == "Gemma"


def test_every_call_matches_the_real_aws_api_schema():
    """Validate the scanner's request parameters against botocore's service models."""
    import boto3
    from botocore.validate import validate_parameters
    import fake_aws

    session = boto3.session.Session()
    real: dict = {}
    calls: list = []
    orig = fake_aws.FakeClient.__getattr__

    def checked(self, op):
        fn = orig(self, op)

        def call(**kw):
            if self.service not in real:
                real[self.service] = session.client(self.service, region_name=R)
            c = real[self.service]
            api = c.meta.method_to_api_mapping[op]
            shape = c.meta.service_model.operation_model(api).input_shape
            if shape is not None:
                validate_parameters(kw, shape)
            calls.append(f"{self.service}.{op}")
            return fn(**kw)
        return call

    fake_aws.FakeClient.__getattr__ = checked
    try:
        scan(probe_agent_cards=True)
    finally:
        fake_aws.FakeClient.__getattr__ = orig
    assert len(set(calls)) >= 30
