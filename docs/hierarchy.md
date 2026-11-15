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

## Scoped commercial panel

Selecting a project now opens a read-only commercial view in the same right
region, with the hierarchy retained above it and Back to hierarchy restoring
focus to the project button. Web and Electron share this UI; native Expo remains
outside this pilot. No chat messages, model calls, writes or commercial totals
are introduced.

`GET /api/agent-plane/projects/:id/commercial` uses the same authenticated
session, membership selection and configured non-Personal space binding as the
hierarchy. Before every commercial read (including cache hits), the project ID
must appear in the configured client's hierarchy. All members of this configured
space must be permitted to read all its mapped projects; mixed readership is not
supported. The hierarchy's existing 15-second cache also bounds mapping freshness.

The adapter calls only `GET /api/v2/agent/projects/{encoded-id}/commercial` with
the existing server bearer, redirects disabled and a five-second deadline. It
validates at most 256,000 decoded bytes against
`packages/contracts/src/project-commercial.ts`, strips unknown fields, verifies
the returned project ID and generates project/package links from the configured
origin and canonical IDs. Those link routes still require upstream confirmation.
Successes are cached for 15 seconds in a bounded 100-project process-local cache;
HTTP responses are always no-store. Errors are generic and never cached.

The v1 consumer contract follows the endpoint shape supplied for this feature:
`project: {id, name, currency, url}` and
`claims: [{id, name, sub_vendors: [{id, name, work_packages: [...]}]}]`.
Packages require `id`, `title`, `status`, `document_count`, `document_state`,
`proposed`, `breakdown`, `invoiced`, `remaining`, `position`, `issues_open`,
`coverage_incomplete` and `url`. Amounts are finite JSON numbers or plain decimal
strings, or null. Position is neutral upstream text or null; issue counts and
coverage may also be null. Currency is an uppercase three-letter code or null.
The synthetic fixture is exported as `@rakazo/contracts/project-commercial-fixture`.

The consumer displays canonical amounts verbatim (preserving decimal strings),
never sums or derives balances, and renders unavailable amounts as an accessible
em dash. Issue counts and incomplete/unavailable checks are independent. It does
not implement the design proposal's different paginated `groups`/qualified-money
contract, snapshots, document metadata links, URL history, expanded tables or
per-project permissions. Oversized responses fail explicitly rather than silently
truncating the project. The current endpoint needs to supply a complete bounded
response; pagination requires a separately agreed upstream contract.

Selection is scoped to account and space, and only the selected project is read.
Queries cancel on unmount/switch, use separate account/space/project keys, discard
unused cache immediately, and hide figures during refresh or failure. Reads occur
on entry, focus, retry and the existing roster stream signals, with no polling or
offline persistence. Upstream-only changes still have no push bridge.

Live wiring requires the QSight commercial endpoint PR to be merged with this
shape and the deep-link routes confirmed. No live endpoint, real credentials,
financial parity against live projections or upstream authorization was exercised;
consumer checks use synthetic mocked responses only.

Local verification for the commercial extension passed the focused proxy/adapter/
panel tests, full web unit suite, API/web/E2E TypeScript checks, Biome, repository
checks and the web production build. The existing build emits catalog extraction
and chunk-size warnings. No translation catalogs were changed. Dependency install
used the lockfile and the documented engine override for the available runtime.
Inspected synthetic captures at 1500×1000 and 390×844 are in
`docs/screenshots/commercial/`; these use the real rail and resizable region in a
temporary isolated preview, not an authenticated full-stack shell. Back restores
project-button focus; the narrow capture had no horizontal document overflow.
The full-stack E2E spec now captures the commercial panel on wide/narrow screens;
its execution and Electron E2E remain with CI. Native mobile and screen-reader
speech were not exercised.
