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
      <p>نحن في «قناع» نحترم خصوصيتكم ونلتزم بحماية بياناتكم وفق أعلى المعايير. توضّح هذه السياسة كيفية تعاملنا مع بياناتكم أثناء استخدام التطبيق وخدماته المدفوعة.</p>
      <p><span className="text-white font-bold">البيانات التي نجمعها:</span> لا نجمع بيانات شخصية تعريفية أثناء اللعب. تُحفظ إعدادات اللعبة وتقدّمكم محلياً على جهازكم عبر localStorage. عند الشراء، تُعالَج بيانات الدفع بأمان من خلال مزوّد بوابة الدفع، ولا نطّلع على بيانات بطاقتكم أو نخزّنها لدينا.</p>
      <p><span className="text-white font-bold">المشتريات والاشتراكات:</span> يوفّر «قناع» تجربة مجانية محدودة بجولتين، إضافةً إلى مشتريات لمرة واحدة تشمل اللعبة الأساسية، وإضافات الأدوار الفردية، وباقة الوصول الشامل (VIP). نحتفظ بسجلّ مشترياتكم لتفعيل المحتوى الذي حصلتم عليه واستعادته عند الحاجة.</p>
      <p><span className="text-white font-bold">ملفات تعريف الارتباط:</span> لا نستخدم ملفات تعريف الارتباط (Cookies) لأغراض التتبّع الإعلاني.</p>
      <p><span className="text-white font-bold">مشاركة البيانات:</span> لا نبيع أو نؤجّر بياناتكم. تقتصر المشاركة على مزوّدي خدمات الدفع والبنية التحتية بالقدر اللازم لإتمام المعاملة وتشغيل الخدمة.</p>
      <p><span className="text-white font-bold">الأمان:</span> نطبّق أفضل الممارسات الأمنية لحماية تجربتكم ومعاملاتكم داخل التطبيق.</p>
      <p><span className="text-white font-bold">التواصل:</span> لأي استفسار حول الخصوصية أو المشتريات، تواصلوا معنا عبر البريد الإلكتروني: qinaa.support@gmail.com</p>
      <p className="text-xs" style={{ color: "#555" }}>آخر تحديث: يونيو 2026</p>
    </ModalShell>
  );
}

export function TermsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <ModalShell title="الشروط والأحكام" onClose={onClose}>
      <p>باستخدامكم تطبيق «قناع»، فإنكم توافقون على الشروط والأحكام التالية:</p>
      <p><span className="text-white font-bold">الاستخدام:</span> التطبيق مخصّص للاستخدام الترفيهي الشخصي في المجالس والتجمعات. يُحظر استخدامه لأي غرض غير قانوني أو إعادة بيعه دون إذن.</p>
      <p><span className="text-white font-bold">التجربة المجانية:</span> يتيح «قناع» تجربة مجانية محدودة بجولتين لاستكشاف أجواء اللعبة قبل الشراء.</p>
      <p><span className="text-white font-bold">المشتريات الرقمية:</span> تشمل المشتريات: اللعبة الأساسية (لعب غير محدود للأدوار الرئيسية)، وإضافات الأدوار الفردية، وباقة الوصول الشامل (VIP) بسعر 29.99 ر.س التي تمنح جميع الأدوار الحالية والمستقبلية مع إزالة الإعلانات. جميعها مشتريات لمرة واحدة ما لم يُذكر خلاف ذلك.</p>
      <p><span className="text-white font-bold">المدفوعات والاسترداد:</span> تُعالَج المدفوعات عبر بوابة دفع آمنة. نظراً للطبيعة الرقمية للمحتوى وتفعيله الفوري بعد الشراء، تكون جميع المبيعات نهائية وغير قابلة للاسترداد إلا في حدود ما يقتضيه القانون المعمول به.</p>
      <p><span className="text-white font-bold">الملكية الفكرية:</span> جميع حقوق الملكية الفكرية لتطبيق «قناع» — التصميم والكود والمحتوى — محفوظة لصانعيه.</p>
      <p><span className="text-white font-bold">إخلاء المسؤولية:</span> التطبيق مقدَّم «كما هو» دون أي ضمانات صريحة أو ضمنية، ولا نتحمل المسؤولية عن أي خسائر ناتجة عن الاستخدام.</p>
      <p><span className="text-white font-bold">التعديلات:</span> نحتفظ بحق تعديل هذه الشروط أو الأسعار أو الباقات في أي وقت. الاستمرار في الاستخدام بعد التعديل يُعدّ قبولاً للشروط الجديدة.</p>
      <p><span className="text-white font-bold">القانون المعمول به:</span> تخضع هذه الشروط للقوانين المعمول بها في مكان الإصدار.</p>
      <p className="text-xs" style={{ color: "#555" }}>آخر تحديث: يونيو 2026</p>
    </ModalShell>
  );
}
