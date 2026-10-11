import { NextResponse } from "next/server";
import { adminRefusal, isAdmin } from "@/lib/admin-auth";
import { encryptToken } from "@/lib/crypto";
import { parseKeywords } from "@/lib/matcher";
import { readAttachments, text } from "@/lib/rule-input";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Registers a business (its WhatsApp number and token) and, optionally, its first rule.
 *
 * Until the customer dashboard exists, this is how a number gets connected. It is protected by
 * ADMIN_SECRET and fails closed: with no secret configured, or a short one, nobody gets in.
 */

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "طلب غير صالح." }, { status: 400 });
  }

  if (!isAdmin(body.adminSecret)) {
    return adminRefusal(body.adminSecret);
  }

  const name = text(body.name);
  const phoneNumberId = text(body.phoneNumberId).replace(/\D/g, "");
  const token = text(body.token);
  const displayPhone = text(body.displayPhone);
  const fallbackText = text(body.fallbackText);
  const ruleName = text(body.ruleName);
  const ruleKeywords = text(body.ruleKeywords);
  const ruleReply = text(body.ruleReply);

  if (!name || !phoneNumberId || !token) {
    return NextResponse.json({ ok: false, error: "الاسم ومعرّف الرقم والرمز مطلوبة." }, { status: 400 });
  }

  const attachments = readAttachments(body.ruleAttachments, phoneNumberId);

  if (!attachments) {
    return NextResponse.json({ ok: false, error: "مرفقات القاعدة غير صالحة." }, { status: 400 });
  }

  const wantsRule = Boolean(ruleKeywords || ruleReply || attachments.length > 0);

  if (wantsRule && (parseKeywords(ruleKeywords).length === 0 || (!ruleReply && attachments.length === 0))) {
    return NextResponse.json(
      { ok: false, error: "القاعدة تحتاج كلمة تشغيل صالحة (3 حروف فأكثر، أو رقماً) ونص رد أو مرفقاً." },
      { status: 400 }
    );
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "قاعدة البيانات غير مربوطة (متغيرات Supabase)." }, { status: 500 });
  }

  let encrypted: string;

  try {
    encrypted = encryptToken(token);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "تعذّر تشفير الرمز." },
      { status: 500 }
    );
  }

  const { data: business, error } = await supabase
    .from("businesses")
    .upsert(
      {
        name,
        phone_number_id: phoneNumberId,
        display_phone: displayPhone || null,
        access_token_encrypted: encrypted,
        fallback_text: fallbackText,
        active: true,
        updated_at: new Date().toISOString()
      },
      { onConflict: "phone_number_id" }
    )
    .select("id, panel_key")
    .single();

  if (error || !business) {
    return NextResponse.json({ ok: false, error: error?.message ?? "تعذّر حفظ النشاط." }, { status: 500 });
  }

  if (wantsRule) {
    const { error: ruleError } = await supabase.from("rules").insert({
      business_id: business.id,
      name: ruleName || "قاعدة 1",
      keywords: parseKeywords(ruleKeywords).join("، "),
      reply_text: ruleReply,
      attachments
    });

    if (ruleError) {
      return NextResponse.json({ ok: false, error: `حُفظ النشاط لكن تعذّر حفظ القاعدة: ${ruleError.message}` }, { status: 500 });
    }
  }

  // The token is never echoed back.
  return NextResponse.json({ ok: true, businessId: business.id, ruleSaved: wantsRule, panelKey: business.panel_key });
}
