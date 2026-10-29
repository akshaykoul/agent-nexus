# Agent Nexus scanner · AWS

Read-only discovery of AI agents, MCP servers, tools, knowledge bases and models in an AWS account. It writes one JSON inventory (`agent-nexus/inventory@0.1`) that the Agent Nexus catalog, graph and findings are built from.

## What it finds

| Source | What it records |
|---|---|
| Bedrock Agents | Agents, model, guardrail, deployed aliases, action groups (Lambda, functions, built-in code interpreter / computer use), knowledge bases and their data sources, multi-agent collaborators |
| Bedrock AgentCore | Runtimes and their protocol (HTTP, MCP, A2A), auth, network mode, env-var **names**; MCP gateways, auth type, policy engine, every target (Lambda, OpenAPI, remote MCP server, passthrough); AgentCore registry records and approval status |
| Bedrock | Imported open-weight models, fine-tuned models, Marketplace endpoints, provisioned throughput, guardrails |
| SageMaker | Endpoints serving LLMs (vLLM, TGI, DJL LMI, Ollama, SGLang, TensorRT-LLM…), the Hugging Face / JumpStart model id, 30-day invocations |
| ECS | Task definitions running inference servers |
| CloudTrail | `InvokeModel` / `Converse` calls per IAM principal, matched to known agent roles. Calls from roles that belong to no agent are flagged as possible shadow AI |
| API Gateway (opt-in) | `GET /.well-known/agent-card.json` on each API to find A2A agents |

### Findings it raises

| Rule | Severity |
|---|---|
| `MCP_NO_AUTH` MCP gateway accepts unauthenticated requests | critical |
| `OPEN_WEIGHT_NO_OWNER` self-hosted model with no owner tag | high |
| `SECRET_IN_ENV` credential-like env var names on a runtime | high |
| `HIGH_POWER_TOOL` code interpreter, computer use, bash, file editing | high |
| `UNATTRIBUTED_MODEL_USE` model calls from a role tied to no agent (high above 1,000 calls) | medium / high |
| `AGENT_NO_GUARDRAIL`, `EXTERNAL_ENDPOINT`, `CROSS_REGION_INFERENCE`, `WEB_CRAWL_SOURCE`, `OUTSIDE_HOME_REGION` | medium |
| `NO_OWNER`, `MCP_NO_POLICY`, `MCP_POLICY_LOG_ONLY`, `OPEN_WEIGHT_MODEL` | low |

## What it never does

* Invoke a model, agent, runtime, gateway or endpoint. The IAM role explicitly denies these actions.
* Read S3 objects, documents or knowledge-base content.
* Store prompts, agent instructions or environment-variable **values**. `GetAgent` and `GetAgentRuntime` return them; the scanner discards them and keeps only variable names.

## Run it

1. In the account to scan, deploy the read-only role:

   ```bash
   aws cloudformation deploy \
     --template-file iam/agent-nexus-readonly.yaml \
     --stack-name agent-nexus-readonly \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides ScannerPrincipalArn=arn:aws:iam::<scanner-account>:role/<scanner-role> \
                           ExternalId=$(openssl rand -hex 16)
   ```

2. Install and scan:

   ```bash
   pip install ./scanner
   agent-nexus-scan aws \
     --role-arn arn:aws:iam::<target-account>:role/AgentNexusReadOnly \
     --external-id <external-id> \
     --regions ap-southeast-2,ap-southeast-4,us-east-1 \
     --home-regions ap-southeast-2,ap-southeast-4 \
     --out inventory.json
   ```

   Without `--role-arn` it uses your current AWS credentials (`--profile` to pick one). Without `--regions` it scans every region where Bedrock is available.

Useful flags: `--days 30` (usage window, CloudTrail max 90), `--skip ecs,cloudtrail`, `--probe-agent-cards`, `--fail-on high` (exit code 2 for CI gates).

A summary prints to stderr; see `examples/sample-inventory.json` for the full output from the test fixture (a bank's retail lending account).

## Output shape

```json
{
  "schema": "agent-nexus/inventory@0.1",
  "account": "482177301956",
  "summary": { "assets": { "agent": 4, "model": 6 }, "findings": { "critical": 1, "high": 5 } },
  "assets":   [{ "id": "arn:…", "kind": "agent|mcp_server|tool|knowledge_base|data_source|model|guardrail|principal|registry_record",
                 "name": "…", "region": "…", "attributes": {}, "tags": {} }],
  "edges":    [{ "source": "…", "target": "…", "type": "uses_model|calls|reads|indexes|delegates_to|exposes|proxies|routes_to|invokes|identity_of|protected_by|embeds_with|derived_from" }],
  "findings": [{ "rule": "MCP_NO_AUTH", "severity": "critical", "asset_id": "…", "title": "…", "detail": "…", "evidence": {} }],
  "errors":   [{ "region": "…", "service": "…", "operation": "…", "error": "AccessDeniedException: …" }]
}
```

A failed call (missing permission, service not in region) is recorded in `errors` and the scan carries on.

## Tests

```bash
cd scanner && pip install -e .[test] && pytest
```

The tests run the scanner against a fake account and validate every request against botocore's real AWS API models, so a wrong parameter name fails the build.

## Known limits (v0.1)

* `InvokeAgent` and AgentCore runtime invocations are CloudTrail **data events**. They need a trail with data events enabled (plus Athena) and are not read yet; usage comes from management events (`InvokeModel`, `Converse`).
* `LookupEvents` is capped by `--max-events` per region and limited to 2 requests a second, so very busy accounts are sampled.
* EKS workloads need Kubernetes API access and are not scanned yet; ECS and SageMaker are.
* MCP servers outside AgentCore Gateway are found only when a gateway target or agent points at them.
* Organization-wide scanning (one role per member account via AWS Organizations) is the next step.
