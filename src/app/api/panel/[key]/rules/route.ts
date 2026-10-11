import { NextResponse } from "next/server";
import { findPanelBusiness } from "@/lib/panel-auth";
import { readRule } from "@/lib/rule-input";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ ok: false, error: "الرابط غير صحيح أو متوقف." }, { status: 404 });

/** The business's rules, newest first. */
export async function GET(_request: Request, { params }: { params: { key: string } }) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "قاعدة البيانات غير مربوطة." }, { status: 500 });
  }

  const business = await findPanelBusiness(supabase, params.key);

  if (!business) {
    return notFound();
  }

  const { data, error } = await supabase
    .from("rules")
    .select("id, name, keywords, reply_text, attachments, active, hits, created_at")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: "تعذّر تحميل القواعد." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    business: { name: business.name, fallbackText: business.fallback_text ?? "" },
    rules: data ?? []
  });
}

/** A new rule. */
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
    return notFound();
  }

  const parsed = readRule(body, business.phone_number_id);

  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const { error } = await supabase.from("rules").insert({
    business_id: business.id,
    name: parsed.rule.name,
    keywords: parsed.rule.keywords,
    reply_text: parsed.rule.replyText,
    attachments: parsed.rule.attachments
  });

  if (error) {
    return NextResponse.json({ ok: false, error: "تعذّر حفظ القاعدة." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
