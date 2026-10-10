import crypto from "node:crypto";
import { inspectMp4 } from "@/lib/mp4-inspect";
import { metaMediaType, type MediaKind } from "@/lib/media-kinds";

/**
 * Talking to Meta's WhatsApp Cloud API, for many businesses at once.
 *
 * The difference from Deyara: nothing here reads the token or the phone number id from the
 * environment. Every call receives the credentials of the business it is acting for, because one
 * deployment answers on behalf of every customer's own number.
 */

export type Credentials = { phoneNumberId: string; token: string };

const graph = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION?.trim() || "v20.0"}`;

/** A file WhatsApp will never relay, however it is sent. Retrying by link would be refused the same way. */
export class UnusableMediaError extends Error {}

// ---------------------------------------------------------------------------------------------
// Incoming
// ---------------------------------------------------------------------------------------------

type MetaPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          image?: { caption?: string };
          video?: { caption?: string };
          document?: { caption?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          recipient_id?: string;
          errors?: Array<{ code?: number; title?: string; message?: string }>;
        }>;
      };
    }>;
  }>;
};

export type IncomingMessage = {
  /** Which business's number this arrived on. The routing key. */
  phoneNumberId: string;
  /** Meta's id for the message, used to ignore redeliveries. */
  messageId: string;
  /** The customer, digits only. */
  from: string;
  body: string;
};

export type DeliveryFailure = { phoneNumberId: string; recipient: string; reason: string };

/** Messages worth answering: text, or the caption/choice that carries text. Everything else is skipped. */
export function parseMessages(payload: MetaPayload): IncomingMessage[] {
  const messages: IncomingMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id;

      if (!phoneNumberId) {
        continue;
      }

      for (const item of change.value?.messages ?? []) {
        if (!item.id || !item.from) {
          continue;
        }

        const body = (
          item.text?.body ??
          item.interactive?.button_reply?.title ??
          item.interactive?.list_reply?.title ??
          item.image?.caption ??
          item.video?.caption ??
          item.document?.caption ??
          ""
        ).trim();

        if (body) {
          messages.push({ phoneNumberId, messageId: item.id, from: item.from.replace(/\D/g, ""), body });
        }
      }
    }
  }

  return messages;
}

/**
 * Meta accepts a send with a 200 and decides afterwards whether it can deliver. A refusal arrives
 * only as a status callback, so failures are read out of these.
 */
export function parseDeliveryFailures(payload: MetaPayload): DeliveryFailure[] {
  const failures: DeliveryFailure[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const phoneNumberId = change.value?.metadata?.phone_number_id;

      for (const status of change.value?.statuses ?? []) {
        if (phoneNumberId && status.status === "failed") {
          const error = status.errors?.[0];

          failures.push({
            phoneNumberId,
            recipient: (status.recipient_id ?? "").replace(/\D/g, ""),
            reason: [error?.code, error?.title ?? error?.message].filter(Boolean).join(" ") || "no reason given"
          });
        }
      }
    }
  }

  return failures;
}

/**
 * Meta signs every delivery with the app secret. Unlike a single-tenant bot that can limp along
 * without it, this endpoint fails closed: an unsigned request could make the bot send messages from
 * any business's number.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.META_APP_SECRET?.trim();

  if (!secret || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(signatureHeader.slice("sha256=".length), "hex");

  // timingSafeEqual throws on a length mismatch, and a malformed hex header decodes short.
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// ---------------------------------------------------------------------------------------------
// Outgoing
// ---------------------------------------------------------------------------------------------

async function post(credentials: Credentials, to: string, payload: Record<string, unknown>, describe: string) {
  const response = await fetch(`${graph()}/${credentials.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload })
  });

  if (!response.ok) {
    throw new Error(`Meta ${describe} failed: ${await response.text()}`);
  }
}

export async function sendText(credentials: Credentials, to: string, body: string) {
  await post(credentials, to, { type: "text", text: { preview_url: false, body } }, "text send");
}

/**
 * Uploads a file to Meta's media store and returns its id.
 *
 * By id rather than by link, because Meta fetches a link only after answering the send: a file it
 * cannot use is acknowledged and then silently dropped. Uploading first moves that failure to a
 * moment where it can be reported. Returns null when the file cannot be read from our storage, so the
 * caller may still try the link.
 */
export async function uploadMedia(credentials: Credentials, link: string, kind: MediaKind, fileName = "") {
  const file = await fetch(link);

  if (!file.ok) {
    console.error("Could not read the file from storage", file.status);
    return null;
  }

  const stored = file.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = metaMediaType(kind, stored, fileName);

  if (kind === "video") {
    const report = inspectMp4(bytes);

    if (report.problems.length > 0) {
      throw new UnusableMediaError(report.problems.join(" "));
    }
  }

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", contentType);
  form.append("file", new Blob([bytes], { type: contentType }), fileName || `file-${kind}`);

  // No Content-Type header: fetch sets the multipart boundary itself.
  const response = await fetch(`${graph()}/${credentials.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.token}` },
    body: form
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Meta media upload failed: ${text}`);
  }

  const id = (JSON.parse(text) as { id?: string }).id;

  if (!id) {
    throw new Error(`Meta media upload returned no id: ${text}`);
  }

  return id;
}

/**
 * One file, as the kind of message WhatsApp knows it as. A voice note sent as a document arrives as
 * something to download rather than press play on, so the kind travels all the way through.
 * Returns true when the file went out as a link instead of an uploaded file (a degraded send).
 */
export async function sendMedia(
  credentials: Credentials,
  to: string,
  kind: MediaKind,
  link: string,
  fileName?: string
) {
  let id: string | null = null;

  // Only the upload is caught. A failed send has already been accepted as far as the media goes, so
  // retrying it by link would post the file twice on errors that are not about the file at all.
  try {
    id = await uploadMedia(credentials, link, kind, fileName);
  } catch (error) {
    if (error instanceof UnusableMediaError) {
      throw error;
    }

    console.error("Meta media upload failed, falling back to the link", error);
  }

  const media: Record<string, unknown> = id ? { id } : { link };

  if (kind === "document") {
    media.filename = fileName || "file.pdf";
  }

  await post(credentials, to, { type: kind, [kind]: media }, `${kind} send`);

  return { viaLink: !id };
}
