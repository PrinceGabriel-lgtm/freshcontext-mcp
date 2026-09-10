export const ED25519_SIGNATURE_VERSION = "FRESHCONTEXT_HA_PRI_V4" as const;
export const ED25519_ALGORITHM = "Ed25519" as const;
export const SIGNING_KEYS_SCHEMA = "freshcontext.signing-keys.v1" as const;

const V3_HEADER = "FRESHCONTEXT_HA_PRI_V3";
const KEY_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export interface Ed25519SigningEnv {
  FC_ED25519_PRIVATE_KEY_B64?: string;
  FC_ED25519_PUBLIC_KEY_B64?: string;
  FC_ED25519_KEY_ID?: string;
  FC_ED25519_PUBLIC_KEYS_JSON?: string;
}

export interface PublishedSigningKey {
  key_id: string;
  algorithm: typeof ED25519_ALGORITHM;
  public_key_spki_b64: string;
  status: "active" | "retired";
  valid_from?: string;
  valid_until?: string;
}

export interface ActiveSigningConfig {
  keyId: string;
  privateKeyPkcs8Base64: string;
  publicKeySpkiBase64: string;
}

function normalizeBase64(input: string): string {
  const clean = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  const pad = clean.length % 4;
  return pad === 0 ? clean : clean + "=".repeat(4 - pad);
}

function decodeBase64(input: string): Uint8Array {
  const normalized = normalizeBase64(input);
  const binary = atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function encodeBase64Url(input: ArrayBuffer): string {
  const bytes = new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function validKeyId(value: unknown): value is string {
  return typeof value === "string" && KEY_ID_RE.test(value);
}

export function activeSigningConfig(env: Ed25519SigningEnv): ActiveSigningConfig | null {
  const keyId = env.FC_ED25519_KEY_ID?.trim();
  const privateKey = env.FC_ED25519_PRIVATE_KEY_B64?.trim();
  const publicKey = env.FC_ED25519_PUBLIC_KEY_B64?.trim();
  if (!keyId || !privateKey || !publicKey || !validKeyId(keyId)) return null;
  return {
    keyId,
    privateKeyPkcs8Base64: privateKey,
    publicKeySpkiBase64: publicKey,
  };
}

export function buildHaPriPayloadV4(v3Payload: string, keyId: string): string {
  if (!validKeyId(keyId)) throw new Error("invalid Ed25519 key_id");
  const lines = v3Payload.split("\n");
  if (lines[0] !== V3_HEADER) {
    throw new Error(`expected ${V3_HEADER} payload`);
  }
  return [
    ED25519_SIGNATURE_VERSION,
    ...lines.slice(1),
    `key_id=${keyId}`,
    `signature_algorithm=${ED25519_ALGORITHM}`,
  ].join("\n");
}

export function keyIdFromV4Payload(payload: string): string | null {
  const lines = payload.split("\n");
  if (lines[0] !== ED25519_SIGNATURE_VERSION) return null;
  const keyLine = lines.find((line) => line.startsWith("key_id="));
  const algorithmLine = lines.find((line) => line.startsWith("signature_algorithm="));
  if (!keyLine || algorithmLine !== `signature_algorithm=${ED25519_ALGORITHM}`) return null;
  const keyId = keyLine.slice("key_id=".length);
  return validKeyId(keyId) ? keyId : null;
}

export async function signEd25519(
  privateKeyPkcs8Base64: string,
  payload: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodeBase64(privateKeyPkcs8Base64),
    { name: ED25519_ALGORITHM } as any,
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    ED25519_ALGORITHM,
    key,
    new TextEncoder().encode(payload)
  );
  return encodeBase64Url(signature);
}

export async function verifyEd25519(
  publicKeySpkiBase64: string,
  payload: string,
  signatureBase64Url: string
): Promise<boolean> {
  let signature: Uint8Array;
  try {
    signature = decodeBase64(signatureBase64Url);
  } catch {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      decodeBase64(publicKeySpkiBase64),
      { name: ED25519_ALGORITHM } as any,
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      ED25519_ALGORITHM,
      key,
      signature,
      new TextEncoder().encode(payload)
    );
  } catch {
    return false;
  }
}

function parseHistory(raw: string | undefined): PublishedSigningKey[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((candidate): PublishedSigningKey[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      if (!validKeyId(item.key_id) || typeof item.public_key_spki_b64 !== "string") return [];
      if (item.algorithm !== undefined && item.algorithm !== ED25519_ALGORITHM) return [];
      const status = item.status === "active" ? "active" : "retired";
      const key: PublishedSigningKey = {
        key_id: item.key_id,
        algorithm: ED25519_ALGORITHM,
        public_key_spki_b64: item.public_key_spki_b64,
        status,
      };
      if (typeof item.valid_from === "string") key.valid_from = item.valid_from;
      if (typeof item.valid_until === "string") key.valid_until = item.valid_until;
      return [key];
    });
  } catch {
    return [];
  }
}

export function publishedSigningKeys(env: Ed25519SigningEnv): PublishedSigningKey[] {
  const byId = new Map<string, PublishedSigningKey>();
  for (const key of parseHistory(env.FC_ED25519_PUBLIC_KEYS_JSON)) byId.set(key.key_id, key);

  const currentId = env.FC_ED25519_KEY_ID?.trim();
  const currentPublic = env.FC_ED25519_PUBLIC_KEY_B64?.trim();
  if (currentId && currentPublic && validKeyId(currentId)) {
    byId.set(currentId, {
      key_id: currentId,
      algorithm: ED25519_ALGORITHM,
      public_key_spki_b64: currentPublic,
      status: "active",
    });
  }

  return [...byId.values()].sort((a, b) => a.key_id.localeCompare(b.key_id));
}

export function signingKeyDocument(env: Ed25519SigningEnv): {
  schema: typeof SIGNING_KEYS_SCHEMA;
  algorithm: typeof ED25519_ALGORITHM;
  keys: PublishedSigningKey[];
} {
  return {
    schema: SIGNING_KEYS_SCHEMA,
    algorithm: ED25519_ALGORITHM,
    keys: publishedSigningKeys(env),
  };
}

interface V3Line {
  prefix: string;
  payload: string;
}

function extractV3Lines(text: string): V3Line[] {
  const startTag = "[FRESHCONTEXT_SIG_V3]";
  const endTag = "[/FRESHCONTEXT_SIG_V3]";
  const start = text.indexOf(startTag);
  if (start < 0) return [];
  const end = text.indexOf(endTag, start + startTag.length);
  if (end < 0) return [];
  const body = text.slice(start + startTag.length, end);
  const out: V3Line[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("item=")) continue;
    const payloadMarker = " payload=";
    const payloadAt = line.indexOf(payloadMarker);
    if (payloadAt < 0) continue;
    const left = line.slice(0, payloadAt);
    const sigAt = left.lastIndexOf(" sig=");
    if (sigAt < 0) continue;
    const prefix = left.slice(0, sigAt);
    try {
      const payload = JSON.parse(line.slice(payloadAt + payloadMarker.length));
      if (typeof payload === "string" && payload.startsWith(`${V3_HEADER}\n`)) {
        out.push({ prefix, payload });
      }
    } catch {
      // Ignore malformed legacy lines rather than rewriting caller output.
    }
  }
  return out;
}

export async function appendEd25519Attestations(
  text: string,
  env: Ed25519SigningEnv
): Promise<string> {
  if (text.includes("[FRESHCONTEXT_SIG_V4]")) return text;
  const config = activeSigningConfig(env);
  if (!config) return text;

  const legacyItems = extractV3Lines(text);
  if (legacyItems.length === 0) return text;

  const signedLines: string[] = [];
  for (const item of legacyItems) {
    const payload = buildHaPriPayloadV4(item.payload, config.keyId);
    const signature = await signEd25519(config.privateKeyPkcs8Base64, payload);
    signedLines.push(`${item.prefix} sig=${signature} payload=${JSON.stringify(payload)}`);
  }

  const block = [
    "[FRESHCONTEXT_SIG_V4]",
    `algo=${ED25519_ALGORITHM}`,
    `key_id=${config.keyId}`,
    ...signedLines,
    "[/FRESHCONTEXT_SIG_V4]",
  ].join("\n");
  return `${text}\n${block}`;
}

export async function verifyV4Payload(
  payload: string,
  signature: string,
  env: Ed25519SigningEnv
): Promise<{
  status: "valid" | "invalid" | "unknown";
  key_id: string | null;
  reasons: string[];
}> {
  const keyId = keyIdFromV4Payload(payload);
  if (!keyId) {
    return { status: "invalid", key_id: null, reasons: ["invalid FRESHCONTEXT_HA_PRI_V4 payload"] };
  }
  const key = publishedSigningKeys(env).find((candidate) => candidate.key_id === keyId);
  if (!key) {
    return { status: "unknown", key_id: keyId, reasons: ["public verification key not found for key_id"] };
  }
  const valid = await verifyEd25519(key.public_key_spki_b64, payload, signature);
  return {
    status: valid ? "valid" : "invalid",
    key_id: keyId,
    reasons: valid ? [] : ["Ed25519 signature does not verify against the published key"],
  };
}
