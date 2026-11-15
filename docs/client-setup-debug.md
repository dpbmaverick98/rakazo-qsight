# Client workspace debug logging

Start the API locally with metadata logging enabled:

```sh
CLIENT_SETUP_DEBUG=1 pnpm --filter @rakazo/api dev
```

These events use the existing structured logger at `info`, so its default threshold works.
`CLIENT_SETUP_DEBUG` must be exactly `1`; unset it to disable the extra events. Existing
normal HTTP completion/error logging is unchanged. A logger threshold above `info` suppresses
the debug events too. Enable the same variable on a worker if it executes MCP calls.

Open the web app with `?debug=1`, or run this in its browser console and retry the action:

```js
localStorage.setItem("rakazo:client-setup-debug", "1");
// Disable persisted debugging:
localStorage.removeItem("rakazo:client-setup-debug");
```

Remove `debug=1` from the URL as well to disable both switches. Enable the browser's Debug/Verbose
console level to see `console.debug` events. Web and Electron's hosted web UI share this logger.
Mobile continues to use the same correlated API; it has no new browser-console switch.

## Correlation

The existing HTTP middleware accepts a validated `x-request-id` (1–128 characters,
letters/digits/underscore/dot/colon/hyphen), generates one for absent/invalid values, and returns
it with `traceparent`. Web setup writes send correlation headers even with debugging off.
The hierarchy adapter preserves the validated request ID and forwards a child-span `traceparent`.
MCP HTTP requests do the same on the configured resource origin only; discovery on another origin
does not receive these headers. No authentication material is added to correlation headers.

Filter API logs by `request.id` or `trace.id`; upstream records also carry the outgoing `requestId`.
Use the browser's Network response headers to match an action to its API request. Background agent
runs can have a different request ID; use the trace and bot/server IDs available in their context.
A separate action or retry gets a new request ID. This does not add a durable workflow trace.

## Event names

All server events have the `client_setup.` prefix:

| Suffix | Meaning |
| --- | --- |
| `setup` | Whole Add client operation, including validation failures |
| `client.lookup` | External exact-name lookup, including recovery after create conflicts |
| `client.create` | External client creation attempt |
| `client.reuse` | Existing client selected |
| `space.resolve` | Space resolution timing, then the committed `created`/`reused` result |
| `binding` | Membership and canonical client-binding validation |
| `setup_pm` | Setup PM creation/reuse timing, then its ID and outcome |
| `mcp.attach` | Attachment transaction timing, then server ID or `missing` outcome |
| `promotion` | PM provisioning timing/error, and a committed bot/server snapshot |
| `token.revoke` | Cleanup of an unused minted credential, including retry duration |
| `upstream` | HTTP transport result; `operation` identifies the call |
| `mcp.selected` | Bot/tool server selection with server ID/name and `assigned`/`inherited` source |

Upstream operations are `client.lookup`, `client.create`, `location.search`, `location.proof`,
`building.create`, `project.create`, `token.create`, `token.revoke`, `hierarchy.read`,
`commercial.read`, and `mcp.request`. A malformed credential's cleanup appears as upstream
`token.revoke` as well. MCP selection is authorization lookup, not proof of successful execution.

Browser event names are `client_setup.add_client`, `client_setup.finish_setup`,
`client_setup.add_building`, `client_setup.add_project`, and `client_setup.location`.
They record `started`, HTTP completion/error, and parsed result IDs. PM provisioning uses
`finish_setup` for both the Finish setup and Create project manager controls.

## Fields and limits

Server records allow only actor/space/client/bot/server IDs, server name, tool name, operation,
status, duration in milliseconds, HTTP status, safe error code, and outgoing request ID, plus the
existing logger's correlation context. IDs appear as they become available. Result snapshots
have duration zero; the corresponding timing record measures the operation. Upstream timing
ends when HTTP headers arrive; schema validation and body reading are covered by enclosing setup
stages where present. HTTP success alone does not establish a valid upstream response.

Browser records allow only request/space/client/bot/server/building/project IDs, HTTP status,
status, duration, and safe error code. Error replies expose only known structured status codes;
debug error-body inspection is bounded to 4 KiB and one second; unknown replies fall back to `http_<status>`, transport failures to `transport_failed`.
Server errors expose recognized RPC codes or `operation_failed`; raw exception messages are excluded.
All extra string fields are truncated to 128 characters. Server logging also applies the existing
central redaction. Client/building/project payload fields, URLs, request arguments, tokens,
credential IDs, authorization headers, document text, and raw upstream responses are never added.
Server names are the intentional human-readable selection label and may include a project label; avoid placing secrets in names.

No sampling, persistent browser log storage, new telemetry destination, or provider-specific settings
are introduced. Events can be numerous during MCP initialization, so enable them only for a local
reproduction. Cached hierarchy/commercial reads do not issue upstream events. The server toggle
and browser toggle are independent.

## Offline checks

```sh
pnpm exec vitest run packages/logging/src/client-setup-debug.test.ts packages/logging/src/hono.test.ts apps/api/src/client-setup-debug.test.ts apps/api/src/project-manager.test.ts packages/adapters/src/qsight-hierarchy.test.ts packages/adapters/src/mcp-connector.test.ts packages/adapters/src/mcp-transport.test.ts apps/web/src/lib/client-setup-debug.test.ts apps/web/src/pages/shell/add-client-dialog.test.tsx apps/web/src/pages/shell/project-manager.test.tsx
pnpm checks
```

These tests use fake credentials and upstream responses. Transport tests need permission to bind a
loopback HTTP server. No live upstream account is needed. PostgreSQL setup tests remain opt-in through
the existing database test configuration.
