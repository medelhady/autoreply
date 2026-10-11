"use client";

import { createClient } from "@supabase/supabase-js";
import { useState, type CSSProperties, type FormEvent } from "react";
import { mediaKindFor, mediaKindLabels, mediaSizeLimits, type MediaKind } from "@/lib/media-kinds";

const field: CSSProperties = { display: "block", width: "100%", padding: 10, margin: "4px 0 14px", fontSize: 16, boxSizing: "border-box" };

type Attachment = { type: MediaKind; path: string; name: string };

async function postJson(url: string, payload: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return (await response.json()) as { ok: boolean; error?: string; [key: string]: unknown };
}

export default function SetupPage() {
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  async function uploadFiles(adminSecret: string, phoneNumberId: string): Promise<Attachment[]> {
    if (files.length === 0) {
      return [];
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      throw new Error("ناقص متغير NEXT_PUBLIC_SUPABASE_ANON_KEY في Vercel (ثم أعد النشر).");
    }

    const storage = createClient(url, anonKey, { auth: { persistSession: false } }).storage.from("rule-media");
    const uploaded: Attachment[] = [];

    for (const [index, file] of files.entries()) {
      setStatus({ ok: true, message: `جارٍ رفع الملف ${index + 1} من ${files.length}: ${file.name}` });

      const ticket = await postJson("/api/admin/upload-url", {
        adminSecret,
        phoneNumberId,
        fileName: file.name,
        contentType: file.type,
        size: file.size
      });

      if (!ticket.ok) {
        throw new Error(`${file.name}: ${ticket.error ?? "رفض الخادم الملف."}`);
      }

      const { error } = await storage.uploadToSignedUrl(String(ticket.path), String(ticket.token), file, {
        contentType: file.type || undefined
      });

      if (error) {
        throw new Error(`${file.name}: ${error.message}`);
      }

      uploaded.push({ type: ticket.kind as MediaKind, path: String(ticket.path), name: file.name });
    }

    return uploaded;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;

    try {
      const ruleAttachments = await uploadFiles(values.adminSecret, values.phoneNumberId);

      setStatus({ ok: true, message: "جارٍ الحفظ..." });

      const result = await postJson("/api/admin/business", { ...values, ruleAttachments });

      setStatus(
        result.ok
          ? { ok: true, message: result.ruleSaved ? "تم حفظ النشاط والقاعدة ✅" : "تم حفظ النشاط ✅" }
          : { ok: false, message: result.error ?? "فشل الحفظ." }
      );
    } catch (error) {
      setStatus({ ok: false, message: error instanceof Error ? error.message : "تعذّر الاتصال بالخادم." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>ربط رقم واتساب لنشاط</h1>
      <p>صفحة إدارة مؤقتة إلى أن تكتمل لوحة العميل.</p>

      <form onSubmit={submit}>
        <label>
          كلمة مرور الإدارة (ADMIN_SECRET)
          <input name="adminSecret" type="password" required autoComplete="off" style={field} />
        </label>

        <h2>النشاط</h2>
        <label>
          اسم النشاط
          <input name="name" required style={field} />
        </label>
        <label>
          معرّف رقم واتساب (Phone number ID)
          <input name="phoneNumberId" required inputMode="numeric" style={field} />
        </label>
        <label>
          رمز الوصول (Access token)
          <input name="token" type="password" required autoComplete="off" style={field} />
        </label>
        <label>
          الرقم كما يراه الناس (اختياري)
          <input name="displayPhone" style={field} />
        </label>
        <label>
          الرد عند عدم وجود قاعدة مطابقة، مثل القائمة (اختياري)
          <textarea name="fallbackText" rows={3} style={field} />
        </label>

        <h2>قاعدة جديدة (اختياري)</h2>
        <label>
          اسم القاعدة
          <input name="ruleName" style={field} />
        </label>
        <label>
          كلمات التشغيل، مفصولة بفاصلة (كلمة 3 حروف فأكثر، أو رقم مثل 1)
          <input name="ruleKeywords" style={field} />
        </label>
        <label>
          نص الرد
          <textarea name="ruleReply" rows={3} style={field} />
        </label>

        <label>
          مرفقات الرد: صورة أو صوت أو فيديو أو ملف (اختياري)
          <input
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            style={field}
          />
        </label>
        {files.length > 0 ? (
          <ol style={{ marginTop: -6 }}>
            {files.map((file) => {
              const kind = mediaKindFor(file.type, file.name);
              const tooBig = file.size > mediaSizeLimits[kind];

              return (
                <li key={`${file.name}-${file.size}`} style={{ color: tooBig ? "crimson" : undefined }}>
                  {mediaKindLabels[kind].icon} {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                  {tooBig ? ` — أكبر من حد واتساب (${Math.round(mediaSizeLimits[kind] / (1024 * 1024))} MB)` : ""}
                </li>
              );
            })}
          </ol>
        ) : null}
        <p style={{ fontSize: 14, color: "#555" }}>
          تُرسل المرفقات بترتيبها ثم النص. حدود واتساب: صورة 5 MB، فيديو وصوت 16 MB. الفيديو بصيغة mp4 (H.264).
          ولتظهر الرسالة الصوتية كتسجيل صوتي استخدم ملف ogg/opus.
        </p>

        <button type="submit" disabled={busy} style={{ padding: "10px 20px", fontSize: 16 }}>
          {busy ? "جارٍ التنفيذ..." : "حفظ"}
        </button>
      </form>

      {status ? (
        <p role="status" style={{ marginTop: 16, color: status.ok ? "green" : "crimson" }}>
          {status.message}
        </p>
      ) : null}
    </main>
  );
}
