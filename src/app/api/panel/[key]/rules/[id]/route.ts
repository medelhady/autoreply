import { NextResponse } from "next/server";
import { findPanelBusiness } from "@/lib/panel-auth";
import { readAttachments, readRule } from "@/lib/rule-input";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { params: { key: string; id: string } };

const idShape = /^[0-9a-f-]{36}$/i;

async function context(params: Params["params"]) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return { error: NextResponse.json({ ok: false, error: "قاعدة البيانات غير مربوطة." }, { status: 500 }) };
  }

  const business = await findPanelBusiness(supabase, params.key);

  if (!business || !idShape.test(params.id)) {
    return { error: NextResponse.json({ ok: false, error: "الرابط غير صحيح أو متوقف." }, { status: 404 }) };
  }

  return { supabase, business };
}

/** Files the rule held that the new version no longer lists. Best effort: a leftover file is harmless. */
async function removeUnused(
  supabase: NonNullable<ReturnType<typeof getServiceSupabase>>,
  before: unknown,
  keep: string[],
  phoneNumberId: string
) {
  const old = readAttachments(before, phoneNumberId) ?? [];
  const gone = old.map((file) => file.path).filter((path) => !keep.includes(path));

  if (gone.length > 0) {
    await supabase.storage.from("rule-media").remove(gone);
  }
}

/** Edit a rule: either everything (the form), or just on/off (the switch). */
export async function PATCH(request: Request, { params }: Params) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "طلب غير صالح." }, { status: 400 });
  }

  const ctx = await context(params);

  if ("error" in ctx) {
    return ctx.error;
  }

  const { supabase, business } = ctx;

  const { data: existing } = await supabase
    .from("rules")
    .select("id, attachments")
    .eq("id", params.id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ ok: false, error: "القاعدة غير موجودة." }, { status: 404 });
  }

  // The switch sends only {active}.
  if (typeof body.active === "boolean" && body.keywords === undefined) {
    const { error } = await supabase
      .from("rules")
      .update({ active: body.active, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("business_id", business.id);

    return error
      ? NextResponse.json({ ok: false, error: "تعذّر التحديث." }, { status: 500 })
      : NextResponse.json({ ok: true });
  }

  const parsed = readRule(body, business.phone_number_id);

  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const { error } = await supabase
    .from("rules")
    .update({
      name: parsed.rule.name,
      keywords: parsed.rule.keywords,
      reply_text: parsed.rule.replyText,
      attachments: parsed.rule.attachments,
      updated_at: new Date().toISOString()
    })
    .eq("id", params.id)
    .eq("business_id", business.id);

  if (error) {
    return NextResponse.json({ ok: false, error: "تعذّر حفظ التعديل." }, { status: 500 });
  }

  await removeUnused(supabase, existing.attachments, parsed.rule.attachments.map((file) => file.path), business.phone_number_id);

  return NextResponse.json({ ok: true });
}

/** Delete a rule and the files that only it used. */
export async function DELETE(_request: Request, { params }: Params) {
  const ctx = await context(params);

  if ("error" in ctx) {
    return ctx.error;
  }

  const { supabase, business } = ctx;

  const { data: existing } = await supabase
    .from("rules")
    .select("id, attachments")
    .eq("id", params.id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ ok: false, error: "القاعدة غير موجودة." }, { status: 404 });
  }

  const { error } = await supabase.from("rules").delete().eq("id", params.id).eq("business_id", business.id);

  if (error) {
    return NextResponse.json({ ok: false, error: "تعذّر الحذف." }, { status: 500 });
  }

  await removeUnused(supabase, existing.attachments, [], business.phone_number_id);

  return NextResponse.json({ ok: true });
}
