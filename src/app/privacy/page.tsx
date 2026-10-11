import type { CSSProperties } from "react";

export const metadata = { title: "Privacy Policy | سياسة الخصوصية" };

const contact = "medelhady2@gmail.com";
const updated = "2026-10-11";

const page: CSSProperties = { maxWidth: 760, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif", lineHeight: 1.7 };

export default function PrivacyPage() {
  return (
    <main style={page}>
      <section dir="ltr" lang="en">
        <h1>Privacy Policy</h1>
        <p>Last updated: {updated}</p>

        <p>
          Autoreply is a service that lets a business answer its customers&apos; WhatsApp messages automatically.
          When a customer writes a keyword or number to a business&apos;s WhatsApp number, the service replies with the
          text, picture, voice note, video or document that the business has set up for that keyword.
        </p>

        <h2>What we process</h2>
        <ul>
          <li>The customer&apos;s WhatsApp phone number and the text of the messages they send to a business using this service.</li>
          <li>The replies the service sends back, with their delivery status.</li>
          <li>For businesses that use the service: the business name, its WhatsApp phone number ID, the rules and files it uploads, and the access token it gives us to send messages on its behalf. Access tokens are stored encrypted.</li>
        </ul>

        <h2>Why we process it</h2>
        <p>
          Only to match a message to the business&apos;s rules, send the reply, show the business what was sent, and
          keep the service secure and working. We do not sell personal data and we do not use it for advertising.
        </p>

        <h2>Who else receives it</h2>
        <p>
          Messages travel through Meta&apos;s WhatsApp Business Platform. We use Supabase for our database and file
          storage and Vercel for hosting. These providers process data on our behalf to run the service.
        </p>

        <h2>How long we keep it</h2>
        <p>
          Message records are kept while the business uses the service, or until a deletion request is made.
        </p>

        <h2>Your choices and deletion</h2>
        <p>
          To ask what we hold about you, or to have your data deleted, write to{" "}
          <a href={`mailto:${contact}`}>{contact}</a> from the phone number or business concerned. We will respond within
          a reasonable time.
        </p>

        <h2>Contact</h2>
        <p>
          <a href={`mailto:${contact}`}>{contact}</a>
        </p>
      </section>

      <hr style={{ margin: "40px 0" }} />

      <section dir="rtl" lang="ar">
        <h1>سياسة الخصوصية</h1>
        <p>آخر تحديث: {updated}</p>

        <p>
          &quot;Autoreply&quot; خدمة تتيح للنشاط التجاري الرد تلقائياً على رسائل عملائه في واتساب. حين يكتب العميل كلمة أو
          رقماً إلى رقم واتساب النشاط، ترد الخدمة بالنص أو الصورة أو الرسالة الصوتية أو الفيديو أو الملف الذي جهّزه
          النشاط لتلك الكلمة.
        </p>

        <h2>ما الذي نعالجه</h2>
        <ul>
          <li>رقم واتساب العميل ونص الرسائل التي يرسلها إلى النشاط عبر هذه الخدمة.</li>
          <li>الردود التي ترسلها الخدمة وحالة تسليمها.</li>
          <li>
            بالنسبة للأنشطة التي تستخدم الخدمة: اسم النشاط ومعرّف رقم واتساب والقواعد والملفات التي يرفعها ورمز الوصول
            الذي يمنحنا إياه لإرسال الرسائل نيابة عنه. تُحفظ رموز الوصول مشفّرة.
          </li>
        </ul>

        <h2>لماذا نعالجها</h2>
        <p>
          فقط لمطابقة الرسالة مع قواعد النشاط، وإرسال الرد، وإظهار ما أُرسل للنشاط، وللحفاظ على أمان الخدمة وعملها. لا
          نبيع البيانات الشخصية ولا نستخدمها في الإعلانات.
        </p>

        <h2>من يستلمها أيضاً</h2>
        <p>
          تمر الرسائل عبر منصة واتساب للأعمال من Meta. نستخدم Supabase لقاعدة البيانات وتخزين الملفات، وVercel للاستضافة.
          يعالج هؤلاء المزودون البيانات نيابة عنا لتشغيل الخدمة.
        </p>

        <h2>مدة الاحتفاظ</h2>
        <p>تُحفظ سجلات الرسائل ما دام النشاط يستخدم الخدمة، أو حتى يُقدَّم طلب حذف.</p>

        <h2>خياراتك وحذف البيانات</h2>
        <p>
          لمعرفة ما نحتفظ به عنك أو لطلب حذف بياناتك، راسلنا على <a href={`mailto:${contact}`}>{contact}</a> من الرقم أو
          النشاط المعني. سنرد خلال مدة معقولة.
        </p>

        <h2>التواصل</h2>
        <p>
          <a href={`mailto:${contact}`}>{contact}</a>
        </p>
      </section>
    </main>
  );
}
