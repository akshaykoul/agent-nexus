# Agent Nexus

Clickable product demo of an AI agent audit and governance platform, framed around **Harbourline Bank**, a fictional Australian bank. All organisations, people, figures and incidents are illustrative.

## Run it

Open `index.html` in a browser. No build or server needed. Or enable GitHub Pages on this repo (Settings → Pages → Deploy from branch → `main` / root).

## Demo script (about 8 minutes)

1. **Control tower** – inventory of 11 agents across Salesforce, ServiceNow, Copilot Studio, Databricks, Workday and AWS. Point out the banner: two cloud landscapes are connected but never scanned.
2. **Scan AWS** – click *Scan AWS* → *Test connection* → choose discovery methods (control-plane APIs, A2A agent cards, MCP handshakes, invocation telemetry, open-weight models) → watch the live scan → *Register 4 assets*. One is a shadow workload running Llama 3.1 8B on SageMaker against real loan documents through an unauthenticated MCP server.
3. **Scan Google Cloud** – *Connect & scan* → pick Google Vertex AI → same flow. Finds an A2A peer of the Salesforce agent, a Gemma model on GKE, image generation running in the US, and a notebook sending unmasked customer data to Gemini.
4. **Registry** – tabs for agents, MCP servers, A2A endpoints and models; tick *Open-weight models only*.
5. **Catalog → agent graph** – open *Card Disputes Agent* or *Procurement Contract Reviewer*. Click a tool, skill, data source or model to trace where it comes from (MCP server → publisher → host). *Show all sources* expands everything. Check the *Trust score* and *Compliance* tabs.
6. **Reviews** – the scans dropped new agents into the GRC queue. Read the Nexus pre-check, then approve, approve with conditions, send back or reject (comment required).
7. **Incidents** – six cases modelled on public AI failures (invented refund policy, hidden prompt injection, agent changing production, fabricated citations, staff pasting PII into a public chatbot, biased screening) plus the shadow-AI cases the scans opened. Advance a case and tick off remediation actions.
8. **Audit log** – every action above is chained by hash. *Verify chain*, then *Export auditor pack*.

*Reset demo* (bottom of the left rail) returns to the starting state.

## Structure

```
src/shell.html   page skeleton
src/styles.css   design tokens and components (light + dark)
src/data.js      demo data: platforms, agents, tools, MCP servers, skills, models, reviews, incidents
src/app.js       hash-routed app, scanner, graph (Cytoscape.js), workbench, audit chain
build.py         inlines src/ into index.html (and dist/artifact.html)
```

Edit files in `src/`, then run `python3 build.py`.

Platform tiles use neutral monograms rather than vendor logos.
