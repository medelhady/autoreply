import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken } from "@/lib/crypto";
import { matchRule, parseKeywords } from "@/lib/matcher";
import { mediaKindFor, type MediaKind } from "@/lib/media-kinds";
import { sendMedia, sendText, type Credentials, type IncomingMessage } from "@/lib/whatsapp";

/**
 * One incoming message, answered on behalf of the business whose number it arrived on.
 *
 * Order of events: find the business, record the message (a redelivery by Meta stops here), match a
 * rule, send its files in order, then its text. A message that matches nothing gets the business's
 * fallback text (the menu), or silence when there is none.
 */

type Business = {
  id: string;
  name: string;
  access_token_encrypted: string;
  fallback_text: string | null;
};

type RuleRow = {
  id: string;
  name: string;
  keywords: string | null;
  reply_text: string | null;
  attachments: unknown;
  active: boolean | null;
};

export type Attachment = { kind: MediaKind; path: string; name: string };

/** The attachments of one row, taking what is stored and ignoring what is not usable. */
export function readAttachments(stored: unknown): Attachment[] {
  const attachments: Attachment[] = [];

  for (const row of Array.isArray(stored) ? stored : []) {
    const item = (row ?? {}) as Record<string, unknown>;
    const path = typeof item.path === "string" ? item.path.trim() : "";

    if (!path) {
      continue;
    }

    const name = typeof item.name === "string" ? item.name : "";
    const declared = typeof item.type === "string" ? item.type : "";
    const kind: MediaKind =
      declared === "video" || declared === "image" || declared === "audio" || declared === "document"
        ? declared
        : mediaKindFor("", path);

    attachments.push({ kind, path, name });
  }

  return attachments;
}

async function logMessage(
  supabase: SupabaseClient,
  row: {
    business_id: string;
    customer_phone: string;
    direction: "inbound" | "outbound";
    body?: string;
    rule_id?: string | null;
    wa_message_id?: string;
    status?: string;
    error?: string | null;
  }
) {
  const { error } = await supabase.from("message_log").insert({ body: "", ...row });

  return error;
}

export async function handleIncoming(supabase: SupabaseClient, incoming: IncomingMessage) {
  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, access_token_encrypted, fallback_text")
    .eq("phone_number_id", incoming.phoneNumberId)
    .eq("active", true)
    .maybeSingle<Business>();

  // A number we do not serve, or a business that is paused: nothing to say and nothing to log.
  if (!business) {
    return { handled: false as const, reason: "unknown-or-paused-business" };
  }

  // Recorded before answering. Meta redelivers a webhook it believes failed, and the unique index on
  // the Meta message id turns the second copy into a no-op instead of a second reply.
  const logError = await logMessage(supabase, {
    business_id: business.id,
    customer_phone: incoming.from,
    direction: "inbound",
    body: incoming.body,
    wa_message_id: incoming.messageId
  });

  if (logError?.code === "23505") {
    return { handled: false as const, reason: "duplicate" };
  }

  if (logError) {
    console.error("Could not log the incoming message", logError);
  }

  const { data: rows } = await supabase
    .from("rules")
    .select("id, name, keywords, reply_text, attachments, active")
    .eq("business_id", business.id)
    .eq("active", true)
    // Newest first: when two rules share a keyword, the one saved last is the one meant, and the
    // matcher keeps the first of equals.
    .order("created_at", { ascending: false });

  const rules = ((rows ?? []) as RuleRow[]).map((row) => ({
    id: row.id,
    keywords: parseKeywords(row.keywords ?? ""),
    replyText: row.reply_text ?? "",
    attachments: readAttachments(row.attachments),
    active: row.active !== false
  }));

  const rule = matchRule(incoming.body, rules);
  const replyText = rule ? rule.replyText : (business.fallback_text ?? "").trim();
  const attachments = rule ? rule.attachments : [];

  if (!replyText && attachments.length === 0) {
    return { handled: true as const, matched: false, sent: 0 };
  }

  if (rule) {
    await supabase.rpc("increment_rule_hit", { p_rule_id: rule.id });
  }

  let credentials: Credentials;

  try {
    credentials = { phoneNumberId: incoming.phoneNumberId, token: decryptToken(business.access_token_encrypted) };
  } catch (error) {
    console.error("Could not read the business token", business.id, error);
    await logMessage(supabase, {
      business_id: business.id,
      customer_phone: incoming.from,
      direction: "outbound",
      rule_id: rule?.id ?? null,
      status: "failed",
      error: "token-unreadable"
    });

    return { handled: true as const, matched: Boolean(rule), sent: 0 };
  }

  let sent = 0;

  // Files first, in the order they were attached, then the text as its own bubble. One file failing
  // must not stop the rest: half an answer is worth more than none to someone who just wrote in.
  for (const attachment of attachments) {
    const signed = await supabase.storage.from("rule-media").createSignedUrl(attachment.path, 600);

    if (signed.error || !signed.data?.signedUrl) {
      await logMessage(supabase, {
        business_id: business.id,
        customer_phone: incoming.from,
        direction: "outbound",
        rule_id: rule?.id ?? null,
        body: `[${attachment.kind}] ${attachment.name || attachment.path}`,
        status: "failed",
        error: signed.error?.message ?? "could-not-sign-file"
      });
      continue;
    }

    try {
      const result = await sendMedia(credentials, incoming.from, attachment.kind, signed.data.signedUrl, attachment.name || undefined);
      sent += 1;

      await logMessage(supabase, {
        business_id: business.id,
        customer_phone: incoming.from,
        direction: "outbound",
        rule_id: rule?.id ?? null,
        body: `[${attachment.kind}] ${attachment.name || attachment.path}`,
        status: result.viaLink ? "sent-as-link" : "sent"
      });
    } catch (error) {
      await logMessage(supabase, {
        business_id: business.id,
        customer_phone: incoming.from,
        direction: "outbound",
        rule_id: rule?.id ?? null,
        body: `[${attachment.kind}] ${attachment.name || attachment.path}`,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "send-failed"
      });
    }
  }

  if (replyText) {
    try {
      await sendText(credentials, incoming.from, replyText);
      sent += 1;

      await logMessage(supabase, {
        business_id: business.id,
        customer_phone: incoming.from,
        direction: "outbound",
        rule_id: rule?.id ?? null,
        body: replyText,
        status: "sent"
      });
    } catch (error) {
      await logMessage(supabase, {
        business_id: business.id,
        customer_phone: incoming.from,
        direction: "outbound",
        rule_id: rule?.id ?? null,
        body: replyText,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "send-failed"
      });
    }
  }

  return { handled: true as const, matched: Boolean(rule), sent };
}
