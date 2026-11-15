import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const json = (file) => JSON.parse(read(file));

test("display branding preserves application compatibility identifiers", () => {
  const desktop = json("apps/desktop/package.json");
  assert.equal(desktop.productName, "Vendor One Management");
  assert.equal(desktop.name, "@rakazo/desktop");
  assert.equal(desktop.build.appId, "dev.rakazo.desktop");
  assert.equal(desktop.build.extraMetadata.name, "rakazo");
  const { expo } = json("apps/mobile/app.json");
  assert.equal(expo.name, "Vendor One Management");
  assert.equal(expo.scheme, "rakazo");
  assert.equal(expo.ios.bundleIdentifier, "com.rakazo.app");
  assert.equal(expo.android.package, "com.rakazo.app");
  assert.match(read("apps/web/index.html"), /<title>Vendor One Management<\/title>/);
  assert.match(read("apps/web/src/pwa/plugin.ts"), /name: "Vendor One Management"/);
  assert.match(read("apps/web/src/pwa/plugin.ts"), /short_name: "Vendor One Management"/);
});
