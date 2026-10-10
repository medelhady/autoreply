import crypto from "node:crypto";

/**
 * Each business hands us a WhatsApp access token that can send messages as them. It is stored
 * encrypted, so a leaked database dump is not a leaked set of tokens.
 *
 * AES-256-GCM with a random 12-byte IV per value; stored as "iv:tag:ciphertext" in hex.
 * TOKEN_ENCRYPTION_KEY is 32 bytes written as 64 hex characters.
 */

function getKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY?.trim() ?? "";

  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  }

  return Buffer.from(hex, "hex");
}

export function encryptToken(plain: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);

  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptToken(stored: string) {
  const [iv, tag, data] = stored.split(":");

  if (!iv || !tag || !data) {
    throw new Error("Stored token is not in the expected format.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));

  return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
}
