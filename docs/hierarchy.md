# Read-only client hierarchy pilot

The optional hierarchy source is configured on the API server only. Set
`QSIGHT_BASE_URL` to the upstream HTTP(S) origin, `QSIGHT_AGENT_TOKEN` to the
agent credential, `QSIGHT_CLIENT_ID` to the client ID, and `QSIGHT_SPACE_ID` to
one existing, non-Personal Rakazo space ID. Missing settings disable the feature.
The explicit space binding is required: membership in another space never grants
access to this client's hierarchy. Keep credentials out of frontend build variables.

`GET /api/agent-plane/hierarchy` uses the existing Rakazo session and
`x-rakazo-space-id` membership selection. It returns 204 when disabled or outside
the bound space, 401 without a session, and a generic 502 when the upstream fails.
The adapter calls only `GET /api/v2/agent/hierarchy?client_id=...`, with a five-second
deadline and no redirects. Successful validated responses are cached in process
for 15 seconds; downstream responses use `Cache-Control: no-store`. Optional
upstream fields (including address and nickname) are omitted from the browser DTO.

Project links currently use the upstream origin plus `/projects/<encoded-id>`.
Confirm that route with the upstream app before enabling the pilot. This is one
client binding per deployment, not a multi-client mapping system. There are no
writes, manager spawning, schema changes, or hierarchy-based authorization rules.

The web/Electron Shell shares one resizable right region between the hierarchy
and existing details. On narrow screens the hierarchy starts behind its button;
Hide restores the chat. Personal and unconfigured spaces have no hierarchy rail.
Archive remains the existing chat-history view and gains no hierarchy actions.
Full-screen Pages/computer views may cover the region. Native Expo navigation is
unchanged in this web pilot; the server enforces the same space binding for callers.

The hierarchy reads on entry, window focus, manual retry and existing roster
stream signals (including reconnect). There is no polling. Upstream-only changes
have no push bridge in this slice and become visible on the next such read.

Validation commands (from the repository root):

```sh
pnpm exec vitest run apps/api/src/hierarchy.test.ts packages/adapters/src/qsight-hierarchy.test.ts apps/web/src/pages/shell/hierarchy-rail.test.tsx
pnpm --filter @rakazo/web test
pnpm --filter @rakazo/api check
pnpm --filter @rakazo/web check
pnpm --filter @rakazo/web build
pnpm exec biome check apps/api/src/hierarchy* packages/adapters/src/qsight-hierarchy* packages/contracts/src/hierarchy.ts apps/web/src/pages/shell/hierarchy-rail* apps/web/e2e/hierarchy.spec.ts
pnpm checks
```

The web E2E spec uses request interception with synthetic navigation data and the
existing screenshot helper. Full web and Electron E2E runs are left to CI.

Local validation completed with the nine new isolated tests, the existing web
unit suite (241 files, 2,318 tests), API/web/E2E TypeScript checks, Biome, the 51
repository checks, and the web production build. Prisma client generation was
required before typechecking; no database or migration was run.

The local machine has Node 25 and pnpm 11, while the repository requests Node
24.15+ or 26+ and pnpm 12. Installation/build/check commands used
`pnpm --pm-on-fail=ignore --config.engine-strict=false` as the command prefix.
Tests and typechecks were also run directly through `node_modules/.bin/vitest`
and `node_modules/.bin/tsc`. The full web unit run required loopback access for
existing proxy tests; the restricted run timed out on those tests. The successful
command was `node_modules/.bin/vitest run apps/web/src --maxWorkers=4`.

Rendered component checks used an uncommitted temporary preview with the real
hierarchy and resizable panel components, synthetic data, and Playwright at
1500×1000 and 390×844. Inspected captures are in `docs/screenshots/hierarchy/`;
they show an isolated composition, not an authenticated full-stack Shell.
The full-stack CI spec also covers coexistence with actual chat details. No
upstream service, production credentials, native mobile, or live project target
was exercised. No creation or write requests to the external service exist.
