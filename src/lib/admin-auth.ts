import crypto from "node:crypto";

/**
 * The temporary admin gate, until customers have their own dashboard login.
 *
 * Fails closed: with no ADMIN_SECRET configured, or a short one, nobody gets in.
 */
export function isAdmin(given: unknown) {
  const expected = process.env.ADMIN_SECRET?.trim();

  if (!expected || expected.length < 12 || typeof given !== "string") {
    return false;
  }

  // Hashed first so the comparison is constant-time whatever the lengths are.
  const first = crypto.createHash("sha256").update(given).digest();
  const second = crypto.createHash("sha256").update(expected).digest();

  return crypto.timingSafeEqual(first, second);
}
