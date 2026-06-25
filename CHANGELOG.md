# Changelog

All notable changes to the Cernion Energy Tools Sidecar for OpenClaw are documented here.

## 0.1.0 - Unreleased

- Initial dedicated Cernion Energy Tools Sidecar package for OpenClaw.
- Exposes Cernion descriptor, tool-list, provider tool calls, Knowledge RAG, OSM grid context, Evidence Router, process-intake, capability/operation resolution, read-only REST plan execution, and direct read-only Cernion API requests.
- Keeps read-only evidence and process-intake tokens separated.
- Blocks admin/auth/token/HITL-resolve/provider-tool recursion paths in read-only REST execution.
- Adds asset-list pagination and CSV/XLS export guidance for `/api/assets...` GET requests.
- Includes Docker demo workspace and smoke test.
