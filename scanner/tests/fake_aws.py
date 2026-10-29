"""A small fake of the AWS APIs the scanner calls, shaped like a bank's Retail Lending AI account."""
from __future__ import annotations

import datetime as dt
import json

ACCT = "482177301956"
R = "ap-southeast-2"


class ClientError(Exception):
    def __init__(self, code: str, op: str):
        super().__init__(f"An error occurred ({code}) when calling the {op} operation")
        self.response = {"Error": {"Code": code}}


def _arn(svc: str, res: str, region: str = R) -> str:
    return f"arn:aws:{svc}:{region}:{ACCT}:{res}"


AGENT1, AGENT2 = _arn("bedrock", "agent/HLPA7K2Q"), _arn("bedrock", "agent/DOCCHK01")
GW = _arn("bedrock-agentcore", "gateway/lending-tools-gw")


def _ct_event(role: str, model: str, ua: str, minute: int) -> dict:
    t = dt.datetime(2026, 10, 20, 9, minute, tzinfo=dt.timezone.utc)
    body = {"eventTime": t.isoformat(), "userAgent": ua,
            "userIdentity": {"type": "AssumedRole", "arn": f"arn:aws:sts::{ACCT}:assumed-role/{role}/session-{minute}"},
            "requestParameters": {"modelId": model}}
    return {"EventName": "InvokeModel", "EventTime": t, "CloudTrailEvent": json.dumps(body)}


DATA = {
    # --- Bedrock Agents ------------------------------------------------
    ("bedrock-agent", "list_agents"): [
        {"agentSummaries": [{"agentId": "HLPA7K2Q"}], "nextToken": "p2"},
        {"agentSummaries": [{"agentId": "DOCCHK01"}]},
    ],
    ("bedrock-agent", "get_agent"): lambda agentId: {"agent": {
        "HLPA7K2Q": {"agentId": "HLPA7K2Q", "agentArn": AGENT1, "agentName": "home-loan-preassess", "agentStatus": "PREPARED",
                     "foundationModel": "arn:aws:bedrock:ap-southeast-2:%s:inference-profile/apac.anthropic.claude-sonnet-4-5-v1:0" % ACCT,
                     "agentResourceRoleArn": f"arn:aws:iam::{ACCT}:role/service-role/HomeLoanAgentRole",
                     "instruction": "SECRET SYSTEM PROMPT TEXT", "agentCollaboration": "SUPERVISOR"},
        "DOCCHK01": {"agentId": "DOCCHK01", "agentArn": AGENT2, "agentName": "broker-doc-check", "agentStatus": "PREPARED",
                     "foundationModel": "anthropic.claude-sonnet-4-5-v1:0",
                     "agentResourceRoleArn": f"arn:aws:iam::{ACCT}:role/DocCheckRole",
                     "guardrailConfiguration": {"guardrailIdentifier": "gr-lending", "guardrailVersion": "3"}},
    }[agentId]},
    ("bedrock-agent", "list_agent_aliases"): lambda agentId: {"agentAliasSummaries": [
        {"agentAliasId": "TSTALIASID", "agentAliasName": "test"}] + ([{"agentAliasId": "PROD1", "agentAliasName": "prod"}] if agentId == "HLPA7K2Q" else [])},
    ("bedrock-agent", "list_tags_for_resource"): lambda resourceArn: {"tags": {"owner": "priya.natarajan"} if resourceArn == AGENT1 else {}},
    ("bedrock-agent", "list_agent_action_groups"): lambda agentId, agentVersion: {"actionGroupSummaries": [
        {"actionGroupId": "AG1"}, {"actionGroupId": "AG2"}] if agentId == "HLPA7K2Q" else []},
    ("bedrock-agent", "get_agent_action_group"): lambda agentId, agentVersion, actionGroupId: {"agentActionGroup": {
        "AG1": {"actionGroupName": "credit-bureau", "actionGroupState": "ENABLED",
                "actionGroupExecutor": {"lambda": _arn("lambda", "function:credit-bureau")},
                "functionSchema": {"functions": [{"name": "bureau_enquiry"}, {"name": "credit_score"}]}},
        "AG2": {"actionGroupName": "calc", "parentActionSignature": "AMAZON.CodeInterpreter"},
    }[actionGroupId]},
    ("bedrock-agent", "list_agent_knowledge_bases"): lambda agentId, agentVersion: {"agentKnowledgeBaseSummaries": [
        {"knowledgeBaseId": "KB1"}] if agentId == "HLPA7K2Q" else []},
    ("bedrock-agent", "get_knowledge_base"): lambda knowledgeBaseId: {"knowledgeBase": {
        "knowledgeBaseArn": _arn("bedrock", "knowledge-base/KB1"), "name": "lending-policy-kb", "status": "ACTIVE",
        "knowledgeBaseConfiguration": {"type": "VECTOR", "vectorKnowledgeBaseConfiguration": {
            "embeddingModelArn": "arn:aws:bedrock:ap-southeast-2::foundation-model/amazon.titan-embed-text-v2:0"}},
        "storageConfiguration": {"type": "OPENSEARCH_SERVERLESS"}}},
    ("bedrock-agent", "list_data_sources"): lambda knowledgeBaseId: {"dataSourceSummaries": [{"dataSourceId": "DS1"}, {"dataSourceId": "DS2"}]},
    ("bedrock-agent", "get_data_source"): lambda knowledgeBaseId, dataSourceId: {"dataSource": {
        "DS1": {"name": "credit-policy", "dataSourceConfiguration": {"type": "S3", "s3Configuration": {"bucketArn": "arn:aws:s3:::hlb-credit-policy"}}},
        "DS2": {"name": "competitor-rates", "dataSourceConfiguration": {"type": "WEB"}},
    }[dataSourceId]},
    ("bedrock-agent", "list_agent_collaborators"): lambda agentId, agentVersion: {"agentCollaboratorSummaries": [
        {"collaboratorName": "broker-doc-check", "agentDescriptor": {"aliasArn": _arn("bedrock", "agent-alias/DOCCHK01/PRODX")}}]
        if agentId == "HLPA7K2Q" else []},
    # --- AgentCore -----------------------------------------------------
    ("bedrock-agentcore-control", "list_agent_runtimes"): {"agentRuntimes": [
        {"agentRuntimeId": "rt-a2a", "agentRuntimeArn": _arn("bedrock-agentcore", "runtime/rt-a2a")},
        {"agentRuntimeId": "rt-mcp", "agentRuntimeArn": _arn("bedrock-agentcore", "runtime/rt-mcp")}]},
    ("bedrock-agentcore-control", "get_agent_runtime"): lambda agentRuntimeId: {
        "rt-a2a": {"agentRuntimeArn": _arn("bedrock-agentcore", "runtime/rt-a2a"), "agentRuntimeName": "settlement-tracker",
                   "protocolConfiguration": {"serverProtocol": "A2A"}, "status": "READY", "networkConfiguration": {"networkMode": "PUBLIC"},
                   "roleArn": f"arn:aws:iam::{ACCT}:role/SettlementRuntimeRole",
                   "agentRuntimeArtifact": {"containerConfiguration": {"containerUri": f"{ACCT}.dkr.ecr.ap-southeast-2.amazonaws.com/settle:1.2"}},
                   "environmentVariables": {"BROKER_API_KEY": "sk-live-abc123", "MAX_TOKENS": "4096", "LOG_LEVEL": "info"}},
        "rt-mcp": {"agentRuntimeArn": _arn("bedrock-agentcore", "runtime/rt-mcp"), "agentRuntimeName": "core-lending-mcp",
                   "protocolConfiguration": {"serverProtocol": "MCP"}, "status": "READY",
                   "authorizerConfiguration": {"customJWTAuthorizer": {"discoveryUrl": "https://idp.example/.well-known/openid-configuration"}}},
    }[agentRuntimeId],
    ("bedrock-agentcore-control", "list_gateways"): {"items": [{"gatewayId": "lending-tools-gw", "authorizerType": "NONE"}]},
    ("bedrock-agentcore-control", "get_gateway"): lambda gatewayIdentifier: {
        "gatewayArn": GW, "name": "lending-tools-gw", "gatewayUrl": "https://lending-tools-gw.gateway.bedrock-agentcore.ap-southeast-2.amazonaws.com/mcp",
        "authorizerType": "NONE", "protocolType": "MCP", "status": "READY"},
    ("bedrock-agentcore-control", "list_gateway_targets"): lambda gatewayIdentifier: {"items": [{"targetId": "T1"}, {"targetId": "T2"}, {"targetId": "T3"}]},
    ("bedrock-agentcore-control", "get_gateway_target"): lambda gatewayIdentifier, targetId: {
        "T1": {"name": "credit-bureau", "targetConfiguration": {"mcp": {"mcpServer": {"endpoint": "https://mcp.bureau.example.com.au/v2"}}},
               "credentialProviderConfigurations": [{"credentialProviderType": "API_KEY"}]},
        "T2": {"name": "serviceability", "targetConfiguration": {"mcp": {"lambda": {"lambdaArn": _arn("lambda", "function:serviceability")}}}},
        "T3": {"name": "core-lending", "targetConfiguration": {"http": {"agentcoreRuntime": {"arn": _arn("bedrock-agentcore", "runtime/rt-mcp")}}}},
    }[targetId],
    ("bedrock-agentcore-control", "list_registries"): {"registries": [{"registryId": "reg1", "name": "lending-registry"}]},
    ("bedrock-agentcore-control", "list_registry_records"): lambda registryId: {"registryRecords": [
        {"recordId": "r1", "recordArn": _arn("bedrock-agentcore", "registry/reg1/record/r1"), "name": "core-lending-mcp",
         "descriptorType": "MCP", "status": "APPROVED"}]},
    # --- Bedrock models --------------------------------------------------
    ("bedrock", "list_imported_models"): {"modelSummaries": [
        {"modelArn": _arn("bedrock", "imported-model/llama31-8b-poc"), "modelName": "llama31-8b-poc", "modelArchitecture": "llama3"}]},
    ("bedrock", "list_tags_for_resource"): lambda resourceARN: {"tags": []},
    ("bedrock", "list_custom_models"): {"modelSummaries": []},
    ("bedrock", "list_marketplace_model_endpoints"): {"marketplaceModelEndpoints": []},
    ("bedrock", "list_provisioned_model_throughputs"): {"provisionedModelSummaries": []},
    ("bedrock", "list_guardrails"): {"guardrails": [{"id": "gr-lending", "arn": _arn("bedrock", "guardrail/gr-lending"), "name": "lending-guardrail", "version": "3"}]},
    # --- SageMaker -------------------------------------------------------
    ("sagemaker", "list_endpoints"): lambda StatusEquals: {"Endpoints": [
        {"EndpointName": "llama31-8b-loan-poc", "EndpointArn": _arn("sagemaker", "endpoint/llama31-8b-loan-poc")},
        {"EndpointName": "churn-xgb", "EndpointArn": _arn("sagemaker", "endpoint/churn-xgb")}]},
    ("sagemaker", "describe_endpoint"): lambda EndpointName: {"EndpointConfigName": EndpointName + "-cfg",
                                                              "ProductionVariants": [{"VariantName": "AllTraffic"}]},
    ("sagemaker", "describe_endpoint_config"): lambda EndpointConfigName: {"ProductionVariants": [{"ModelName": EndpointConfigName[:-4] + "-model"}]},
    ("sagemaker", "describe_model"): lambda ModelName: {"PrimaryContainer": {
        "llama31-8b-loan-poc-model": {"Image": "763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/vllm:0.6.3-gpu@sha256:9f2c",
                                      "Environment": {"HF_MODEL_ID": "meta-llama/Llama-3.1-8B-Instruct", "HF_TOKEN": "hf_secret"}},
        "churn-xgb-model": {"Image": "783357654285.dkr.ecr.ap-southeast-2.amazonaws.com/sagemaker-xgboost:1.7-1"},
    }[ModelName]},
    ("sagemaker", "list_inference_components"): lambda EndpointNameEquals: {"InferenceComponents": []},
    ("sagemaker", "list_tags"): lambda ResourceArn: {"Tags": []},
    ("cloudwatch", "get_metric_statistics"): lambda **kw: {"Datapoints": [{"Sum": 1000.0}, {"Sum": 904.0}]},
    # --- ECS ---------------------------------------------------------------
    ("ecs", "list_task_definitions"): lambda status: {"taskDefinitionArns": [_arn("ecs", "task-definition/ollama-sandbox:3")]},
    ("ecs", "describe_task_definition"): lambda taskDefinition: {"taskDefinition": {"family": "ollama-sandbox", "containerDefinitions": [
        {"name": "ollama", "image": "ollama/ollama:0.3.12", "environment": [{"name": "OLLAMA_HOST", "value": "0.0.0.0"}]}]}},
    # --- CloudTrail --------------------------------------------------------
    ("cloudtrail", "lookup_events"): lambda **kw: {"Events": [
        _ct_event("HomeLoanAgentRole", "anthropic.claude-sonnet-4-5-v1:0", "aws-sdk-python bedrock-agent", 1),
        _ct_event("lending-ds-sandbox", "meta.llama3-1-70b-instruct-v1:0", "Boto3/1.40 langchain-aws/0.2", 2),
        _ct_event("lending-ds-sandbox", "meta.llama3-1-70b-instruct-v1:0", "Boto3/1.40 langchain-aws/0.2", 3),
        {"EventName": "ListFoundationModels", "CloudTrailEvent": "{}"}]},
    # --- API Gateway -------------------------------------------------------
    ("apigateway", "get_rest_apis"): {"items": [{"id": "abc123"}]},
    ("apigateway", "get_stages"): lambda restApiId: {"item": [{"stageName": "prod"}]},
    ("apigatewayv2", "get_apis"): {"Items": []},
}


class FakeClient:
    def __init__(self, service: str, region: str, denied: set[tuple[str, str]]):
        self.service, self.region, self.denied = service, region, denied

    def __getattr__(self, op: str):
        key = (self.service, op)

        def call(**kw):
            if (self.service, self.region) in self.denied:
                raise ClientError("AccessDeniedException", op)
            if self.region != R:  # other regions: empty account
                return {}
            spec = DATA.get(key)
            if spec is None:
                raise AssertionError(f"unexpected call {self.service}.{op}({kw})")
            if isinstance(spec, list):  # paged
                return spec[1] if kw.get("nextToken") else spec[0]
            if callable(spec):
                kw.pop("nextToken", None)
                return spec(**kw)
            return spec
        return call


def factory(denied: set[tuple[str, str]] | None = None):
    clients: dict = {}

    def make(service: str, region: str):
        return clients.setdefault((service, region), FakeClient(service, region, denied or set()))
    return make


def fetch(url: str):
    if url == "https://abc123.execute-api.ap-southeast-2.amazonaws.com/prod/.well-known/agent-card.json":
        return 200, json.dumps({"name": "Broker Document Checker", "version": "1.1.0", "url": "https://brokers.example/doc-check",
                                "skills": [{"id": "check", "name": "Check income documents"}]})
    return 404, ""
