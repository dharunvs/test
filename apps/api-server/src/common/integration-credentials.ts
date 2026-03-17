import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { toJson } from "./json.js";

const CREDENTIALS_ENVELOPE_VERSION = 1;

interface CredentialEnvelope {
  v: number;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEnvelope(value: unknown): value is CredentialEnvelope {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.v === CREDENTIALS_ENVELOPE_VERSION &&
    value.alg === "aes-256-gcm" &&
    typeof value.iv === "string" &&
    typeof value.tag === "string" &&
    typeof value.ciphertext === "string"
  );
}

export function encryptCredentials(
  credentials: Record<string, unknown>,
  secret?: string
) {
  if (!secret || secret.trim().length === 0) {
    return toJson(credentials);
  }

  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope: CredentialEnvelope = {
    v: CREDENTIALS_ENVELOPE_VERSION,
    alg: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };

  return toJson(envelope);
}

export function decryptCredentials(
  encryptedCredentials: unknown,
  secret?: string
): Record<string, unknown> {
  if (!isRecord(encryptedCredentials)) {
    return {};
  }

  if (!isEnvelope(encryptedCredentials)) {
    return encryptedCredentials;
  }

  if (!secret || secret.trim().length === 0) {
    return {};
  }

  try {
    const key = deriveKey(secret);
    const iv = Buffer.from(encryptedCredentials.iv, "base64url");
    const tag = Buffer.from(encryptedCredentials.tag, "base64url");
    const ciphertext = Buffer.from(encryptedCredentials.ciphertext, "base64url");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
