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

If `evidenceAdequacy=low`, say that Cernion returned useful domain/strategy knowledge, but not enough primary-source support for a settled legal or procedural obligation. Do not fill the missing regulatory detail from model memory.

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

## ZNP, Netzanschluss, And Spatial Grid Context

Examples:

- Zielnetzplanung or ZNP prechecks
- voltage-level hypotheses for PV, BESS, HPC charging, or industrial loads
- data-center and other large-load siting questions
- likely critical HS/MS/MS/NS areas
- substations, lines, visible grid topology, or site context
- fNAV or flexible connection assessment

Use:

1. `cernion_query_domain_knowledge` for ZNP, §14d, fNAV, NOVA, and process/strategy knowledge
2. `cernion_query_grid_context` for OSM-visible substations, voltage levels, lines, and topology metrics
3. `cernion_route_evidence` for MaStR, residual load, forecasts, market partners, or operational backend status
4. `cernion_execute_evidence_endpoint` for read-only plans

For a broad region such as a Landkreis, first use `cernion_query_grid_context`
with substations only. Do not request full grid topology for the whole county
as the first step. After a small set of candidate municipalities has emerged,
run `cernion_query_grid_context` again with `includeTopology=true` for each
candidate or a narrow bounding box.

If the broad-region OSM call degrades or times out, do not fail the answer.
State the OSM evidence gap and continue by narrowing the question to plausible
candidate municipalities or known grid nodes from Cernion Fachwissen, evidence
routing, or explicitly named external sources. Then run the OSM/grid-context
check on those narrower places.

For data centers or other large-load projects, use this evidence hierarchy:

1. Explicit grid-connection availability maps or published connection capacity
2. Operator-confirmed Anschlusskapazität or grid-connection study evidence
3. Concrete substation, voltage-level, transformer, or line evidence
4. Generic grid-expansion projects
5. OSM proximity

Do not rank a site highly merely because a substation or corridor is being
expanded. Ausbau is a signal to investigate, not proof that capacity is
available. If an availability map marks a node unavailable, that outweighs a
generic positive statement about the local expansion project.

Treat OSM grid context as concrete hypothesis evidence. It can make a ZNP answer
more specific about likely Spannungsebenen, Umspannwerke, Leitungskorridore, and
network-area risks. It does not prove available capacity, switching state,
protection settings, complete ownership, or final Netzverträglichkeit.

If OSM returns no objects, say that this OSM scope returned no visible objects.
Do not say Cernion has no grid data unless all relevant Cernion evidence paths
were checked.

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
