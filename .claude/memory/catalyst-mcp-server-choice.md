---
name: catalyst-mcp-server-choice
description: "Use the \"Catalyst Zoho\" (OCTFIS) MCP server for all boffo Catalyst DB ops — MCP_DS_HOME is the wrong account"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9e7f82ea-8a56-4661-b348-2053151d6821
---

For the boffo project (live projectId 69851000000043001 boffo-granito-export-tracker, Catalyst-org 925638796 = "OCTFIS", env Development; the old 76673000000030007 / org 926227227 is deleted and returns INVALID_ORG), always use the `claude.ai Catalyst Zoho` MCP server tools (`mcp__claude_ai_Catalyst_Zoho__*`). The `MCP_DS_HOME` server is a different Catalyst account — it returns INVALID_ORG for this org and the user rejected its use.

**Why:** MCP_DS_HOME is authenticated against another Zoho account; only Catalyst Zoho (OCTFIS) can reach the boffo data store.

**How to apply:** When loading Catalyst tools via ToolSearch, select only the `mcp__claude_ai_Catalyst_Zoho__` variants. Headers: `{"Environment":"Development","Catalyst-org":925638796}`; live table ids via List_All_Tables (SalesOrder 69851000000046003, Design 69851000000047363, PanelOrder 69851000000193408). Create_Column `description` must be short (a sentence 409s with MORE_THAN_MAX_LENGTH).
