import { afterEach, expect, it, vi } from "vitest";
import { clientSetupDebug, clientSetupFetch } from "./client-setup-debug";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function browser(search = "", stored: string | null = null) {
  vi.stubGlobal("window", { location: { search }, localStorage: { getItem: () => stored } });
}
it("is silent by default, enabled by query or storage, and filters private fields", () => {
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  browser();
  clientSetupDebug("add_client", { status: "ok" });
  expect(debug).not.toHaveBeenCalled();
  for (const [search, stored] of [
    ["?debug=1", null],
    ["", "1"],
  ]) {
    browser(search!, stored);
    clientSetupDebug("add_client", {
      clientId: "client",
      token: "secret",
      body: "document",
      error: new Error("secret"),
    });
  }
  expect(debug).toHaveBeenCalledTimes(2);
  expect(debug.mock.calls[0]).toEqual(["client_setup.add_client", { clientId: "client" }]);
});
it("correlates requests and records status without consuming response bodies", async () => {
  browser("?debug=1");
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { token: "private" },
        { status: 409, headers: { "x-request-id": "request-returned" } },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const response = await clientSetupFetch("add_project", "/api/agent-plane/projects", {
    method: "POST",
    headers: { "x-rakazo-space-id": "space" },
    body: "private request",
  });
  expect(new Headers(fetch.mock.calls[0]![1].headers).get("x-request-id")).toBeTruthy();
  expect(debug.mock.calls[1]).toEqual([
    "client_setup.add_project",
    expect.objectContaining({
      requestId: "request-returned",
      httpStatus: 409,
      errorCode: "http_409",
      spaceId: "space",
    }),
  ]);
  expect(response.bodyUsed).toBe(false);
  expect(JSON.stringify(debug.mock.calls)).not.toContain("private");
});
it("handles storage denial and transport errors without logging their messages", async () => {
  vi.stubGlobal("window", {
    location: { search: "?debug=1" },
    localStorage: {
      getItem: () => {
        throw new Error("denied");
      },
    },
  });
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private URL")));
  await expect(clientSetupFetch("add_building", "/local", {})).rejects.toThrow();
  expect(JSON.stringify(debug.mock.calls)).not.toContain("private URL");
  expect(debug.mock.calls.at(-1)).toEqual([
    "client_setup.add_building",
    expect.objectContaining({ errorCode: "transport_failed" }),
  ]);
});

it("logs only recognized returned error codes", async () => {
  browser("?debug=1");
  const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ status: "binding_stale", token: "private" }, { status: 409 }),
    )
    .mockResolvedValueOnce(Response.json({ status: "private-document" }, { status: 502 }));
  vi.stubGlobal("fetch", fetch);
  await clientSetupFetch("add_client", "/local", {});
  expect(debug.mock.calls.at(-1)).toEqual([
    "client_setup.add_client",
    expect.objectContaining({ errorCode: "binding_stale" }),
  ]);
  await clientSetupFetch("add_client", "/local", {});
  expect(debug.mock.calls.at(-1)).toEqual([
    "client_setup.add_client",
    expect.objectContaining({ errorCode: "http_502" }),
  ]);
  expect(JSON.stringify(debug.mock.calls)).not.toContain("private");
});
