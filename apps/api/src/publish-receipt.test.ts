import { generateKeyPairSync, sign, verify } from "node:crypto";
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
    expect(built.canonicalSnapshot).toBe(
      '{"context_fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","review":{"a":[true,2],"z":null},"v":1}',
    );
    // Independently hashed from the literal snapshot with Python hashlib.sha256.
    expect(built.payloadSha256).toBe(
      "d687133c9f824060b049bdd1d34a1d74ee5a1c52257f7027f2d32a8438835e53",
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
  });

  it("pins literal escaping and rejects lone surrogates in keys and values", () => {
    expect(canonicalJson('\u0000\b\t\n\f\r\u001f"\\/\u2028\u2029😀')).toBe(
      '"\\u0000\\b\\t\\n\\f\\r\\u001f\\"\\\\/\u2028\u2029😀"',
    );
    for (const value of ["\ud800", "\udfff"]) {
      expect(() => canonicalJson(value)).toThrow();
      expect(() => canonicalJson({ [value]: 1 })).toThrow();
    }
  });

  it("enforces exact integer, depth and UTF-16 length boundaries", () => {
    for (const value of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])
      expect(canonicalJson(value)).toBe(String(value));
    for (const value of [Number.MIN_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER + 1])
      expect(() => canonicalJson(value)).toThrow();
    expect(canonicalJson(-0)).toBe("0");
    let deep: unknown = null;
    for (let i = 0; i < 32; i++) deep = [deep];
    expect(() => canonicalJson(deep)).not.toThrow();
    expect(() => canonicalJson([deep])).toThrow();
    const boundary = "😀".repeat(1000);
    expect(canonicalJson(boundary)).toBe(`"${boundary}"`);
    expect(canonicalJson({ [boundary]: 1 })).toBe(`{"${boundary}":1}`);
    expect(() => canonicalJson(`${boundary}a`)).toThrow();
    expect(() => canonicalJson({ [`${boundary}a`]: 1 })).toThrow();
  });

  it("rejects accessors, holes, extra properties and inherited iterators without invocation", () => {
    let calls = 0;
    const invoked = () => {
      calls++;
      throw new Error("User code invoked");
    };
    const getter = Object.defineProperty([1], "0", { get: invoked });
    const setter = Object.defineProperty([1], "0", { set: invoked });
    const hidden = Object.defineProperty([1], "extra", { value: 2 });
    const iterator = Object.defineProperty([1], Symbol.iterator, { get: invoked });
    const inherited = Object.setPrototypeOf([1], {
      [Symbol.iterator]: invoked,
    });
    const inheritedGetter = Object.setPrototypeOf(
      [1],
      Object.defineProperty({}, Symbol.iterator, { get: invoked }),
    );
    const hole = Object.setPrototypeOf(Array(1), Object.defineProperty({}, "0", { get: invoked }));
    for (const value of [
      getter,
      setter,
      hidden,
      iterator,
      inherited,
      inheritedGetter,
      hole,
      Object.assign([1], { extra: 2 }),
      Object.defineProperty({}, "value", { enumerable: true, get: invoked }),
    ])
      expect(() => canonicalJson(value)).toThrow("Invalid publish receipt");
    expect(calls).toBe(0);
    expect(canonicalJson(Object.defineProperty([1], "0", { enumerable: false }))).toBe("[1]");
  });

  it("requires the expected kid and rejects another kid signed by the same key", () => {
    const { kid: _kid, ...withoutKid } = expected;
    // @ts-expect-error Runtime callers must also supply the required kid.
    expect(() => verifyPublishReceipt(receipt, publicKey, withoutKid)).toThrow();
    expect(() => verifyPublishReceipt(receipt, publicKey, { ...expected, kid: "" })).toThrow();
    const other = signPublishReceipt(built.payload, privateKey, "other-key");
    expect(() => verifyPublishReceipt(other, publicKey, expected)).toThrow();
  });

  it("accepts uppercase UUID hex", () => {
    const uppercase = buildPublishReceipt(input, {
      ...env,
      jti: "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
      operationId: "FEDCBAFE-DCBA-4FED-8CBA-FEDCBAFEDCBA",
    });
    const signed = signPublishReceipt(uppercase.payload, privateKey, env.kid);
    expect(verifyPublishReceipt(signed, publicKey, expected)).toEqual(uppercase.payload);
  });

  it("rejects correctly signed duplicate keys and BOM-prefixed header and payload wires", () => {
    const [headerPart, payloadPart] = receipt.split(".") as [string, string];
    const header = Buffer.from(headerPart, "base64url").toString();
    const payload = Buffer.from(payloadPart, "base64url").toString();
    for (const [headerWire, payloadWire] of [
      [header.replace("{", '{"alg":"EdDSA",'), payload],
      [header, payload.replace("{", '{"v":1,')],
      [`\ufeff${header}`, payload],
      [header, `\ufeff${payload}`],
    ] as const) {
      const wire = [headerWire, payloadWire]
        .map((part) => Buffer.from(part).toString("base64url"))
        .join(".");
      const signature = sign(null, Buffer.from(wire), privateKey).toString("base64url");
      expect(() => verifyPublishReceipt(`${wire}.${signature}`, publicKey, expected)).toThrow();
    }
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
