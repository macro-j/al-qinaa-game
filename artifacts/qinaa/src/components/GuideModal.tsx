import { VenetianMask, BookOpen, X } from "lucide-react";

/**
 * "شرح اللعبة" — public game guide. Self-contained so it can be shown both on
 * the unauthenticated Landing page and from the authenticated GameModeSelector.
 * Pure presentational content (objective + roles); no gameplay logic.
 */

const MAIN_ROLES = [
  { label: "الولد", color: "#D32F2F", desc: "القاتل، يختار ضحية كل ليلة ويحاول البقاء مجهولًا." },
  { label: "الإكة", color: "#B71C1C", desc: "الكاتم، تسكت لاعبًا وتمنعه من الكلام صباحًا." },
  { label: "الشايب", color: "#FF8F00", desc: "العرّاف، يكشف هوية لاعبًا كل ليلة، مافيا أم بريء." },
  { label: "البنت", color: "#1565C0", desc: "الحارس، تحمي لاعبًا من القتل تلك الليلة." },
];

const EXPANSION_ROLES = [
  { label: "المجنون", color: "#E879F9", desc: "لاعب مستقل، هدفه إقناع المجلس بالتصويت ضده وإعدامه في النهار ليفوز وحده وتخسر القرية." },
  { label: "التوأم", color: "#22D3EE", desc: "قرويان يثقان ببعضهما ويظهران لبعضهما بالليلة الأولى، وإذا مات أحدهما مات الآخر حزناً." },
  { label: "المنتقم", color: "#F59E0B", desc: "قروي يملك فرصة للرد، إذا قُتل أو أُعدم يختار لاعباً ليأخذه معه للقبر." },
  { label: "الساحر", color: "#84CC16", desc: "يملك جرعة حياة لإنقاذ ضحية المافيا، وجرعة سم للتخلص من أي لاعب." },
];

export function GuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.88)" }}
      onClick={onClose}>

      {/* Top navbar — single right-side X, taps fall through to backdrop */}
      <div
        dir="rtl"
        className="fixed top-0 inset-x-0 z-[60] flex items-center justify-between px-4 md:px-8 lg:px-12 py-4 pointer-events-none">
        <button
          onClick={onClose}
          title="إغلاق"
          aria-label="إغلاق شرح اللعبة"
          className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full text-white/70 hover:text-white transition-colors active:scale-90"
          style={{
            backgroundColor: "rgba(13,13,13,0.55)",
            border: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}>
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      <div
        className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl rounded-2xl flex flex-col gap-4 p-5 overflow-y-auto max-h-[90vh] font-sans"
        style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A" }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2">
          <BookOpen size={18} color="#D32F2F" />
          <span className="font-black text-base" style={{ color: "#ffffff" }}>شرح اللعبة</span>
        </div>

        {/* Objective — featured card */}
        <div className="rounded-xl px-4 py-4 flex flex-col gap-2"
          style={{ backgroundColor: "#0D0D0D", border: "1px solid #2A2A2A" }}>
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#D32F2F" }}>الهدف</span>
          <p className="text-sm leading-relaxed text-right" style={{ color: "#CCCCCC" }}>
            أنت في قرية غامضة، لكل فريق هدف واحد:
          </p>
          <p className="text-sm leading-relaxed text-right" style={{ color: "#AAAAAA" }}>
            • الشعب: اكشفوا المافيا وصوّتوا ضدهم للنجاة.
          </p>
          <p className="text-sm leading-relaxed text-right" style={{ color: "#AAAAAA" }}>
            • المافيا: تصفية الشعب والسيطرة على القرية دون الانكشاف.
          </p>
        </div>

        {/* Main roles */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#555555" }}>الأدوار الرئيسية</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MAIN_ROLES.map((r) => (
              <div
                key={r.label}
                className="rounded-xl p-4 flex flex-col gap-3 transition-colors duration-200"
                style={{ backgroundColor: "#0D0D0D", border: "1px solid #222222" }}>
                <div className="flex items-center justify-between">
                  <span className="font-black text-sm" style={{ color: r.color }}>{r.label}</span>
                  <VenetianMask size={16} color={r.color} strokeWidth={1.6} className="flex-shrink-0 opacity-80" />
                </div>
                <span className="text-xs leading-relaxed text-right" style={{ color: "#888888" }}>{r.desc}</span>
              </div>
            ))}
            {/* المواطن — dimmed card, no special power */}
            <div
              className="rounded-xl p-4 flex flex-col gap-3 transition-colors duration-200"
              style={{ backgroundColor: "#0D0D0D", border: "1px solid #1A1A1A" }}>
              <div className="flex items-center justify-between">
                <span className="font-black text-sm" style={{ color: "#666666" }}>المواطن</span>
                <VenetianMask size={16} color="#444444" strokeWidth={1.6} className="flex-shrink-0" />
              </div>
              <span className="text-xs leading-relaxed text-right" style={{ color: "#555555" }}>من الشعب، لا سلطة ليلية، يعتمد على النقاش والتصويت لكشف المافيا.</span>
            </div>
          </div>
        </div>

        {/* Expansion roles */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#555555" }}>أدوار الإضافات</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXPANSION_ROLES.map(({ label, color, desc }) => (
              <div
                key={label}
                className="rounded-xl p-4 flex flex-col gap-3 transition-colors duration-200"
                style={{ backgroundColor: "#0D0D0D", border: "1px solid #222222" }}>
                <div className="flex items-center justify-between">
                  <span className="font-black text-sm" style={{ color }}>{label}</span>
                  <VenetianMask size={16} color={color} strokeWidth={1.6} className="flex-shrink-0 opacity-80" />
                </div>
                <span className="text-xs leading-relaxed text-right" style={{ color: "#888888" }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
