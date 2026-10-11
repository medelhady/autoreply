import crypto from "node:crypto";
import { NextResponse } from "next/server";

/**
 * The temporary admin gate, until customers have their own dashboard login.
 *
 * Fails closed: with no ADMIN_SECRET configured, or a short one, nobody gets in.
 */
export type AdminCheck = "ok" | "unconfigured" | "wrong";

export function checkAdmin(given: unknown): AdminCheck {
  const expected = process.env.ADMIN_SECRET?.trim();

  if (!expected || expected.length < 12) {
    return "unconfigured";
  }

  if (typeof given !== "string") {
    return "wrong";
  }

  // Hashed first so the comparison is constant-time whatever the lengths are. The typed value is
  // trimmed because a stray space from a paste or autofill is not part of anyone's password.
  const first = crypto.createHash("sha256").update(given.trim()).digest();
  const second = crypto.createHash("sha256").update(expected).digest();

  return crypto.timingSafeEqual(first, second) ? "ok" : "wrong";
}

export function isAdmin(given: unknown) {
  return checkAdmin(given) === "ok";
}

/**
 * The response for a refused request, saying why in terms the person at the form can act on.
 *
 * It reveals only what the caller already knows (how long what they typed was) and whether the server
 * has a secret configured at all; never the secret or its length.
 */
export function adminRefusal(given: unknown) {
  if (checkAdmin(given) === "unconfigured") {
    return NextResponse.json(
      { ok: false, error: "ADMIN_SECRET غير مضبوط في الخادم أو أقصر من 12 حرفاً. تأكد منه في Vercel ثم أعد النشر." },
      { status: 401 }
    );
  }

  const typed = typeof given === "string" ? given.trim().length : 0;

  return NextResponse.json(
    {
      ok: false,
      error: `كلمة مرور الإدارة غير صحيحة (المكتوب ${typed} حرفاً). إن كنت غيّرتها في Vercel فتأكد أنك أعدت النشر (Redeploy) بعد التغيير.`
    },
    { status: 401 }
  );
}
