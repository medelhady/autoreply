import { NextResponse } from "next/server";
import { handleIncoming } from "@/lib/reply";
import { getServiceSupabase } from "@/lib/supabase/server";
import { parseDeliveryFailures, parseMessages, verifySignature } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
// Several files are uploaded to Meta and sent one after another. The platform default would cut that
// off midway and lose the reply with no error anywhere.
export const maxDuration = 30;

/** Meta verifies the URL once with a GET carrying hub.verify_token. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const verifyToken = process.env.META_VERIFY_TOKEN?.trim();
  const challenge = url.searchParams.get("hub.challenge");

  if (
    verifyToken &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === verifyToken &&
    challenge
  ) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  return NextResponse.json({ ok: false }, { status: 403 });
}

export async function POST(request: Request) {
  // The signature covers the exact bytes Meta sent, so the body is read as text before parsing.
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const supabase = getServiceSupabase();

  if (!supabase) {
    // 500 so Meta retries once the environment is fixed, rather than losing the message.
    return NextResponse.json({ ok: false, error: "database-not-configured" }, { status: 500 });
  }

  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Meta reports a refused delivery only here, long after answering the send with a 200.
  for (const failure of parseDeliveryFailures(payload)) {
    console.error(`Delivery to ${failure.recipient} failed on ${failure.phoneNumberId}: ${failure.reason}`);

    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("phone_number_id", failure.phoneNumberId)
      .maybeSingle();

    if (business) {
      await supabase.from("message_log").insert({
        business_id: business.id,
        customer_phone: failure.recipient,
        direction: "outbound",
        status: "failed",
        error: `delivery: ${failure.reason}`.slice(0, 500)
      });
    }
  }

  let processed = 0;

  for (const incoming of parseMessages(payload)) {
    try {
      const result = await handleIncoming(supabase, incoming);

      if (result.handled) {
        processed += 1;
      }
    } catch (error) {
      // One bad message must not make Meta redeliver the whole batch to every other business.
      console.error("Failed to answer a message", incoming.phoneNumberId, error);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
