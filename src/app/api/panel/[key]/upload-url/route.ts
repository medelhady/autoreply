import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { extensionForMedia, mediaKindFor, mediaKindLabels, mediaSizeLimits } from "@/lib/media-kinds";
import { findPanelBusiness } from "@/lib/panel-auth";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** A one-use upload ticket for this business's folder in the private bucket (see the admin route). */
export async function POST(request: Request, { params }: { params: { key: string } }) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "طلب غير صالح." }, { status: 400 });
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "قاعدة البيانات غير مربوطة." }, { status: 500 });
  }

  const business = await findPanelBusiness(supabase, params.key);

  if (!business) {
    return NextResponse.json({ ok: false, error: "الرابط غير صحيح أو متوقف." }, { status: 404 });
  }

  const fileName = String(body.fileName ?? "");
  const contentType = String(body.contentType ?? "");
  const size = Number(body.size);

  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ ok: false, error: "حجم الملف غير معروف." }, { status: 400 });
  }

  const kind = mediaKindFor(contentType, fileName);
  const limit = mediaSizeLimits[kind];

  if (size > limit) {
    return NextResponse.json(
      { ok: false, error: `${mediaKindLabels[kind].label}: الحجم الأقصى في واتساب ${Math.round(limit / (1024 * 1024))} ميغابايت.` },
      { status: 400 }
    );
  }

  const extension = extensionForMedia(kind, contentType, fileName).replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
  const path = `${business.phone_number_id}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${extension}`;

  const { data, error } = await supabase.storage.from("rule-media").createSignedUploadUrl(path);

  if (error || !data) {
    return NextResponse.json({ ok: false, error: "تعذّر تجهيز الرفع." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path: data.path, token: data.token, kind });
}
