/**
 * PassPulse token verifier for browser/client-side using @noble/ed25519.
 * Must match backend Python app/tokens.py byte for byte.
 */

import * as ed from "@noble/ed25519";

export const VERSION = 1;
export const PAYLOAD_LEN = 18;
export const SIGNATURE_LEN = 64;
export const TOTAL_LEN = PAYLOAD_LEN + SIGNATURE_LEN; // 82 bytes

export interface ParsedToken {
  version: number;
  keyId: number;
  ticketId: string;
  payload: Uint8Array;
  signature: Uint8Array;
}

export interface VerifyResult {
  valid: boolean;
  parsed?: ParsedToken;
  error?: "malformed" | "bad_version" | "unknown_key" | "bad_signature";
  errorMessage?: string;
}

/**
 * Base64url to Uint8Array decode
 */
export function b64urlDecode(str: string): Uint8Array {
  // Strip whitespace
  const clean = str.trim();
  // Valid base64url characters only
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) {
    throw new Error("Invalid base64url characters");
  }

  // Add padding
  const padding = (4 - (clean.length % 4)) % 4;
  const base64 = clean.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padding);

  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } else {
    // Node / test environment fallback
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
}

/**
 * Convert 16 raw bytes to standard UUID string (8-4-4-4-12)
 */
export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error("UUID bytes must be 16 bytes");
  }
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/**
 * Extract token from full QR text URL or return token if already bare
 */
/**
 * Extract the token from various input shapes:
 *   - full URL:  http://host/t/<TOKEN>
 *   - bare token: <TOKEN>
 *   - quoted or whitespace-padded
 *   - a UUID (returns "" so caller can give a clear error)
 */
export function extractToken(qrText: string): string {
  let s = (qrText || "").trim();

  // Strip surrounding quotes / backticks / whitespace
  s = s.replace(/^["'`\s]+|["'`\s]+$/g, "");

  // If it's a URL like .../t/<TOKEN>, cut down to the token part
  const marker = "/t/";
  const idx = s.indexOf(marker);
  if (idx !== -1) {
    s = s.slice(idx + marker.length);
    s = s.split(/[\/?#\s]/)[0];
  }

  // Final safety net: keep ONLY base64url alphabet characters
  s = s.replace(/[^A-Za-z0-9_-]/g, "");

  return s;
}

/**
 * True if the string looks like a UUID (8-4-4-4-12 hex).
 * Used to give a helpful error when someone pastes the ticket ID.
 */
export function looksLikeUuid(s: string): boolean {
  return /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(
    s.trim()
  );
}

/**
 * Parse token bytes without verifying signature
 */
export function parseToken(tokenStr: string): ParsedToken {
  const raw = b64urlDecode(tokenStr);
  if (raw.length !== TOTAL_LEN) {
    throw new Error(`Token must be ${TOTAL_LEN} bytes, got ${raw.length}`);
  }

  const version = raw[0];
  if (version !== VERSION) {
    throw new Error(`Unsupported token version: ${version}`);
  }

  const keyId = raw[1];
  const ticketIdBytes = raw.slice(2, 18);
  const ticketId = bytesToUuid(ticketIdBytes);
  const payload = raw.slice(0, PAYLOAD_LEN);
  const signature = raw.slice(PAYLOAD_LEN, TOTAL_LEN);

  return {
    version,
    keyId,
    ticketId,
    payload,
    signature,
  };
}

/**
 * Parse and verify token against map of public keys.
 * publicKeys map: keyId (number or string) -> Uint8Array (32 bytes) or base64 string
 */
export async function verifyToken(
  tokenStr: string,
  publicKeys: Record<string | number, Uint8Array | string>
): Promise<VerifyResult> {
  let parsed: ParsedToken;
  try {
    const raw = b64urlDecode(tokenStr);
    if (raw.length !== TOTAL_LEN) {
      return { valid: false, error: "malformed", errorMessage: `Expected ${TOTAL_LEN} bytes, got ${raw.length}` };
    }
    const version = raw[0];
    if (version !== VERSION) {
      return { valid: false, error: "bad_version", errorMessage: `Unknown version ${version}` };
    }
    const keyId = raw[1];
    const ticketId = bytesToUuid(raw.slice(2, 18));
    const payload = raw.slice(0, PAYLOAD_LEN);
    const signature = raw.slice(PAYLOAD_LEN, TOTAL_LEN);
    parsed = { version, keyId, ticketId, payload, signature };
  } catch (err: any) {
    return { valid: false, error: "malformed", errorMessage: err?.message || String(err) };
  }

  let pubKeyRaw = publicKeys[parsed.keyId];
  if (!pubKeyRaw) {
    return { valid: false, error: "unknown_key", errorMessage: `Unknown key_id: ${parsed.keyId}` };
  }

  let pubKeyBytes: Uint8Array;
  if (typeof pubKeyRaw === "string") {
    // Standard base64
    pubKeyBytes = new Uint8Array(Buffer.from(pubKeyRaw, "base64"));
  } else {
    pubKeyBytes = pubKeyRaw;
  }

  try {
    const isValid = await ed.verifyAsync(parsed.signature, parsed.payload, pubKeyBytes);
    if (!isValid) {
      return { valid: false, error: "bad_signature", errorMessage: "Ed25519 signature mismatch" };
    }
    return { valid: true, parsed };
  } catch (err: any) {
    return { valid: false, error: "bad_signature", errorMessage: err?.message || "Signature verification failed" };
  }
}
