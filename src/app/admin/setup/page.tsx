"use client";

import { createClient } from "@supabase/supabase-js";
import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { maxAttachments, mediaKindFor, mediaKindLabels, mediaSizeLimits, type MediaKind } from "@/lib/media-kinds";

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
  const [panelLink, setPanelLink] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  function addFiles(picked: FileList | null) {
    // Copied out of the FileList first: it is a live view of the input, and clearing the input below
    // empties it before React runs the update, which silently dropped every file after the first.
    const added = picked ? Array.from(picked) : [];

    const accepted = added.slice(0, Math.max(maxAttachments - files.length, 0));

    if (accepted.length > 0) {
      setFiles((current) => [...current, ...accepted]);
    }

    if (accepted.length < added.length) {
      setStatus({ ok: false, message: `الحد الأقصى ${maxAttachments} مرفقات للقاعدة الواحدة، فلم تُضَف الملفات الزائدة.` });
    }

    // Cleared so the same file can be picked again, and so the next pick adds to the list.
    if (picker.current) {
      picker.current.value = "";
    }
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, position) => position !== index));
  }

  function moveFile(index: number, direction: -1 | 1) {
    setFiles((current) => {
      const target = index + direction;

      if (target < 0 || target >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];

      return next;
    });
  }

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

      setPanelLink(result.ok && result.panelKey ? `${window.location.origin}/panel/${String(result.panelKey)}` : "");
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

        <div style={{ margin: "4px 0 14px" }}>
          <div>مرفقات الرد: صورة أو صوت أو فيديو أو ملف (اختياري)</div>
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
            onChange={(event) => addFiles(event.target.files)}
            style={{ display: "none" }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={files.length >= maxAttachments}
            style={{ padding: "8px 16px", fontSize: 16, marginTop: 6 }}
          >
            ➕ إضافة مرفق
          </button>
        </div>

        {files.length > 0 ? (
          <ol style={{ paddingInlineStart: 22 }}>
            {files.map((file, index) => {
              const kind = mediaKindFor(file.type, file.name);
              const tooBig = file.size > mediaSizeLimits[kind];

              return (
                <li key={`${index}-${file.name}-${file.size}`} style={{ color: tooBig ? "crimson" : undefined, marginBottom: 6 }}>
                  {mediaKindLabels[kind].icon} {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                  {tooBig ? ` — أكبر من حد واتساب (${Math.round(mediaSizeLimits[kind] / (1024 * 1024))} MB)` : ""}{" "}
                  <button type="button" onClick={() => moveFile(index, -1)} disabled={index === 0} aria-label="تقديم">
                    ↑
                  </button>{" "}
                  <button type="button" onClick={() => moveFile(index, 1)} disabled={index === files.length - 1} aria-label="تأخير">
                    ↓
                  </button>{" "}
                  <button type="button" onClick={() => removeFile(index)} aria-label="حذف">
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
        <p style={{ fontSize: 14, color: "#555" }}>
          اضغط «إضافة مرفق» كلما أردت إضافة ملف آخر، من أي نوع، حتى {maxAttachments} مرفقات. تُرسل المرفقات بالترتيب الظاهر ثم النص.
          حدود واتساب لكل ملف: صورة 5 MB، فيديو وصوت 16 MB. الفيديو بصيغة mp4 (H.264). ولتظهر الرسالة الصوتية كتسجيل
          صوتي استخدم ogg/opus.
        </p>

        <button type="submit" disabled={busy} style={{ padding: "10px 20px", fontSize: 16 }}>
          {busy ? "جارٍ التنفيذ..." : "حفظ"}
        </button>
      </form>

      {panelLink ? (
        <p style={{ marginTop: 16 }}>
          رابط لوحة العميل (أرسله له وحده):
          <br />
          <input readOnly value={panelLink} onFocus={(event) => event.target.select()} style={field} />
        </p>
      ) : null}

      {status ? (
        <p role="status" style={{ marginTop: 16, color: status.ok ? "green" : "crimson" }}>
          {status.message}
        </p>
      ) : null}
    </main>
  );
}
