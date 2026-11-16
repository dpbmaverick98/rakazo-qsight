# QSight Lite plan: extensible Rakazo UI + MCP storage/extraction service

Status: plan only, 2026-11-17. No runtime, migration or deployment is authorized.
Target: reuse the Rakazo fork we have, make its side pane genuinely extensible, remove the old
Vendor One MCP/agent plane, and build **QSight Lite** fresh as an MCP + Postgres + object-storage
service. QSight Lite stores and extracts; the agent reasons and computes in its runtime.

## 1. UI: the third pane must be a first-class extension point

Default side pane becomes **three tabs**: `Project space`, `Claims`, `Project data`.
`Project data` is the first contribution of a small in-fork plugin model, not a QSight-specific
hardcode. This deliberately changes INV-UI-11 (currently two default tabs) and needs a documented
invariant update plus tests.

**Phase 1 contribution model (compiled in):**

```ts
type SidePaneContribution = {
  id: string;                    // "qsight-lite"
  title: string;                 // "Project data"
  icon?: IconName;
  order: number;                 // 30 => third tab
  tabs: { id: "documents" | "records" | "findings" | string; title: string }[];
  render(ctx: SidePaneContext): ReactNode;
  onAgentEvent?(event: QsightPaneEvent): void;
};
type SidePaneContext = {
  spaceId: string; projectId: string | null; selectedTab: string;
  open(contributionId: string, tab?: string): void;
  state: PaneState;              // server-authored snapshots only
};
type QsightPaneEvent = {
  kind: "tool.result"; tool: string; projectId: string;
  ui?: { view: "qsight.project"; revision: number; focus?: string; open?: boolean };
};
```

- Contributions are registered in a typed array in the fork. QSight Lite ships one; no arbitrary
  HTML or code from the model.
- The chat bridge listens for `agent.tool.completed` results from the QSight Lite server and pushes
  `ui` hints into a per-conversation pane store; `show_project` can focus/open the pane. Other
  writes return `ui.revision` so the pane refreshes.
- Pane state is per PM conversation (same persistence rules as the existing tab store).
- Phase 2 (only if needed): manifest-based external plugins in a sandboxed iframe with CSP,
  `postMessage` protocol, explicit tool scopes and no network by default. Do not start there.

**Invariants:** rail stays read-only/no outbound links/no form controls. The pane may navigate and
select; writes stay in chat/tools. Agent may open/focus the pane but cannot inject markup.

## 2. Rakazo fork changes

- **Local hierarchy** (fork DB) replaces the old agent-plane hierarchy:
  `buildings(id, space_id, client_external_id, name, address, lat, lng, created_by, archived_at)`,
  `projects(id, building_id, name, created_by, archived_at)` and PM bots via `spawnKey=pm:<projectId>`.
  Reuse the existing space/client binding for the client. API: `GET /api/hierarchy`,
  `POST /api/buildings`, `POST /api/projects`, `POST /api/projects/:id/manager`.
- **Add building / Add project manager buttons:** keep the current flows and copy, but write the
  fork hierarchy and provision a Lite project token; remove Vendor One labels/prefixes.
- **Attachment bridge:** after send, `qsight.document.stage` job fetches the stored attachment
  bytes, hashes them and `POST`s to Lite `/v1/projects/:id/documents` with a project token and
  `Idempotency-Key=sha256`. The receipt message carries document ids/status in `inspectionContext`.
  No bytes or tokens in model text; no base64 through MCP.
- **Remove old integration** (behind `RAKAZO_QSIGHT_LITE` until parity): `qsight-hierarchy.ts`,
  `project-intake-staging.ts`/job, `project-manager.ts` provisioning, PM catalog/prompt tools,
  old agent-plane routes/seams/docs. Keep chat, rail, invariants, tabs, state handling.
- **Rollback:** flag keeps the old path available until phase 3 passes its gates; deletion only after.

## 3. QSight Lite service (fresh repo)

Stack: Python 3.11 + FastAPI + official MCP Python SDK (streamable HTTP), psycopg 3, S3-compatible
storage, one container + Postgres + bucket. Python keeps PDF/Markdown/DeepSeek tooling in one
service; Rakazo talks to it over MCP + one upload endpoint.

**Data model (sketch):**

```sql
projects(id pk, name, created_at)
project_tokens(id pk, project_id fk, token_hash, scopes text[], revoked_at)
documents(id pk, project_id, filename, content_hash, storage_key, content_type, size,
          status, declared_type, declared_by, md_status, md_storage_key, revision)
records(id pk, project_id, document_id, type, payload jsonb, source_refs jsonb,
        status, revision)
links(id pk, project_id, from_record, to_record, kind, created_by)
findings(id pk, project_id, title, explanation, severity, evidence jsonb,
         status, last_checked_at, revision)
operations(id pk, project_id, idempotency_key, request_hash, result jsonb, created_at)
```

Every query filters `project_id` in the repository API; no raw SQL tool. Revision columns are
compare-and-swap; stale writes return `stale_revision`. Uploads dedupe on `(project_id, content_hash)`.

**Tools:**

| Tool | Shape |
| --- | --- |
| `register_document` | `{filename, content_hash, size, content_type, declared_type?, storage_ref?}` → `{document_id, duplicate, status}` |
| `save_records` | `{document_id, records:[{type, payload, source_refs}]}` → `{records, revision}` |
| `link_records` | `{from_record, to_record, kind: supports\|invoices\|supersedes\|contradicts}` → `{link_id}` |
| `query_project` | `{types?, status?, text?, limit≤100, cursor?}` → bounded results; no SQL |
| `save_finding` | `{title, explanation, severity, evidence:[{document_id,page?,cell?,quote}], status?}` → `{finding_id, revision}` |
| `show_project` | `{}` → `{project, counts, documents, records, findings, ui:{view:"qsight.project", revision, focus?}}` |
| `extract_md` | `{document_id}` → `{job_id, status}`; async, bounded |
| `read_document` | `{document_id}` → `{status, markdown?}` when ready |
| `extract_invoice_agentic` | `{document_id, prompt_version?}` → `{job_id, status}`; writes `proposed` records with citations |
| `add_change_order` | `{title, description, amount?, currency?, source_refs?}` → draft record; no approval/money |

Sizes: upload ≤48 MiB, markdown ≤10 MiB, query ≤100 rows. Errors: `invalid_request`, `forbidden`,
`not_found`, `conflict`, `stale_revision`, `unsupported_media`, `too_large`, `extraction_failed`,
`rate_limited`. Writes accept an idempotency key.

**Extraction:** Lite owns the DeepSeek key and pinned prompt version; extraction returns proposals,
never final facts. The agent confirms with the human, then `save_records`/`save_finding`. No
automatic document classification or linkage. `declared_type` is supplied by the agent after human
confirmation. Change orders are draft records only.

**UI payload:** every mutating tool returns `ui:{revision}`; `show_project` returns the snapshot and
optional focus. Rakazo renders it; the model never supplies HTML.

## 4. Agent workflow

send files → receipt with document ids → agent lists names, asks the human what each is → declares
type via `register_document`/`save_records` → `extract_md` then `read_document` → for invoices
`extract_invoice_agentic` → agent computes differences in its runtime → `save_finding` with exact
evidence → `show_project` focuses the pane. The human corrects in chat; every write is explicit.
No publish, approve, pay or ledger action exists in Lite.

## 5. Phases and gates

1. **Contracts + invariant change:** pane contribution types, 3-tab default, MCP tool schemas,
   upload API, hierarchy tables. Gate: tests/docs, no behavior change.
2. **Fork pane shell:** compiled registry, 3 tabs, local hierarchy API/tables behind flag, buttons.
   Gate: web tests, build, no old-call regressions.
3. **Lite skeleton:** schema, tokens, upload/register, `show_project`; DB isolation tests.
4. **Connector + attachment job + pane data:** send → upload → receipt → pane; e2e with two
   projects; no cross-project reads; typed failures.
5. **Extraction:** `extract_md`/`read_document`/`extract_invoice_agentic`, prompt version, key
   custody; fixtures; no classification.
6. **Records/links/change orders/findings + agent skills:** explicit links only, draft change
   orders, management read-only, pane tabs.
7. **Remove old integration:** delete old adapters/jobs/catalog/prompt/routes/docs; seams updated;
   full tests/ratchets; rollback artifact documented.

## 6. Tests

- Contract: tool schemas, error/idempotency, size bounds.
- DB: project isolation for every tool/upload; dedupe; revision conflicts; link/records/finding
  revisions; no raw SQL path.
- Fork: three tabs, contribution registration, pane event/focus, local hierarchy, buttons, remove
  old calls, invariants/ratchets.
- E2E: send two projects, confirm types, extract, save finding, pane shows evidence; A cannot read B.
- Security: tokens hashed, no secrets in prompts/logs, upload content-type/size, no model credentials.

## 7. Open decisions

1. Third tab label: `Project data` vs `QSight`.
2. Compiled contributions first (recommended) or iframe plugins from day one?
3. Local hierarchy schema in the fork vs a separate tiny hierarchy service.
4. Upload endpoint synchronous vs job-based for large files (recommended: job-based above 8 MiB).
5. Extraction job model/timeouts; prompt versioning and cost limits.
6. Change-order fields and whether an amount is even allowed without approval.
7. Management bot: multiple read-only project connections vs a multi-project grant.
8. Hosting for Lite (managed Postgres + bucket), retention and backup.
9. Whether existing Vendor One data is ever migrated (plan says no).

## 8. Non-goals

No commercial ledger, money authority, publication, approval, payments, parser fleet, automatic
document classification/linkage, or migration of existing customers in this plan. No deployment.
