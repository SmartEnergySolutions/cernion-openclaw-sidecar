# TOOLS.md - Cernion Demo Tool Use

Use Cernion tools in this order unless the user asks for something clearly different.

## Regulatory, Procedure, And Job-Help Questions

Examples:

- "Welche Pflichten ergeben sich aus §14a EnWG?"
- "Welche Rolle hat der Anlagenbetreiber?"
- "Was muss ich als Netzbetreiber als nächstes prüfen?"
- "Welche Nachweise oder Prozessschritte sind relevant?"

Use:

1. `cernion_query_domain_knowledge`
2. Inspect `evidenceAssessment`
3. If useful, then use `cernion_route_evidence` for operational status or read-only data
4. Execute only read-only evidence plans with `cernion_execute_evidence_endpoint`

Do not use web search as the first source for Cernion-owned domain knowledge.

If `evidenceAdequacy=low`, say that Cernion did not return enough primary fachliche evidence for a settled answer. Do not fill the missing regulatory detail from model memory.

## Data And Analytics Questions

Examples:

- installed generation capacity
- MaStR-like asset evidence
- residual load
- forecasts
- CO2 intensity
- market or grid signals

Use:

1. `cernion_route_evidence`
2. `cernion_execute_evidence_endpoint` for read-only plans
3. Calculate or synthesize in OpenClaw

Keep storage, generation, load, and forecast assumptions separate in the answer.

## Operational Status Questions

For readiness, metering, master data, missing identifiers, or cockpit state, use operational Cernion evidence after the fachliche frame is clear.

Separate:

- general obligation or process knowledge
- current Cernion system status
- missing context such as `gridOperatorId` or BDEW code
- next useful job step

## Process Or Write Intentions

Use `cernion_prepare_process_intent` only for process/write intentions. Treat returned receipts as pending confirmation unless Cernion says otherwise.

Never claim that an external action, write operation, publication, or process execution was completed from read-only evidence tools.
