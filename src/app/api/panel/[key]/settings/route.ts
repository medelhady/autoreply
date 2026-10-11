import { NextResponse } from "next/server";
import { findPanelBusiness } from "@/lib/panel-auth";
import { text } from "@/lib/rule-input";
import { getServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The reply for a message that matches no rule (the menu). Empty means stay silent. */
export async function PATCH(request: Request, { params }: { params: { key: string } }) {
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

  const { error } = await supabase
    .from("businesses")
    .update({ fallback_text: text(body.fallbackText).slice(0, 2000), updated_at: new Date().toISOString() })
    .eq("id", business.id);

  return error
    ? NextResponse.json({ ok: false, error: "تعذّر الحفظ." }, { status: 500 })
    : NextResponse.json({ ok: true });
}
