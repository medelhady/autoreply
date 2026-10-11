import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { extensionForMedia, mediaKindFor, mediaKindLabels, mediaSizeLimits } from "@/lib/media-kinds";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Hands the browser a one-use upload ticket for the private "rule-media" bucket.
 *
 * The file goes straight from the browser to Supabase Storage, not through this server: a serverless
 * request body is capped at a few megabytes, which a video would exceed. This route only checks who is
 * asking, what kind of file it is and whether it is within WhatsApp's size limit for that kind.
 *
 * The stored name is generated (digits and an extension), never the original: Arabic or spaced file
 * names are rejected by storage as invalid keys. The original name travels separately as the label.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "طلب غير صالح." }, { status: 400 });
  }

  if (!isAdmin(body.adminSecret)) {
    return NextResponse.json({ ok: false, error: "كلمة مرور الإدارة غير صحيحة." }, { status: 401 });
  }

  const phoneNumberId = String(body.phoneNumberId ?? "").replace(/\D/g, "");
  const fileName = String(body.fileName ?? "");
  const contentType = String(body.contentType ?? "");
  const size = Number(body.size);

  if (!phoneNumberId || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: "بيانات الملف ناقصة (معرّف الرقم أو الحجم)." }, { status: 400 });
  }

  const kind = mediaKindFor(contentType, fileName);
  const limit = mediaSizeLimits[kind];

  if (size > limit) {
    return NextResponse.json(
      {
        ok: false,
        error: `${mediaKindLabels[kind].label}: الحجم الأقصى في واتساب ${Math.round(limit / (1024 * 1024))} ميغابايت.`
      },
      { status: 400 }
    );
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "قاعدة البيانات غير مربوطة." }, { status: 500 });
  }

  const extension = extensionForMedia(kind, contentType, fileName).replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
  const path = `${phoneNumberId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${extension}`;

  const { data, error } = await supabase.storage.from("rule-media").createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ ok: false, error: error?.message ?? "تعذّر تجهيز الرفع." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path: data.path, token: data.token, kind });
}
