import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from "node:crypto";

const invalid = () => new Error("Invalid publish receipt");

/** Repository receipt/snapshot profile, not general RFC 8785: safe integers only,
 * strings/keys <= 2000 UTF-16 units, container depth <= 32, plain JSON values.
 * Objects already have unique keys; wire JSON is checked against its canonical
 * encoding before use, rejecting duplicate keys (which JSON.parse would lose).
 */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(value: unknown, depth: number): string {
    if (value === null) return "null";
    if (typeof value === "string") {
      if (value.length > 2000 || Buffer.from(value, "utf8").toString("utf8") !== value)
        throw invalid();
      return JSON.stringify(value);
    }
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    if (typeof value !== "object" || depth >= 32 || ancestors.has(value)) throw invalid();
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw invalid();
    if (Object.getOwnPropertySymbols(value).length) throw invalid();
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length) throw invalid();
        return `[${Array.from(value, (item) => encode(item, depth + 1)).join(",")}]`;
      }
      return `{${Object.keys(value)
        .sort()
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || !("value" in descriptor)) throw invalid();
          return `${encode(key, depth + 1)}:${encode(descriptor.value, depth + 1)}`;
        })
        .join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }
  return encode(value, 0);
}

type Input = {
  snapshot: { context_fingerprint: string; [key: string]: unknown };
  actor: {
    subject: string;
    spaceId: string;
    membershipIncarnation: string;
    policy: "owner-v1" | "space-member-v1";
    delegationId: string;
  };
  binding: {
    id: string;
    revision: number;
    clientId: string;
    buildingId: string;
    projectId: string;
  };
  threadId: string;
  botId: string;
  intakeId: string;
  intakeRevision: number;
  reviewRevision: number;
};
type ReceiptEnv = {
  iss: string;
  aud: string;
  kid: string;
  nowSeconds: number;
  jti?: string;
  operationId?: string;
};

export function buildPublishReceipt(input: Input, env: ReceiptEnv) {
  const canonicalSnapshot = canonicalJson(input.snapshot);
  const payloadSha256 = createHash("sha256").update(canonicalSnapshot).digest("hex");
  const payload = {
    v: 1,
    iss: env.iss,
    aud: env.aud,
    action: "intake.publish",
    jti: env.jti ?? randomUUID(),
    operation_id: env.operationId ?? randomUUID(),
    iat: env.nowSeconds,
    exp: env.nowSeconds + 120,
    actor: {
      subject: input.actor.subject,
      space_id: input.actor.spaceId,
      membership_incarnation: input.actor.membershipIncarnation,
      policy: input.actor.policy,
      delegation_id: input.actor.delegationId,
    },
    binding: {
      id: input.binding.id,
      revision: input.binding.revision,
      client_id: input.binding.clientId,
      building_id: input.binding.buildingId,
      project_id: input.binding.projectId,
    },
    thread_id: input.threadId,
    bot_id: input.botId,
    intake_id: input.intakeId,
    intake_revision: input.intakeRevision,
    review_revision: input.reviewRevision,
    context_fingerprint: input.snapshot.context_fingerprint,
    payload_sha256: payloadSha256,
  };
  validatePayload(payload);
  return { payload, payloadSha256, canonicalSnapshot };
}
type Payload = ReturnType<typeof buildPublishReceipt>["payload"];

function validatePayload(payload: Payload) {
  const id = (value: unknown) =>
    typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 200;
  const integer = (value: number, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const hash = /^[0-9a-f]{64}$/;
  if (
    payload.v !== 1 ||
    payload.action !== "intake.publish" ||
    ![
      payload.iss,
      payload.aud,
      payload.thread_id,
      payload.bot_id,
      payload.intake_id,
      payload.actor.subject,
      payload.actor.space_id,
      payload.actor.membership_incarnation,
      payload.actor.delegation_id,
      payload.binding.id,
      payload.binding.client_id,
      payload.binding.building_id,
      payload.binding.project_id,
    ].every(id) ||
    !["owner-v1", "space-member-v1"].includes(payload.actor.policy) ||
    !uuid.test(payload.jti) ||
    !uuid.test(payload.operation_id) ||
    payload.jti === payload.operation_id ||
    !integer(payload.iat) ||
    !integer(payload.exp) ||
    payload.exp !== payload.iat + 120 ||
    !integer(payload.binding.revision) ||
    !integer(payload.intake_revision, 1) ||
    !integer(payload.review_revision) ||
    !hash.test(payload.context_fingerprint) ||
    !hash.test(payload.payload_sha256)
  )
    throw invalid();
  const keys = (object: object, expected: string) =>
    Object.keys(object).sort().join(",") === expected.split(",").sort().join(",");
  if (
    !keys(
      payload,
      "v,iss,aud,action,jti,operation_id,iat,exp,actor,binding,thread_id,bot_id,intake_id,intake_revision,review_revision,context_fingerprint,payload_sha256",
    ) ||
    !keys(payload.actor, "subject,space_id,membership_incarnation,policy,delegation_id") ||
    !keys(payload.binding, "id,revision,client_id,building_id,project_id")
  )
    throw invalid();
  canonicalJson(payload);
}

export function signPublishReceipt(
  payload: Payload,
  privateKeyPkcs8Pem: string,
  kid: string,
): string {
  try {
    validatePayload(payload);
    if (!kid || kid.length > 200) throw invalid();
    const key = createPrivateKey(privateKeyPkcs8Pem);
    if (key.asymmetricKeyType !== "ed25519") throw invalid();
    const header = { alg: "EdDSA", kid, typ: "rakazo-publish+jws" };
    const input = [header, payload]
      .map((value) => Buffer.from(canonicalJson(value)).toString("base64url"))
      .join(".");
    return `${input}.${sign(null, Buffer.from(input), key).toString("base64url")}`;
  } catch {
    throw invalid();
  }
}

export function verifyPublishReceipt(
  receipt: string,
  publicKeyPem: string,
  expected: { iss: string; aud: string; nowSeconds: number; action: string; kid?: string },
): Payload {
  try {
    const parts = receipt.split(".");
    if (
      parts.length !== 3 ||
      parts.some(
        (part) =>
          !/^[A-Za-z0-9_-]+$/.test(part) ||
          Buffer.from(part, "base64url").toString("base64url") !== part,
      )
    )
      throw invalid();
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const parse = (part: string) => {
      const source = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(part, "base64url"),
      );
      const value = JSON.parse(source);
      if (canonicalJson(value) !== source) throw invalid();
      return value;
    };
    const header = parse(headerPart);
    if (
      header.alg !== "EdDSA" ||
      header.typ !== "rakazo-publish+jws" ||
      typeof header.kid !== "string" ||
      !header.kid ||
      header.kid.length > 200 ||
      Object.keys(header).sort().join(",") !== "alg,kid,typ" ||
      (expected.kid !== undefined && header.kid !== expected.kid)
    )
      throw invalid();
    const key = createPublicKey(publicKeyPem);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(`${headerPart}.${payloadPart}`),
        key,
        Buffer.from(signaturePart, "base64url"),
      )
    )
      throw invalid();
    const payload = parse(payloadPart) as Payload;
    validatePayload(payload);
    if (
      payload.iss !== expected.iss ||
      payload.aud !== expected.aud ||
      payload.action !== expected.action ||
      !Number.isSafeInteger(expected.nowSeconds) ||
      payload.exp <= expected.nowSeconds ||
      payload.iat > expected.nowSeconds + 30
    )
      throw invalid();
    return payload;
  } catch {
    throw invalid();
  }
}

export function privateKeyFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const privateKeyPkcs8Pem = env.RAKAZO_PUBLISH_RECEIPT_PRIVATE_KEY_PKCS8;
  const kid = env.RAKAZO_PUBLISH_RECEIPT_KID;
  const iss = env.RAKAZO_PUBLISH_RECEIPT_ISS;
  const aud = env.RAKAZO_PUBLISH_RECEIPT_AUD;
  if (!privateKeyPkcs8Pem || !kid || !iss || !aud) return null;
  try {
    if (!privateKeyPkcs8Pem.startsWith("-----BEGIN PRIVATE KEY-----")) throw invalid();
    const key = createPrivateKey(privateKeyPkcs8Pem);
    if (key.asymmetricKeyType !== "ed25519") throw invalid();
    return { privateKeyPkcs8Pem, kid, iss, aud };
  } catch {
    throw new Error("Invalid publish receipt signing key configuration");
  }
}
