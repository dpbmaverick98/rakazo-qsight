import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildPublishReceipt,
  canonicalJson,
  privateKeyFromEnv,
  signPublishReceipt,
  verifyPublishReceipt,
} from "./publish-receipt.js";

const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const env = {
  iss: "fork-test",
  aud: "product-test",
  kid: "test-key",
  nowSeconds: 1000,
  jti: "00000000-0000-4000-8000-000000000001",
  operationId: "00000000-0000-4000-8000-000000000002",
};
const input = {
  snapshot: { context_fingerprint: "a".repeat(64), v: 1, review: { z: null, a: [true, 2] } },
  actor: {
    subject: "user",
    spaceId: "space",
    membershipIncarnation: "membership",
    policy: "owner-v1" as const,
    delegationId: "delegation",
  },
  binding: {
    id: "binding",
    revision: 1,
    clientId: "client",
    buildingId: "building",
    projectId: "project",
  },
  threadId: "thread",
  botId: "bot",
  intakeId: "intake",
  intakeRevision: 1,
  reviewRevision: 0,
};
const expected = { ...env, action: "intake.publish" };
const built = buildPublishReceipt(input, env);
const receipt = signPublishReceipt(built.payload, privateKey, env.kid);

function failsSafely(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toContain(privateKey);
    expect(message).not.toContain(receipt);
    expect(message).not.toContain("BEGIN PRIVATE KEY");
    return;
  }
  throw new Error("Expected rejection");
}

describe("publish receipt", () => {
  it("signs a verifiable Ed25519 receipt with the snapshot digest and 120 second lifetime", () => {
    expect(verifyPublishReceipt(receipt, publicKey, expected)).toEqual(built.payload);
    const [header, payload, signature] = receipt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "EdDSA",
      kid: env.kid,
      typ: "rakazo-publish+jws",
    });
    expect(
      verify(
        null,
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    expect(built.payloadSha256).toBe(
      createHash("sha256").update(built.canonicalSnapshot).digest("hex"),
    );
    expect(built.payload.payload_sha256).toBe(built.payloadSha256);
    expect(built.payload.exp).toBe(built.payload.iat + 120);
    const generated = buildPublishReceipt(input, {
      ...env,
      jti: undefined,
      operationId: undefined,
    });
    expect(generated.payload.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.payload.operation_id).not.toBe(generated.payload.jti);
  });

  it("canonicalizes nested values, arrays and UTF-16 key ordering deterministically", () => {
    expect(canonicalJson({ z: { b: 2, a: 1 }, a: [null, false, "a\n"] })).toBe(
      '{"a":[null,false,"a\\n"],"z":{"a":1,"b":2}}',
    );
    expect(canonicalJson({ "\ue000": 1, "😀": 2 })).toBe('{"😀":2,"":1}');
    expect(canonicalJson(input.snapshot)).toBe(
      canonicalJson({
        review: { a: [true, 2], z: null },
        v: 1,
        context_fingerprint: "a".repeat(64),
      }),
    );
  });

  it("rejects unsupported JSON values and bounded profile violations", () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    let deep: unknown = null;
    for (let i = 0; i < 33; i++) deep = { child: deep };
    for (const value of [
      1.5,
      NaN,
      Infinity,
      undefined,
      { a: undefined },
      () => 0,
      Symbol(),
      1n,
      cycle,
      deep,
      "a".repeat(2001),
      new Date(),
      Array(1),
      { [Symbol()]: 1 },
    ]) {
      expect(() => canonicalJson(value)).toThrow("Invalid publish receipt");
    }
    expect(() => canonicalJson({ ["a".repeat(2001)]: 1 })).toThrow();
    expect(canonicalJson("a".repeat(2000))).toHaveLength(2002);
  });

  it("rejects tampering, wrong expectations, expiry and malformed claims without disclosing secrets", () => {
    const parts = receipt.split(".");
    const changed = Buffer.from(canonicalJson({ ...built.payload, intake_id: "other" })).toString(
      "base64url",
    );
    failsSafely(() =>
      verifyPublishReceipt(`${parts[0]}.${changed}.${parts[2]}`, publicKey, expected),
    );
    failsSafely(() =>
      verifyPublishReceipt(
        `${parts[0]}.${parts[1]}.${Buffer.alloc(64).toString("base64url")}`,
        publicKey,
        expected,
      ),
    );
    for (const overrides of [
      { aud: "other" },
      { iss: "other" },
      { kid: "other" },
      { action: "other" },
      { nowSeconds: 1120 },
      { nowSeconds: 900 },
    ]) {
      failsSafely(() => verifyPublishReceipt(receipt, publicKey, { ...expected, ...overrides }));
    }
    failsSafely(() => signPublishReceipt({ ...built.payload, exp: 1121 }, privateKey, env.kid));
    failsSafely(() => signPublishReceipt(built.payload, "bad key", env.kid));
    failsSafely(() => verifyPublishReceipt(receipt, "invalid public key", expected));
    failsSafely(() => buildPublishReceipt(input, { ...env, jti: "bad" }));
    // Duplicate keys are lost by JSON.parse; canonical-wire comparison rejects them.
    const duplicate = Buffer.from(
      '{"alg":"EdDSA","alg":"EdDSA","kid":"test-key","typ":"rakazo-publish+jws"}',
    ).toString("base64url");
    failsSafely(() =>
      verifyPublishReceipt(`${duplicate}.${parts[1]}.${parts[2]}`, publicKey, expected),
    );
  });

  it("reads complete PKCS8 configuration and sanitizes malformed keys", () => {
    const configuration = {
      RAKAZO_PUBLISH_RECEIPT_PRIVATE_KEY_PKCS8: privateKey,
      RAKAZO_PUBLISH_RECEIPT_KID: env.kid,
      RAKAZO_PUBLISH_RECEIPT_ISS: env.iss,
      RAKAZO_PUBLISH_RECEIPT_AUD: env.aud,
    };
    expect(privateKeyFromEnv({})).toBeNull();
    for (const name of Object.keys(configuration))
      expect(privateKeyFromEnv({ ...configuration, [name]: "" })).toBeNull();
    expect(privateKeyFromEnv(configuration)).toEqual({
      privateKeyPkcs8Pem: privateKey,
      kid: env.kid,
      iss: env.iss,
      aud: env.aud,
    });
    for (const key of [
      "not a key",
      "-----BEGIN PRIVATE KEY-----\nmalformed\n-----END PRIVATE KEY-----",
      publicKey,
    ]) {
      failsSafely(() =>
        privateKeyFromEnv({ ...configuration, RAKAZO_PUBLISH_RECEIPT_PRIVATE_KEY_PKCS8: key }),
      );
    }
  });
});
