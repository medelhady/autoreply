"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { maxAttachments, mediaKindFor, mediaKindLabels, mediaSizeLimits, type MediaKind } from "@/lib/media-kinds";

/**
 * The customer's panel: one private link, no login. Rules are listed as cards; adding or editing is
 * one short form (what the customer writes, what we answer, which files). Everything else the owner
 * of the number would need -- the Meta side -- is handled for them.
 */

type Attachment = { type: MediaKind; path: string; name: string };

type Rule = {
  id: string;
  name: string;
  keywords: string;
  reply_text: string;
  attachments: Attachment[];
  active: boolean;
  hits: number;
};

/** A file in the form: one already stored with the rule, or one just picked and not yet uploaded. */
type Item = { id: string; stored?: Attachment; file?: File };

type Draft = { id: string | null; keywords: string; replyText: string; items: Item[] };

const box: CSSProperties = { background: "#fff", border: "1px solid #e3e3e3", borderRadius: 12, padding: 16, marginBottom: 14 };
const field: CSSProperties = { display: "block", width: "100%", padding: 12, margin: "6px 0 16px", fontSize: 16, boxSizing: "border-box", borderRadius: 8, border: "1px solid #ccc" };
const primary: CSSProperties = { padding: "12px 20px", fontSize: 16, borderRadius: 8, border: 0, background: "#16a34a", color: "#fff", cursor: "pointer" };
const plain: CSSProperties = { padding: "8px 14px", fontSize: 15, borderRadius: 8, border: "1px solid #ccc", background: "#fff", cursor: "pointer" };

let counter = 0;
const nextId = () => `item-${(counter += 1)}`;

async function call(url: string, method: string, payload?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });

  return (await response.json()) as { ok: boolean; error?: string; [key: string]: unknown };
}

export default function PanelPage({ params }: { params: { key: string } }) {
  const base = `/api/panel/${params.key}`;
  const [loaded, setLoaded] = useState<"loading" | "ready" | "missing">("loading");
  const [businessName, setBusinessName] = useState("");
  const [fallback, setFallback] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await call(`${base}/rules`, "GET");

      if (!result.ok) {
        setLoaded("missing");
        return;
      }

      const business = result.business as { name: string; fallbackText: string };
      setBusinessName(business.name);
      setFallback(business.fallbackText);
      setRules(result.rules as Rule[]);
      setLoaded("ready");
    } catch {
      setLoaded("missing");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setMessage(null);
    setDraft({ id: null, keywords: "", replyText: "", items: [] });
  }

  function openEdit(rule: Rule) {
    setMessage(null);
    setDraft({
      id: rule.id,
      keywords: rule.keywords,
      replyText: rule.reply_text,
      items: (rule.attachments ?? []).map((stored) => ({ id: nextId(), stored }))
    });
  }

  function addFiles(picked: FileList | null) {
    // Copied before the input is cleared: a FileList is a live view of the input.
    const added = picked ? Array.from(picked) : [];

    const accepted = added.slice(0, Math.max(maxAttachments - (draft?.items.length ?? 0), 0));

    if (accepted.length > 0) {
      setDraft((current) => (current ? { ...current, items: [...current.items, ...accepted.map((file) => ({ id: nextId(), file }))] } : current));
    }

    if (accepted.length < added.length) {
      setMessage({ ok: false, text: `الحد الأقصى ${maxAttachments} ملفات للرد الواحد، فلم تُضَف الملفات الزائدة.` });
    }

    if (picker.current) {
      picker.current.value = "";
    }
  }

  function moveItem(index: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.items.length) return current;
      const items = [...current.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...current, items };
    });
  }

  function removeItem(index: number) {
    setDraft((current) => (current ? { ...current, items: current.items.filter((_, position) => position !== index) } : current));
  }

  async function uploadNew(file: File, position: number, total: number): Promise<Attachment> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      throw new Error("إعدادات الرفع ناقصة. تواصل مع الدعم.");
    }

    setMessage({ ok: true, text: `جارٍ رفع الملف ${position} من ${total}: ${file.name}` });

    const ticket = await call(`${base}/upload-url`, "POST", { fileName: file.name, contentType: file.type, size: file.size });

    if (!ticket.ok) {
      throw new Error(`${file.name}: ${ticket.error ?? "رُفض الملف."}`);
    }

    const storage = createClient(url, anonKey, { auth: { persistSession: false } }).storage.from("rule-media");
    const { error } = await storage.uploadToSignedUrl(String(ticket.path), String(ticket.token), file, { contentType: file.type || undefined });

    if (error) {
      throw new Error(`${file.name}: ${error.message}`);
    }

    return { type: ticket.kind as MediaKind, path: String(ticket.path), name: file.name };
  }

  async function save() {
    if (!draft) return;

    setBusy(true);
    setMessage(null);

    try {
      const newFiles = draft.items.filter((item) => item.file).length;
      let done = 0;
      const attachments: Attachment[] = [];

      for (const item of draft.items) {
        if (item.stored) {
          attachments.push(item.stored);
        } else if (item.file) {
          done += 1;
          attachments.push(await uploadNew(item.file, done, newFiles));
        }
      }

      setMessage({ ok: true, text: "جارٍ الحفظ..." });

      const payload = { keywords: draft.keywords, replyText: draft.replyText, attachments };
      const result = draft.id ? await call(`${base}/rules/${draft.id}`, "PATCH", payload) : await call(`${base}/rules`, "POST", payload);

      if (!result.ok) {
        throw new Error(result.error ?? "فشل الحفظ.");
      }

      setDraft(null);
      setMessage({ ok: true, text: "تم الحفظ ✅" });
      await load();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "تعذّر الاتصال." });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: Rule) {
    const result = await call(`${base}/rules/${rule.id}`, "PATCH", { active: !rule.active });
    setMessage(result.ok ? null : { ok: false, text: result.error ?? "تعذّر التحديث." });
    await load();
  }

  async function remove(rule: Rule) {
    if (!window.confirm(`حذف هذا الرد نهائياً؟\n«${rule.keywords}»`)) return;

    const result = await call(`${base}/rules/${rule.id}`, "DELETE");
    setMessage(result.ok ? { ok: true, text: "تم الحذف." } : { ok: false, text: result.error ?? "تعذّر الحذف." });
    await load();
  }

  async function saveFallback() {
    setBusy(true);
    const result = await call(`${base}/settings`, "PATCH", { fallbackText: fallback });
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: "تم حفظ رسالة الترحيب ✅" } : { ok: false, text: result.error ?? "تعذّر الحفظ." });
  }

  if (loaded === "loading") {
    return <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>جارٍ التحميل...</main>;
  }

  if (loaded === "missing") {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1>الرابط غير صحيح</h1>
        <p>تأكد أنك نسخت الرابط كاملاً كما وصلك، أو اطلب رابطاً جديداً.</p>
      </main>
    );
  }

  const messageCount = draft ? draft.items.length + (draft.replyText.trim() ? 1 : 0) : 0;

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif", background: "#f6f7f8", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 24 }}>{businessName}</h1>
      <p style={{ color: "#555", marginTop: 0 }}>اكتب هنا ما يرسله العميل على واتساب، وما تريد أن يصله من رد.</p>

      {message ? (
        <p role="status" style={{ ...box, color: message.ok ? "#15803d" : "#b91c1c", borderColor: message.ok ? "#bbf7d0" : "#fecaca" }}>
          {message.text}
        </p>
      ) : null}

      {draft ? (
        <section style={box}>
          <h2 style={{ marginTop: 0 }}>{draft.id ? "تعديل الرد" : "رد جديد"}</h2>

          <label>
            ماذا يكتب العميل؟ (كلمة أو رقم، ويمكن عدة كلمات بفاصلة)
            <input
              value={draft.keywords}
              onChange={(event) => setDraft({ ...draft, keywords: event.target.value })}
              placeholder="مثال: 1 ، العروض"
              style={field}
            />
          </label>

          <label>
            نص الرد (اختياري إن أضفت ملفاً)
            <textarea value={draft.replyText} onChange={(event) => setDraft({ ...draft, replyText: event.target.value })} rows={4} style={field} />
          </label>

          <div>الملفات: صورة أو صوت أو فيديو أو مستند</div>
          <input ref={picker} type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={(event) => addFiles(event.target.files)} style={{ display: "none" }} />
          <button type="button" onClick={() => picker.current?.click()} disabled={draft.items.length >= maxAttachments} style={{ ...plain, margin: "8px 0 12px" }}>
            ➕ إضافة ملف
          </button>

          {draft.items.length > 0 ? (
            <ol style={{ paddingInlineStart: 22 }}>
              {draft.items.map((item, index) => {
                const name = item.stored?.name || item.file?.name || "ملف";
                const kind: MediaKind = item.stored ? item.stored.type : mediaKindFor(item.file?.type ?? "", item.file?.name ?? "");
                const tooBig = item.file ? item.file.size > mediaSizeLimits[kind] : false;

                return (
                  <li key={item.id} style={{ marginBottom: 8, color: tooBig ? "#b91c1c" : undefined }}>
                    {mediaKindLabels[kind].icon} {name}
                    {item.file ? ` (${(item.file.size / (1024 * 1024)).toFixed(1)} MB)` : ""}
                    {tooBig ? ` — أكبر من حد واتساب (${Math.round(mediaSizeLimits[kind] / (1024 * 1024))} MB)` : ""}{" "}
                    <button type="button" onClick={() => moveItem(index, -1)} disabled={index === 0} aria-label="تقديم">↑</button>{" "}
                    <button type="button" onClick={() => moveItem(index, 1)} disabled={index === draft.items.length - 1} aria-label="تأخير">↓</button>{" "}
                    <button type="button" onClick={() => removeItem(index)} aria-label="حذف">✕</button>
                  </li>
                );
              })}
            </ol>
          ) : null}

          <p style={{ fontSize: 14, color: "#555" }}>
            تصل الملفات بالترتيب الظاهر ثم النص (حتى {maxAttachments} ملفات). هذا الرد = <b>{messageCount}</b> {messageCount === 1 ? "رسالة" : "رسائل"} لكل شخص (كل ملف رسالة، والنص رسالة).
            قلّة الرسائل تقلل تكلفة واتساب. الحد: صورة 5MB، فيديو وصوت 16MB.
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={save} disabled={busy} style={primary}>
              {busy ? "جارٍ التنفيذ..." : "حفظ"}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={busy} style={plain}>
              إلغاء
            </button>
          </div>
        </section>
      ) : (
        <button type="button" onClick={openNew} style={{ ...primary, marginBottom: 16 }}>
          ➕ رد جديد
        </button>
      )}

      {rules.length === 0 && !draft ? <p style={{ color: "#555" }}>لا توجد ردود بعد. اضغط «رد جديد» لتبدأ.</p> : null}

      {rules.map((rule) => (
        <section key={rule.id} style={{ ...box, opacity: rule.active ? 1 : 0.6 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>العميل يكتب: {rule.keywords}</div>
          <div style={{ color: "#444", margin: "8px 0", whiteSpace: "pre-wrap" }}>
            {rule.reply_text ? (rule.reply_text.length > 140 ? `${rule.reply_text.slice(0, 140)}…` : rule.reply_text) : "(بدون نص)"}
          </div>
          <div style={{ color: "#666", fontSize: 14, marginBottom: 10 }}>
            {(rule.attachments ?? []).length > 0 ? `${(rule.attachments ?? []).map((file) => mediaKindLabels[file.type]?.icon ?? "📄").join(" ")} · ` : ""}
            وصل إلى {rule.hits} شخص
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => openEdit(rule)} style={plain}>تعديل</button>
            <button type="button" onClick={() => toggle(rule)} style={plain}>{rule.active ? "إيقاف" : "تشغيل"}</button>
            <button type="button" onClick={() => remove(rule)} style={{ ...plain, color: "#b91c1c" }}>حذف</button>
          </div>
        </section>
      ))}

      <section style={box}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>رسالة الترحيب</h2>
        <p style={{ color: "#555", marginTop: 0 }}>تُرسل عندما يكتب العميل شيئاً لا يطابق أي رد، مثل «مرحبا». اكتب فيها القائمة ليعرف ماذا يكتب. اتركها فارغة ليبقى البوت صامتاً.</p>
        <textarea value={fallback} onChange={(event) => setFallback(event.target.value)} rows={4} style={field} />
        <button type="button" onClick={saveFallback} disabled={busy} style={plain}>حفظ رسالة الترحيب</button>
      </section>
    </main>
  );
}
