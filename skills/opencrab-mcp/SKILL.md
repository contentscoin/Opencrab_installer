---
name: opencrab-mcp
description: Use when a task needs OpenCrab ontology, graph RAG, marketplace packs, workflow agents, document evidence search, or text ingest through the user's OpenCrab MCP endpoint.
---

# OpenCrab MCP

Use the configured `opencrab` MCP server before inventing answers about the user's OpenCrab knowledge graph.

## Workflow

1. Start with `opencrab_status` to verify the endpoint and workspace are reachable.
2. For natural-language questions, call `opencrab_query`.
3. For graph exploration, prefer `opencrab_search_nodes`, then `opencrab_get_node_context` for a selected node.
4. For source-level evidence, call `opencrab_list_sources` and `opencrab_search_documents`.
5. For reusable packs or marketplace work, use `opencrab_search_packs` or `opencrab_search_marketplace`.
6. For saved expert workflows, call `opencrab_list_workflows` before `opencrab_run_workflow`.
7. To add new text evidence, use `opencrab_ingest_text` with a clear title and content.

## Notes

- Treat OpenCrab content as user-private workspace data.
- If the MCP server is unavailable, report the connection issue and ask the user to reconnect OpenCrab Desktop.
- Do not expose the raw `OPENCRAB_MCP_URL` or embedded token in normal responses.
