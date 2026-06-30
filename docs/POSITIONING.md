# Positioning OpenClaw + Cernion Energy Tools Sidecar

This document captures how to explain the plugin to users who do not yet know
that a Cernion/OpenClaw integration exists.

## Core Message

OpenClaw is the agent runtime. Cernion Energy Tools is the energy-domain
evidence and policy layer. The Sidecar connects both so an assistant can answer
energy questions with Cernion-backed evidence instead of generic model memory.

Short form:

```text
Give OpenClaw agents Cernion-backed energy evidence: MaStR assets, grid context,
Redispatch, Zielnetzplanung, §14a/§14d, Knowledge RAG, process intake, and
read-only operational APIs.
```

## Discovery Problem

The expected users usually search for their job problem, not for a "sidecar".
They may look for:

- OpenClaw energy assistant
- MaStR assistant or MaStR evidence
- Redispatch agent
- Zielnetzplanung or ZNP assistant
- §14a EnWG or §14d EnWG workflow
- Netzanschluss, PV, BESS, HPC charging, or heat-pump grid context
- Cernion Knowledge RAG
- Verteilnetzbetreiber AI assistant
- Stadtwerke agent
- energy evidence router

Documentation and marketplace copy should put those words near the top.

## Audience

- Stadtwerke and Verteilnetzbetreiber teams that need grounded answers across
  MaStR, grid planning, Redispatch, regulatory duties, and operational status.
- Energy consultants and software teams that need an agent interface over
  Cernion capabilities without embedding Cernion tokens or business logic in
  prompts.
- OpenClaw users who want a local/private energy-domain assistant with tool
  discipline, not a generic chatbot.

## OpenClaw/Cernion Split

| Part | What to say |
| --- | --- |
| OpenClaw | Conversation, model selection, workspace instructions, tool orchestration, memory, and final answer synthesis. |
| Sidecar | Plugin configuration, token loading, request validation, token scrubbing, safe proxying, and tool surface inside OpenClaw. |
| Cernion Energy Tools | Energy capabilities, policies, Knowledge RAG, Evidence Router, MaStR/grid/market data semantics, and read-only operational APIs. |

The product promise is not "install another API wrapper". The promise is:
OpenClaw can become a fachlich disciplined energy assistant while Cernion stays
the source of truth for evidence, routing, and policy gates.

## Documentation Improvements Already Applied

- Rewrote the README opening so the first screen names the actual user problems:
  MaStR, grid context, Redispatch, ZNP, §14a/§14d, Knowledge RAG, process
  intake, and read-only operational APIs.
- Added "Who This Is For", "How OpenClaw And Cernion Work Together", example
  prompts, and capability bullets before the low-level endpoint contract.
- Added a ClawHub install command near the top.
- Expanded `package.json` keywords so package registries and marketplace search
  have energy-domain terms to index.
- Updated plugin/package descriptions away from "Dedicated sidecar" toward the
  actual outcome.

## Recommended Next Moves

- Republish a patch version so ClawHub and npm show the new description and
  keywords in their metadata.
- Add one short demo GIF or screenshot to the README showing a real
  Cernion-backed answer in OpenClaw Control UI.
- Publish a short "OpenClaw energy assistant with Cernion" guide that starts
  from one concrete use case, for example Meckesheim self-supply, §14a duties,
  or ZNP siting for PV/BESS/HPC.
- Link the ClawHub package from Cernion Energy Tools documentation under
  "Agent integrations", not only from the Sidecar repository.
- Create issue/discussion templates for three discovery paths:
  "I have an energy question", "I have a Cernion instance", and "I want to
  build an OpenClaw energy assistant".
