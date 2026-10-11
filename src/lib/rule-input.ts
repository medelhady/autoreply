import { parseKeywords } from "@/lib/matcher";
import type { MediaKind } from "@/lib/media-kinds";

/**
 * Reading and checking a rule that arrives from a browser.
 *
 * Shared by the admin setup route and the customer panel so both apply the same limits: a usable
 * trigger, something to send, and only files that were uploaded for this very number.
 */

export type RuleAttachment = { type: MediaKind; path: string; name: string };

export const maxAttachments = 30;

export function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Only files uploaded for this number: the path must start with its id. Null when anything is off. */
export function readAttachments(raw: unknown, phoneNumberId: string): RuleAttachment[] | null {
  if (raw === undefined || raw === null) {
    return [];
  }

  if (!Array.isArray(raw) || raw.length > maxAttachments) {
    return null;
  }

  const attachments: RuleAttachment[] = [];

  for (const item of raw) {
    const row = (item ?? {}) as Record<string, unknown>;
    const type = row.type;
    const path = text(row.path);

    if (
      (type !== "video" && type !== "image" && type !== "audio" && type !== "document") ||
      !path.startsWith(`${phoneNumberId}/`) ||
      path.length > 300 ||
      path.includes("..")
    ) {
      return null;
    }

    attachments.push({ type, path, name: text(row.name).slice(0, 200) });
  }

  return attachments;
}

export type RuleFields = {
  name: string;
  keywords: string;
  replyText: string;
  attachments: RuleAttachment[];
};

/** A complete rule from a request body, or the reason (in Arabic, for the person at the form). */
export function readRule(body: Record<string, unknown>, phoneNumberId: string): { rule: RuleFields } | { error: string } {
  const keywords = parseKeywords(text(body.keywords)).join("، ");
  const replyText = text(body.replyText);
  const attachments = readAttachments(body.attachments, phoneNumberId);

  if (!attachments) {
    return { error: "المرفقات غير صالحة." };
  }

  if (!keywords) {
    return { error: "اكتب كلمة أو رقماً يُشغّل الرد (كلمة من 3 حروف فأكثر، أو رقم مثل 1)." };
  }

  if (!replyText && attachments.length === 0) {
    return { error: "اكتب نص الرد أو أضف مرفقاً." };
  }

  return {
    rule: {
      name: text(body.name).slice(0, 120) || keywords.split("،")[0].trim(),
      keywords,
      replyText,
      attachments
    }
  };
}
