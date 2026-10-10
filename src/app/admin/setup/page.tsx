"use client";

import { useState, type CSSProperties, type FormEvent } from "react";

const field: CSSProperties = { display: "block", width: "100%", padding: 10, margin: "4px 0 14px", fontSize: 16, boxSizing: "border-box" };

export default function SetupPage() {
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/admin/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      const result = (await response.json()) as { ok: boolean; error?: string; ruleSaved?: boolean };

      setStatus(
        result.ok
          ? { ok: true, message: result.ruleSaved ? "تم حفظ النشاط والقاعدة ✅" : "تم حفظ النشاط ✅" }
          : { ok: false, message: result.error ?? "فشل الحفظ." }
      );
    } catch {
      setStatus({ ok: false, message: "تعذّر الاتصال بالخادم." });
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

        <h2>أول قاعدة (اختياري)</h2>
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

        <button type="submit" disabled={busy} style={{ padding: "10px 20px", fontSize: 16 }}>
          {busy ? "جارٍ الحفظ..." : "حفظ"}
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
