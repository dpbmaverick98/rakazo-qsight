# Client hierarchy pilot

The optional hierarchy source is configured on the API server only. Set
`QSIGHT_BASE_URL` to the upstream HTTP(S) origin, `QSIGHT_AGENT_TOKEN` to the
agent credential. Missing base/token settings disable the feature. The API resolves
the authenticated, non-Personal Space's explicit `SpaceClientBinding` and requests
`GET /api/v2/agent/hierarchy?client_id=...`. The returned canonical client ID must
match. Space names are display data; renaming never changes authority. There is
no read fallback, environment client selection, or automatic name backfill.
Keep credentials out of frontend build variables.

All members can read their bound hierarchy and commercial data. Only current
Space owners/admins can bind, unbind, create projects or provision PMs. Deployment
ownership alone grants no bypass. Reads recheck membership, lifecycle and binding
revision after the upstream response; commercial reads additionally verify project
ancestry. Personal is never bindable. An external ID can belong to only one Space
in this deployment's single configured hierarchy connection (including inactive
bindings). Multiple hierarchy connections are outside this slice.

`GET /api/agent-plane/hierarchy` uses the existing session and
`x-rakazo-space-id` membership selection. Successful responses retain the existing
hierarchy DTO and include `x-rakazo-binding-revision`. All hierarchy/commercial/
project endpoints accept that revision header to reject stale selections. PM RPC
accepts optional `bindingRevision`; browser-provided names remain compatibility
inputs and never grant authority.

Failures return `{status}`: `forbidden` (403), `personal`, `binding_missing`,
`binding_stale`, `space_unavailable` (409), `binding_mismatch` or
`upstream_unavailable` (502), `disabled` (503). Missing sessions return 401.
Unknown projects/buildings remain 404. Requests have five-second upstream deadlines,
no redirects, and `Cache-Control: no-store`. Hierarchy reads bypass the bounded
15-second adapter cache. No additional client polling is introduced.

### Explicit pilot binding / backfill

There is no automatic backfill or privileged unauthenticated CLI. A Space owner
or admin uses the same session-authorized HTTP command for each reviewed Space:

1. Select the target using `x-rakazo-space-id: <space-id>`.
2. `GET /api/agent-plane/client-binding` returns `{status, revision}` and, when
   bound, `externalClientId` and the verified `clientName` snapshot. An existing
   unbound Space starts at revision zero.
3. `POST /api/agent-plane/client-binding`, JSON
   `{"revision":0,"externalClientId":"<known-external-client-id>"}`, verifies that
   exact ID through the configured upstream credential before committing. Do not
   substitute a Space name or guess an ID. A supplied display name is rejected.
4. To unbind, POST `{"revision":<current-revision>}`. To bind again, first unbind,
   then POST the new ID with the resulting revision. There is no in-place rebind.

Writes use the trusted-origin check, recheck permission/lifecycle under the Space
row lock and atomically record `space.client.bound` / `space.client.unbound` audit
events. Success returns `{status, revision}` and publishes the existing Space
roster signal. A stale revision or active binding returns 409 (`binding_stale` or
`binding_exists`). Unbinding retains an inactive tombstone and advances revision;
old requests cannot become current after a later bind. External-ID conflicts return 409 `binding_conflict` from the
database uniqueness guard; no existing binding is reassigned implicitly.

Bindings cannot change while any `pm:` bot (including archived bots) or `pm-`
connection remains in the Space: 409 `project_managers_exist`. Remove/reconcile
those resources explicitly first; unbind never revokes upstream tokens or deletes
external clients/projects. Credential revocation/reconciliation and structured PM
assignment/promotion are later phases. The admin must confirm that all invited
Space members are authorized for the selected external client; the integration
credential's upstream authorization defines the available IDs.

### Safe rollout and previous-release compatibility

The migration only adds a new table, unique indexes and a cascading Space foreign
key; old Space create/update/delete statements remain valid. It neither renames
existing tables nor populates bindings. The previous release does not understand
the binding and continues name-based access, so **disable the hierarchy integration
on all old API instances before rollout; drain/stop old API and worker processes
before enabling it and binding any Space**. Keep it disabled if rolling back to
old code. This is a required operational gate, not automatic mixed-version safety.
Existing scoped PM credentials also need explicit operator review; adding a binding
does not convert or revoke legacy connections. No deploy/backfill is performed by
this PR. Until explicitly bound, old Spaces fail closed as `binding_missing`.

The upstream ID-read, commercial, project-create and manager-token contracts are
covered with synthetic offline adapter fixtures. Client/building creation,
verification and idempotent operation lookup remain unverified and are not added.
The binding workflow makes no external writes. Web/Electron use the shared server
boundary; mobile can call the same endpoints but gains no new setup UI in Phase 1.

Nullable building latitude/longitude are accepted; missing, non-numeric, non-finite
or out-of-range upstream coordinates become null. Coordinates are never inferred.

Buildings with both coordinates appear on a compact, lazy-loaded Leaflet map above
the list in web and Electron. Selecting a pin expands its building, scrolls it into
view and focuses its list control. Pins also support keyboard activation, and the
list remains available when tiles cannot load. The map is omitted when no building
has a complete coordinate pair. The reserved card height is 160px in narrow rails
and 192px in wider rails, including while the lazy bundle loads.

Tiles load directly from `https://tile.openstreetmap.org` with visible attribution;
this discloses the viewed tile area to the public tile service. No API key,
geocoding or write requests are used. Existing CSP `img-src https:` already allows
tile images, so neither host wildcards nor new script/connect sources are needed.
The public tile service requires network access and follows its usage policy;
there is no offline basemap or service availability guarantee. Native Expo
navigation remains unchanged; this map is a web/Electron enhancement.

Project links currently use the upstream origin plus `/projects/<encoded-id>`.
Confirm that route with the upstream app before enabling the pilot. Each Space binds by its verified external ID. The navigation reads do not write upstream. Project-manager provisioning is described below.

The web/Electron Shell shares one resizable right region between the hierarchy
and existing details. On narrow screens the hierarchy starts behind its button;
Hide restores the chat. Personal and unconfigured spaces have no hierarchy rail.
Archive remains the existing chat-history view and gains no hierarchy actions.
Full-screen Pages/computer views may cover the region. Native Expo navigation is
unchanged in this web pilot; the server enforces the same immutable Space binding for callers.

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
was exercised. These navigation checks do not make upstream writes.

## Scoped commercial panel

Selecting a project now opens a read-only commercial view in the same right
region, with the hierarchy retained above it and Back to hierarchy restoring
focus to the project button. Web and Electron share this UI; native Expo remains
outside this pilot. No chat messages, model calls, writes or commercial totals
are introduced.

`GET /api/agent-plane/projects/:id/commercial` uses the same authenticated
session, membership selection and non-Personal immutable Space binding as the
hierarchy. Before every commercial read (including cache hits), the project ID
must appear in the bound client's hierarchy. All members of this bound
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

Live wiring requires the Vendor One commercial endpoint PR to be merged with this
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

## Automatic scoped project managers

Web and Electron use `mcp.servers.provisionProjectManager`, available at
`POST /rpc/mcp/servers/provisionProjectManager`, with
`{ projectId, projectName, clientName }`. It requires the existing signed-in session
and `x-rakazo-space-id` membership selection. The non-Personal immutable Space
binding and client hierarchy are checked before minting. Canonical names from the
hierarchy replace browser-supplied names. The response is `{ bot, server, created }`;
`created` means this request created the bot. Neither bearer nor ciphertext appears
in the response.

The hierarchy adapter calls `POST /api/v2/agent/projects/{encoded-id}/manager-token`
with `Authorization: Bearer <QSIGHT_AGENT_TOKEN>`, no request body, no redirects,
a five-second deadline, and a 32,000-byte response limit. The expected JSON response
is `{ "token": "<project-scoped-read-only-bearer>" }`; other upstream fields are
ignored. Read-only project scoping is enforced by the upstream issuer, not inferred
from the token text. `QSIGHT_AGENT_TOKEN` must have the upstream owner's write
permission. `QSIGHT_MCP_ENDPOINT` optionally overrides the default
`${QSIGHT_BASE_URL}/mcp`. Existing MCP endpoint and private-network security checks
still apply; a local endpoint needs the deployment's standard private-endpoint
opt-in. No provider-specific browser settings are introduced.

`prepareMcpServer` validates the endpoint and encrypts the bearer; `insertMcpServer`
creates a `streamable_http` server named `Vendor One PM — {projectName}` (120 characters
maximum), scoped to the current space with `allBots: false`. A project-ID-derived
SHA-256 slug keeps identity stable when names change. A matching legacy name can
be adopted; projects sharing a display name keep separate slugs. A server shared
with every bot or space is rejected. Reuse refreshes the credential, so a same-named owner credential
cannot survive. No new server or bot IDs are created on repeated successful calls.

The PM uses `spawnKey: pm:{projectId}` and an 80-character name. The bot-creation
transaction's existing `seed` hook commits the bot, secret, server and sole
`botMcpServer` assignment together. An existing PM is repaired in a transaction;
previous assignments are replaced, including any owner-level server. The additive
`bots.inheritMcpServers` setting defaults to true for existing bots and is set false
for PMs. MCP discovery and execution both honor it, preventing implicit access to
all-agent servers. Failed persistence rolls back product records and uses the
existing prepared-secret cleanup. An already-issued upstream token cannot be
revoked on database failure because no revocation API was supplied.

Limits: upstream canonical IDs must be stable; API hierarchy reads always bypass the adapter cache; provisioning an existing bot owned by another member fails
safely rather than replacing that member's credentials. Each provisioning request
mints a scoped token, including retries and reuse. There is no token-refresh timer
or automatic run. Deploy the migration and updated API/worker code together;
already-running old workers do not learn the new inheritance setting. Native Expo
has no hierarchy panel; the authenticated RPC is shared and available to it.

Offline tests cover minting, safe responses, endpoint validation, resource reuse,
transaction rollback, assignment repair, inherited-server denial and web success
and retry. The hierarchy E2E spec checks the unconfigured failure without leaving
a PM behind; CI owns full web/Electron E2E. Local visual checks use the real
commercial panel with synthetic data; captures are in `docs/screenshots/hierarchy/`.
No live token issuer was exercised. The binding migration is verified against disposable PostgreSQL.

## Creating projects

The web/Electron rail opens an inline name form under an expanded building.
`POST /api/agent-plane/projects` accepts `{buildingId, name}` with the selected
Space header and an authenticated session. Only a current Space owner/admin
can create; Personal and unbound Spaces cannot. The API verifies building
membership against a fresh hierarchy, rejects blank or duplicate names, and
calls the server adapter. The adapter posts `{name}` to
`/api/v2/agent/buildings/{building_id}/projects` using the existing server token,
with a five-second deadline, bounded response validation and no redirects.
The configured credential must have owner-level write access upstream.

Successful creation invalidates the adapter cache, signals the Space through the
existing live stream and refreshes the rail. Conflicts stay in the form for
correction. There is no automatic write retry: a timeout or malformed response
can happen after the upstream committed, so check the refreshed hierarchy before
retrying. Concurrent duplicate creation ultimately depends on the upstream
returning 409; the local name check alone cannot enforce uniqueness.

Space display names never select authority. Binding changes require the explicit
reviewed command above.

New client Spaces name their first bot `PM`, with instructions scoped to the client.
Project bots remain `PM — {projectName}` (80 characters maximum); MCP server names
remain capped at 120 characters including the `Vendor One PM — ` prefix. Existing
bots are not renamed here; that is deferred to a migration. Personal onboarding
keeps its existing name. Internal identifiers and `QSIGHT_*` configuration stay unchanged.
