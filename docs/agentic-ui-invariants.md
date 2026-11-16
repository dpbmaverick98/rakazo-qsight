# Agentic UI invariants

Status: product invariants for the client workspace. This document defines the
intended behaviour; it does not claim the current implementation satisfies every
invariant. Implementation gaps must be tracked against this document rather than
silently reinterpreted.

Scope: Rakazo web/Electron client workspace, desktop and web. Native mobile is
explicitly out of scope for this version.

Related:
- [Right rail tabs](right-rail-tabs.md) — tab/stage seam and Harness research.
- [Artifact stage](artifact-stage.md) — typed artifact seam.
- [Client hierarchy](hierarchy.md) — existing binding and authorization rules.

## 1. Product model

The workspace is organised around one selected project manager conversation.

```
Client
  └── Building
        └── Project
              └── Project manager conversation
                    ├── middle: coordination chat
                    └── right: read-only project views
```

- A **client** is the commercial relationship.
- A **building** is a physical place belonging to one client.
- A **project** is work at a building for that client.
- A **project manager** is the agent attached to one project. Selecting that
  manager selects the client, building, project, claims, and documents shown in
  the middle and right regions.
- QSight/Vendor One is the authority for project data: claims, sub vendors,
  packages, documents, evidence, invoices, proposed/breakdown amounts, and
  review status.
- Rakazo is the coordination and presentation layer. It does not create a second
  commercial ledger or a second document store.

### Core invariants

- **UI-1 — One selection chain.** The active client, building, project manager,
  and project MUST be one coherent chain. The UI MUST NOT mix a manager from one
  project with claims or documents from another.
- **UI-2 — Selection is explicit.** A project manager must be selected before the
  middle or right region shows project-specific content. The UI MUST NOT infer a
  project from a display name.
- **UI-3 — QSight is authoritative.** Displayed money, claim status, document
  counts, and evidence MUST come from Vendor One. Local UI state may cache them
  but MUST NOT author them.
- **UI-4 — Right region is view-only.** The right region MUST NOT create, rename,
  delete, upload, publish, approve, or edit records. Its actions are limited to
  navigation, expanding/collapsing, tab switching, and opening the corresponding
  QSight record.
- **UI-5 — One manager per project.** A project has one canonical project
  manager. Creating another manager for the same project is a conflict, not a
  duplicate row.
- **UI-6 — No silent fallback.** Missing hierarchy, binding, project, or data MUST
  produce an explicit empty/loading/unavailable state. The UI MUST NOT substitute
  a different client, project, or manager.
- **UI-7 — No internal leakage.** User-facing surfaces MUST NOT show raw tool
  names, request IDs, UUIDs, verification tokens, JSON payloads, storage keys, or
  provider internals. Deep links may contain canonical public IDs.
- **UI-8 — Desktop/web only.** Responsive narrow layouts may collapse regions, but
  native mobile parity is not required in this version.

## 2. Left sidebar

Purpose: see clients, create clients, and select the project manager conversation.

### Client level

- The sidebar lists clients as the top-level workspaces. A client name is the
  workspace identity; it MUST NOT be treated as the authority for the external
  client ID.
- The client row has a **3-dot menu** with:
  - **New building**
  - **New project**
  - **Delete client/space** only when the existing lifecycle rules allow it.
- **New project always requires a building.** When the client has one building it
  may be preselected; when it has multiple buildings the user must choose one. The
  same flow may create a new building and then continue to the project.
- Selecting the client row expands/collapses its hierarchy. It MUST NOT open a
  generic client chat.
- Creating a client uses the existing landing-page flow:
  1. post-login landing with **Create client**;
  2. client is created and bound;
  3. a default project manager is created;
  4. that manager asks for the building and project details;
  5. once the project is assigned, the manager is renamed and moved under the
     building.

### Building level

- A building is a **section heading** under its client. In this version it is
  non-interactive: no building chat, no building 3-dot, no building-level create
  action.
- The building section shows the building icon, the building name, and its
  projects/managers underneath.
- A building MUST be shown even when it has no project manager yet.
- Building creation belongs to the client 3-dot / default-manager conversation,
  not to the building section.

### Project manager level

- Each project manager appears under its building, labelled:
  `{Project name} - {Manager name}`.
  Until the project is assigned, the setup manager may show the default
  `Proj. Manager - Sam`.
- The manager row is the only selectable chat entry for a project.
- Selecting it MUST set the whole chain: client, building, project, and manager.
- The middle chat and right region MUST then follow that selection.
- A manager MUST move under the building automatically once its project is
  created/assigned. It MUST NOT remain duplicated at client level.
- Archive/restore must preserve the manager's conversation and placement.

### Ordering and state

- Clients are ordered by their existing user/roster preference.
- Buildings and managers use stable server-provided ordering; no client-side
  name inference.
- Expanded/collapsed state persists per user and client.
- Loading, empty, and unavailable states are explicit. A client with no building
  shows an empty hierarchy, not a fabricated project.
- Search should reveal ancestor context (client → building → manager) rather than
  a disconnected manager row.

## 3. Middle chat

Purpose: coordinate the client, building, project, and QSight work.

- The middle region is the conversation with the selected project manager.
- It MUST carry the selected client/building/project context into every turn and
  every tool call.
- The manager coordinates:
  - client, building, and project setup;
  - claims and sub vendors;
  - package/work-package creation;
  - document intake and evidence questions;
  - proposed vs breakdown vs invoiced differences;
  - review/clarification questions and next actions.
- The chat is **not** a second source of financial truth. When the manager says a
  number, the number MUST come from QSight or be labelled as a calculation based
  on QSight data.
- The manager MUST use construction language and short replies. It MUST NOT
  narrate tool names, JSON, UUIDs, tokens, or internal result cards.
- Each write action gets one clear business approval. Reads/preparation tools may
  be pre-trusted; writes MUST remain explicit unless deliberately trusted.
- The chat MAY show compact references/cards, but the authoritative record opens
  in QSight or the right region.
- Uploaded files enter the project's document/evidence flow. A chat attachment is
  not a published QSight document until the intake/publish path says so.
- On first setup, the manager asks one question at a time:
  building name/address → verified candidate confirmation → project name →
  claim/sub vendor/package details as needed.
- A failed or unavailable QSight call MUST be explained plainly and MUST NOT be
  replaced with invented data.

## 4. Right sidebar

Purpose: a view-only, tabbed project space that follows the selected manager.

### General tab rules

- The right region is a **tabbed stage**, not a second chat and not a form.
- The default tab is **Project space**.
- The default tabs, in order, are:
  1. **Project space**
  2. **Claims**
- **Sub vendors** is a context tab: it appears when the user selects a sub vendor
  in Claims and then shows that sub vendor's work and files. It is not a permanent
  empty tab before a selection.
- Selecting a file inside Sub vendors opens an additional **file preview** tab.
- Additional tabs are allowed for files, tables, and future project views. The two
  default tabs above are the baseline; they are not a closed set.
- Tabs are read-only. They may navigate to QSight, expand/collapse, select a
  claim/sub vendor, and open a file.
- The tab state is per project-manager conversation. Switching manager MUST switch
  the tabs to that manager's project; it MUST NOT reuse another project's tab
  content.
- The active tab persists per conversation. Missing state falls back to
  **Project space**.
- Claim, sub-vendor, and file navigation in the right region MUST update the PM's
  current context so the manager knows which claim, sub vendor, and file the user is
  viewing. This context is read-only and MUST NOT change the selected manager.
- No creation buttons, Add project, Add building, edit, delete, upload, publish, or
  approve controls belong in the right rail.
- The right region MUST populate automatically when the manager creates the
  building/project/claims; it MUST NOT require a manual refresh.
- Loading, empty, partial, and unavailable states are explicit. A map failure
  leaves building/project navigation usable.
- The right region MUST NOT show duplicated building names, duplicate project
  rows, or the same record under two tabs.

### Tab 1 — Project space

Default view for the selected manager.

- Large **client name** at the top.
- A pastel, static map using the **exact QSight/Vendor One portfolio basemap
  provider and style** (not a recolored third-party basemap):
  - pale grey/blue land and water;
  - white/minimal roads;
  - subdued labels;
  - one building marker with a concise label;
  - no pan, scroll zoom, double-click zoom, box zoom, keyboard zoom, touch zoom,
    or zoom controls;
  - required basemap attribution retained;
  - a building icon and building name below the map, with the address only when it
    differs from the building name;
  - no duplicated building name.
- Building logo/identity where available.
- The selected manager's project is **expanded**.
- Other projects at the building are **collapsed** but visible and selectable for
  read-only inspection.
- An expanded project shows:
  - project name and status;
  - claim names under the project;
  - links to QSight.
- Money totals are **claim-level**. Project space MUST NOT present an unlabelled
  project-level total as the authoritative proposed/breakdown/invoice figure;
  those figures live in Claims under their claim.
- The selected manager's project MUST be visually anchored to the manager
  selection; clicking another project may preview it but MUST NOT silently change
  the active chat manager.

### Tab 2 — Claims

Read-only claims view for the selected project.

- Header: project name.
- Claims list for that project.
- Each claim shows its own **Proposed**, **Breakdown**, **Invoices**, and
  remaining/position figures. These totals are **claim-level**, not project-level.
  A project rollup may be shown only when it is clearly labelled as a rollup.
- Under each claim: claim name and its sub vendors.
- Selecting a sub vendor opens the **Sub vendors** tab for that claim + sub vendor.
- No editing, creating, or approving claims here.
- Money formatting must be consistent and must preserve absent values as absent,
  not as zero. A real zero invoice is not the same as no invoice evidence.

### Context tab — Sub vendors

Read-only file/evidence view for the selected claim and sub vendor.

- The tab is absent until the user selects a sub vendor in Claims. Selecting a sub
  vendor opens and activates this tab for `{claim} / {sub vendor}`.
- Shows the selected sub vendor's work within the selected claim.
- File-system-like sub-tabs for the sub vendor:
  - **Proposal** — amount and source documents;
  - **Breakdown** — amount and source documents;
  - **Invoices** — invoice totals and invoice documents.
- Each file row shows a document role, amount when known, status, and a deep link
  to QSight for inspection.
- Clicking a file opens a **file preview tab** rather than expanding the file
  inline. The preview tab is read-only and returns to the Sub vendors tab on close.
- The selected claim, sub vendor, and file MUST be added to the PM's current
  context so the manager can discuss the exact work the user is viewing.
- Documents MUST remain grouped by their actual claim/sub vendor/package; no
  cross-project or cross-sub-vendor mixing.
- The tab is a view of the filing system, not an uploader.
- No raw storage keys, signed URLs, or document text.

### Auto-population

- Creating/assigning a project from the chat or left menu MUST make the right
  region reflect the new building/project without a manual reload.
- Creating a claim/sub vendor/work package MUST populate Claims for that project.
  A newly created sub vendor appears in Claims and can be selected to open the
  Sub vendors context tab.
- A newly created project starts with explicit empty states until claims/documents
  exist.
- Auto-population MUST NOT steal the user's active tab. The first creation may
  select **Project space**; later updates refresh content in place.

## 5. Cross-region state and authority

- The only user selection that drives all three regions is the **project manager**
  row in the left sidebar.
- Right-region tab/expansion state is local to that manager's conversation.
- Claim/sub-vendor selection is a right-region inspection state and MUST NOT
  change the left-side manager selection.
- Opening QSight is a navigation action; it MUST NOT mutate local state.
- A stale binding/revision MUST show a recoverable unavailable state, not another
  client's data.
- The client name is display data. Authority comes from the bound external client
  ID and its revision.

## 6. Empty, loading and error states

- **No client selected / no managers:** left shows clients; middle shows an
  explicit select-a-manager state; right is closed or empty with no project tabs.
- **Client with no building:** building section may be empty; right shows no
  building/map.
- **Building with no project:** building is visible; no manager under it; right
  shows building identity but no project tabs/claims.
- **Manager selected, project data loading:** show deterministic skeleton/loading
  states; do not show another manager's data.
- **QSight unavailable:** show a plain unavailable state and a retry path; keep
  the last known client/building identity if it is safe, but do not invent numbers.
- **Map unavailable:** keep building/project navigation and show a neutral
  placeholder; no broken Leaflet container.
- **Unknown tab/artifact kind:** inert fallback, never raw HTML.

## 7. Naming and copy

- Client: the client's canonical QSight name.
- Building: `{building name}` with a building icon. If the address differs, show
  it once as secondary text.
- Manager: `{project name} - PM` once assigned (for example, `NiceDesign - PM`);
  do not substitute a person's name into the assigned manager label. Before
  assignment the default manager is `Proj. Manager - Sam`.
- The setup manager becomes the project's permanent manager after assignment; its
  chat history is preserved.
- Avoid raw IDs, internal table names, tool names, and provider names in copy.
- Use construction terms: client, building, project, claim, sub vendor, work
  package, proposal, breakdown, invoice, change order, evidence, review.
- No generic “what do you want me to run?” onboarding copy.

## 8. Security and boundaries

- Right-region data is read-only.
- Writes happen only through the selected manager conversation and QSight's
  authorized commands, with approvals for write actions.
- Tool credentials are scoped to the project where possible; the setup manager may
  use broader broker access only during setup and must be promoted/replaced.
- No cross-client or cross-project data in tabs, even if the underlying token has
  broader access.
- No secret, token, verification token, storage key, or document text in UI state,
  logs, or artifacts.
- Deep links must be authorized; they do not grant access by themselves.

## 9. Acceptance invariants

A change that violates any of these is not ready:

- **INV-UI-01** Selecting a manager selects its client, building, and project.
- **INV-UI-02** A manager cannot appear under two buildings/projects.
- **INV-UI-03** The right rail contains no create/edit/delete controls.
- **INV-UI-04** Project space shows the client name large, pastel static map,
  building icon + one label, the selected project expanded, and other projects
  collapsed.
- **INV-UI-05** Claims shows only the selected project's claims and claim-level
  proposed/breakdown/invoice totals.
- **INV-UI-06** Selecting a sub vendor opens a Sub vendors tab for that claim/sub
  vendor; clicking a file opens a read-only file tab; the PM context records the
  current claim, sub vendor, and file.
- **INV-UI-07** New building/project/claim data appears in the right rail without
  a manual reload.
- **INV-UI-08** Empty, loading, unavailable, and unknown-kind states are explicit.
- **INV-UI-09** No raw tool names, IDs, tokens, JSON, or document text are exposed.
- **INV-UI-10** Desktop/web layout preserves the three regions; narrow layouts may
  collapse the right rail without changing the selection model.
- **INV-UI-11** Default tabs are Project space and Claims; additional tabs
  (Sub vendors, file preview, future tables) are allowed and are not creation
  surfaces.
- **INV-UI-12** The map uses the exact QSight basemap provider/style and is static.
- **INV-UI-13** An assigned manager is labelled `{Project} - PM`; the setup manager
  becomes permanent with history preserved.
- **INV-UI-14** New project always resolves a building; multiple buildings require
  an explicit choice, and the flow may create a building first.

## 10. Resolved decisions and remaining question

Resolved:

1. **Manager label:** an assigned manager is `{Project} - PM`, for example
   `NiceDesign - PM`. Before assignment the default is `Proj. Manager - Sam`.
2. **Claims totals:** totals are **claim-level**. Project space does not present an
   unlabelled project total as authoritative.
3. **Sub vendor selection:** the Sub vendors tab opens when the user selects a
   sub vendor. It is not auto-selected or shown as an empty default.
4. **Files:** clicking a file opens a read-only file preview tab.
5. **PM context:** claim, sub vendor, and file navigation is added to the selected
   manager's context.
6. **Tab extensibility:** additional tabs are allowed for files, tables, and
   future views; the baseline tabs are Project space and Claims.
7. **Map:** reuse the exact QSight portfolio basemap provider/style, static and
   read-only.
8. **Setup manager lifecycle:** the setup manager becomes the permanent project
   manager after assignment; chat history is preserved.
9. **Project creation from the client 3-dot:** New project always requires a
   building. With multiple buildings the user must choose one; the same flow may
   create a new building and continue to the project.
