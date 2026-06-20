import { X } from "lucide-react";

/**
 * Shared legal modals (Privacy + Terms), extracted from the main menu so they
 * can also be opened from the Login screen. Markup, copy and styling are kept
 * identical to the original in-menu modals.
 */

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.88)", backdropFilter: "blur(12px)" }}
      onClick={onClose}>
      <div
        dir="rtl"
        className="fixed top-0 inset-x-0 z-[60] flex items-center justify-between px-4 md:px-8 lg:px-12 py-4 pointer-events-none">
        <button
          onClick={onClose}
          className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full text-white/70 hover:text-white transition-colors active:scale-90"
          style={{ backgroundColor: "rgba(13,13,13,0.55)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
          <X size={18} strokeWidth={2} />
        </button>
      </div>
      <div
        dir="rtl"
        className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl rounded-2xl p-6 flex flex-col gap-4 shadow-2xl overflow-y-auto max-h-[80vh]"
        style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className="font-black text-base text-white">{title}</span>
        </div>
        <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.06)" }} />
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-right" style={{ color: "#AAAAAA" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PrivacyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <ModalShell title="سياسة الخصوصية" onClose={onClose}>
      <div className="space-y-4">
        <p><span className="text-white font-bold">١. البيانات الأساسية:</span> نجمع فقط اللي نحتاجه (إيميلك واسمك) عشان نحفظ تقدمك ومشترياتك.</p>
        <p><span className="text-white font-bold">٢. المدفوعات الآمنة:</span> ما نحفظ أرقام بطاقتك أبداً. الدفع يتم بشكل آمن ومشفّر عبر بوابات دفع معتمدة.</p>
        <p><span className="text-white font-bold">٣. بدون إعلانات وتتبع:</span> اللعبة خالية تماماً من الإعلانات. ما نتبع نشاطك، ولا نبيع أو نشارك بياناتك مع أي طرف ثالث.</p>
        <p><span className="text-white font-bold">٤. حذف الحساب:</span> لك الحرية الكاملة في حذف حسابك وكل بياناتك نهائياً وفي أي وقت، بضغطة زر من (الملف الشخصي) داخل اللعبة.</p>
      </div>
    </ModalShell>
  );
}

export function TermsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <ModalShell title="الشروط والأحكام" onClose={onClose}>
      <div className="space-y-4">
        <p><span className="text-white font-bold">١. القبول:</span> استخدامك للعبة &quot;القناع&quot; يعني موافقتك على هذي الشروط.</p>
        <p><span className="text-white font-bold">٢. مسؤولية الحساب:</span> أنت المسؤول عن حماية بيانات دخولك لأي نشاط يصير بحسابك.</p>
        <p><span className="text-white font-bold">٣. المشتريات الرقمية:</span> لأن الباقات والميزات الإضافية تتفعل لك فوراً بعد الشراء، المبالغ المدفوعة نهائية وغير قابلة للاسترداد.</p>
        <p><span className="text-white font-bold">٤. اللعب النظيف:</span> اللعبة مصممة للمتعة والتحدي بين الأصدقاء. يُمنع التلاعب بالنظام أو استغلال الثغرات للحصول على ميزات غير مستحقة.</p>
        <p><span className="text-white font-bold">٥. حقوق الملكية:</span> اسم &quot;القناع&quot; وتصاميمها وشخصياتها حقوق محفوظة، ويُمنع نسخها أو استخدامها لأغراض تجارية.</p>
      </div>
    </ModalShell>
  );
}
