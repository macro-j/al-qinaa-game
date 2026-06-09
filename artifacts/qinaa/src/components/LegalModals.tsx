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
        <p><span className="text-white font-bold">١. البيانات التي نجمعها:</span> نجمع فقط المعلومات الأساسية لإنشاء حسابك (مثل البريد الإلكتروني والاسم) لضمان حفظ تقدمك والمشتريات التي قمت بها.</p>
        <p><span className="text-white font-bold">٢. بيانات الدفع:</span> نحن لا نحتفظ أو نعالج أرقام بطاقتك الائتمانية. تتم معالجة جميع المدفوعات بشكل آمن ومشفّر عبر بوابات الدفع المعتمدة.</p>
        <p><span className="text-white font-bold">٣. تجربة خالية من الإعلانات:</span> التزاماً منا بأفضل تجربة، 'القناع' خالية تماماً من الإعلانات. هذا يعني أننا لا نقوم بتتبع نشاطك أو بيع بياناتك لأي جهات إعلانية أو أطراف ثالثة.</p>
        <p><span className="text-white font-bold">٤. أمان البيانات:</span> نستخدم أحدث تقنيات التشفير لحماية بياناتك من الوصول غير المصرح به.</p>
        <p><span className="text-white font-bold">٥. حذف الحساب:</span> يحق لك المطالبة بحذف حسابك وكافة بياناتك المرتبطة به في أي وقت عبر التواصل مع الدعم الفني.</p>
      </div>
    </ModalShell>
  );
}

export function TermsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <ModalShell title="الشروط والأحكام" onClose={onClose}>
      <div className="space-y-4">
        <p><span className="text-white font-bold">١. قبول الشروط:</span> باستخدامك للعبة 'القناع'، فإنك توافق على هذه الشروط والأحكام بالكامل.</p>
        <p><span className="text-white font-bold">٢. الحسابات:</span> أنت مسؤول عن الحفاظ على سرية بيانات الدخول الخاصة بك. أي نشاط يحدث تحت حسابك هو مسؤوليتك الشخصية.</p>
        <p><span className="text-white font-bold">٣. المشتريات الرقمية:</span> توفر اللعبة باقات وأدواراً إضافية للشراء. نظراً لطبيعة المنتجات الرقمية والتفعيل الفوري، فإن جميع عمليات الشراء نهائية وغير قابلة للاسترداد.</p>
        <p><span className="text-white font-bold">٤. قواعد اللعب:</span> صُممت 'القناع' للمتعة والتحدي بين الأصدقاء. يُمنع استخدام أي برامج خارجية أو ثغرات للتلاعب بنظام اللعبة أو استحقاق الباقات.</p>
        <p><span className="text-white font-bold">٥. حقوق الملكية:</span> 'القناع' وشعاراتها وتصاميمها هي حقوق ملكية فكرية وعلامة تجارية مسجلة، ولا يُسمح بنسخها أو إعادة استخدامها تجارياً.</p>
      </div>
    </ModalShell>
  );
}
