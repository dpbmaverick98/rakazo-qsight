# UI invariant coverage

Status: evidence map, not a deployment claim. Every row points at the strongest
automated check currently in the repository; where only a manual check exists,
[the test checklist](ui-intake-test-checklist.md) carries the step. “Partial”
means unit/contract coverage without a visual or full-stack run.

| Invariant | Source of truth | Automated evidence | Manual step | Status |
| --- | --- | --- | --- | --- |
| INV-UI-01 one selection chain | `hierarchy-rail.tsx`, `hierarchy.ts` | `hierarchy-rail.test.tsx` (“expands only the PM project…”), `project-commercial.test.tsx` (“isolates late responses…”), `e2e/hierarchy.spec.ts` | A5–A6 | Automated + e2e |
| INV-UI-02 one manager per project | `project-manager.ts` | `project-manager.test.ts` (“reuses scoped credentials and IDs…”, one server/bot), PM prompt tests | A6 | Automated |
| INV-UI-03 no write controls in rail | four rail files | `rail-no-form-controls` ratchet; `project-commercial.test.tsx` (“without write actions”); `artifact-stage.test.tsx` | B10 | Enforced |
| INV-UI-04 project space identity | `hierarchy-rail.tsx`, `building-map` | `hierarchy-rail.test.tsx`, `building-map-failure.test.tsx`; `e2e/hierarchy.spec.ts` | B12–B14 | Partial (visual manual) |
| INV-UI-05 claim-level claims | `project-commercial.tsx` | `project-commercial.test.tsx` (“groups packages behind claim and vendor disclosures and preserves canonical null money”); “keeps Claims scoped” | B15 | Automated |
| INV-UI-06 sub vendor/file context | `commercial-inspection.tsx`, `document-preview.tsx`, `thread-target.ts` | `hierarchy-rail.test.tsx`, `artifact-stage.test.tsx`, `chat-context.test.tsx`; PM context tests | B16–B18 | Partial (context capture manual) |
| INV-UI-07 no manual reload | `hierarchy-refresh.ts` | `project-commercial.test.tsx` (“refreshes the active project from existing hierarchy signals”); `hierarchyChangedBy` covers tool completion and run terminal events | C28 | Automated |
| INV-UI-08 explicit states | `hierarchy-rail`, `project-commercial`, `document-preview` | “maps project stage failures in priority order”, “loading, empty, error/retry”, “stale connection warning…”, `building-map-failure` | C21–C26 | Automated |
| INV-UI-09 no internal leakage | copy and renderers | `artifact-stage.test.tsx` unknown-kind fallback; `no-vendor-names-outside-adapters`; receipt tests assert no URLs/keys | B19, D2 | Partial (copy review manual) |
| INV-UI-10 desktop/narrow layout | shell CSS/layout | none specific | B20 | Manual |
| INV-UI-11 default tabs + extensions | `commercial-inspection.tsx` | `hierarchy-rail.test.tsx` tab tests; `artifact-stage.test.tsx` | B9 | Automated |
| INV-UI-12 exact static basemap | `building-map` | `building-map-failure.test.tsx` (failure path); e2e mocks map and asserts navigation | B12–B13 | Partial (style manual) |
| INV-UI-13 PM label and permanence | `project-manager.ts` | `project-manager.test.ts`; prompt snapshot | A7 | Automated |
| INV-UI-14 new project requires building | `project-manager.tsx`, `client-space-action` | `project-manager.test.tsx` (Finish setup choice), client-space tests | A3–A4 | Partial |
| Intake receipt survives | `background-job-handlers.ts` | `background-job-handlers.test.ts` (receipt fields, replay, notify failure); `threads.test.ts` | D1–D3 | Automated |
| Intake corrections visible | `mcp_pilot.py` `get_intake` | agentic MCP tests (saved + readiness, bounds, foreign owner) | D5–D8 | Automated (agent side); PM UX manual |

## Known gaps to exercise manually

- Visual basemap style, typography, focus order, and narrow-layout behaviour.
- Real provider/parser timing and partial-file failures.
- Cross-repo staging with a real QSight instance (tests use mocks/synthetic fixtures).
- PM credential scope: a pre-`read+scaffold` manager cannot correct; use a manager
  created after that change (see checklist prerequisites).
- Trusted publication card is not built; publication remains in QSight.
