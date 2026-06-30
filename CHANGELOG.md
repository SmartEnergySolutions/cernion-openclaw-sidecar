# Changelog

All notable changes to the Cernion Energy Tools Sidecar for OpenClaw are documented here.

## 0.1.2 - 2026-06-30

- Repositions the package and README around discoverable energy use cases:
  MaStR assets, grid context, Redispatch, ZNP, §14a/§14d, Knowledge RAG,
  process intake, and read-only operational APIs.
- Adds package keywords and a Sidecar positioning note for ClawHub/npm
  discoverability and follow-up documentation work.

## 0.1.1 - 2026-06-25

- Adds required ClawHub code-plugin metadata:
  `openclaw.compat.pluginApi` and `openclaw.build.openclawVersion`.
- Adds `openclaw.runtimeExtensions` pointing at the built runtime entry.

## 0.1.0 - 2026-06-25

- Initial dedicated Cernion Energy Tools Sidecar package for OpenClaw.
- Exposes Cernion descriptor, tool-list, provider tool calls, Knowledge RAG, OSM grid context, Evidence Router, process-intake, capability/operation resolution, read-only REST plan execution, and direct read-only Cernion API requests.
- Keeps read-only evidence and process-intake tokens separated.
- Blocks admin/auth/token/HITL-resolve/provider-tool recursion paths in read-only REST execution.
- Adds asset-list pagination and CSV/XLS export guidance for `/api/assets...` GET requests.
- Includes Docker demo workspace and smoke test.
