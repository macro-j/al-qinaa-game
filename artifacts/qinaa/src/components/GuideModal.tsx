import { useState } from "react";
import { VenetianMask, BookOpen, X, Moon, Sun } from "lucide-react";

/**
 * "شرح اللعبة" — public game guide. Self-contained so it can be shown both on
 * the unauthenticated Landing page and from the authenticated GameModeSelector.
 * Pure presentational content (objective + phases + roles); no gameplay logic.
 */

type Team = "mafia" | "village" | "solo";

const TEAM_STYLE: Record<Team, { label: string; dot: string; color: string; bg: string; border: string }> = {
  mafia: { label: "المافيا", dot: "🔴", color: "#F87171", bg: "rgba(211,47,47,0.12)", border: "rgba(211,47,47,0.35)" },
  village: { label: "القرية", dot: "🟢", color: "#4ADE80", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.35)" },
  solo: { label: "مستقل", dot: "🟡", color: "#FBBF24", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)" },
};

type Role = { label: string; color: string; team: Team; desc: string };

const MAIN_ROLES: Role[] = [
  { label: "الولد", color: "#D32F2F", team: "mafia", desc: "القاتل، يختار ضحية كل ليلة ويبقى مجهولًا." },
  { label: "الإكة", color: "#B71C1C", team: "mafia", desc: "الكاتم، تُسكت لاعبًا وتمنعه من الكلام صباحًا." },
  { label: "الشايب", color: "#FF8F00", team: "village", desc: "العرّاف، يكشف هوية لاعب كل ليلة: مافيا أم بريء." },
  { label: "البنت", color: "#1565C0", team: "village", desc: "الحارس، تحمي لاعبًا من القتل تلك الليلة." },
  { label: "المواطن", color: "#777777", team: "village", desc: "لا سلطة ليلية، يعتمد على النقاش والتصويت لكشف المافيا." },
];

const EXPANSION_ROLES: Role[] = [
  { label: "المجنون", color: "#E879F9", team: "solo", desc: "يفوز وحده إذا أقنع المجلس بإعدامه نهارًا." },
  { label: "التوأم", color: "#22D3EE", team: "village", desc: "قرويان يعرفان بعضهما، وإذا مات أحدهما مات الآخر حزنًا." },
  { label: "المنتقم", color: "#F59E0B", team: "village", desc: "إذا قُتل أو أُعدم، يأخذ لاعبًا معه إلى القبر." },
  { label: "الساحر", color: "#84CC16", team: "village", desc: "يملك جرعة حياة لإنقاذ ضحية، وجرعة سم للقتل." },
];

function RoleCard({ label, color, team, desc }: Role) {
  const t = TEAM_STYLE[team];
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2.5 transition-colors duration-200"
      style={{ backgroundColor: "#0D0D0D", border: `1px solid ${color}22` }}>
      <div className="flex items-center justify-between">
        <div style={{ filter: `drop-shadow(0 0 10px ${color}55)` }}>
          <VenetianMask size={30} color={color} strokeWidth={1.4} />
        </div>
        <span
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ backgroundColor: t.bg, color: t.color, border: `1px solid ${t.border}` }}>
          {t.dot} {t.label}
        </span>
      </div>
      <span className="font-black text-base" style={{ color }}>{label}</span>
      <span className="text-xs leading-relaxed text-right" style={{ color: "#888888" }}>{desc}</span>
    </div>
  );
}

export function GuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<"night" | "day">("night");
  if (!open) return null;

  const isNight = phase === "night";
  const accent = isNight ? "#818CF8" : "#FBBF24";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.88)", backdropFilter: "blur(12px)" }}
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
        dir="rtl"
        className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl rounded-2xl flex flex-col gap-5 p-5 overflow-y-auto max-h-[90vh] font-sans"
        style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-2">
          <BookOpen size={18} color="#D32F2F" />
          <span className="font-black text-base text-white">شرح اللعبة</span>
        </div>

        {/* Objective */}
        <div className="rounded-xl px-4 py-4 flex flex-col gap-2"
          style={{ backgroundColor: "#0D0D0D", border: "1px solid #2A2A2A" }}>
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#D32F2F" }}>الهدف</span>
          <p className="text-sm leading-relaxed" style={{ color: "#AAAAAA" }}>
            <span className="text-white font-bold">القرية</span> تكشف المافيا وتصوّت ضدها للنجاة، و<span className="text-white font-bold">المافيا</span> تصفّي القرية دون أن تنكشف.
          </p>
        </div>

        {/* Game phases — segmented tabs */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#555555" }}>دورة اللعبة</span>
          <div className="flex gap-1.5 p-1 rounded-xl" style={{ backgroundColor: "#0D0D0D", border: "1px solid #222222" }}>
            <button
              type="button"
              onClick={() => setPhase("night")}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all duration-150 active:scale-[0.98]"
              style={isNight
                ? { backgroundColor: "#16162A", color: "#C7D2FE", border: "1px solid rgba(129,140,248,0.4)" }
                : { color: "#777777", border: "1px solid transparent" }}>
              <Moon size={15} strokeWidth={2} /> الليل
            </button>
            <button
              type="button"
              onClick={() => setPhase("day")}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all duration-150 active:scale-[0.98]"
              style={!isNight
                ? { backgroundColor: "#2A2110", color: "#FDE68A", border: "1px solid rgba(245,158,11,0.4)" }
                : { color: "#777777", border: "1px solid transparent" }}>
              <Sun size={15} strokeWidth={2} /> النهار
            </button>
          </div>
          <div className="rounded-xl px-4 py-4" style={{ backgroundColor: "#0D0D0D", border: `1px solid ${accent}33` }}>
            <p className="text-sm leading-relaxed text-right" style={{ color: "#BBBBBB" }}>
              {isNight
                ? "تُطفأ الأنوار وتستيقظ الأدوار الخاصة سرًّا: المافيا تختار ضحيتها، العرّاف يكشف هويةً، والحارس يحمي لاعبًا — كل ذلك في صمتٍ تام."
                : "تشرق الشمس ويُعلَن من سقط في الليل. يبدأ النقاش والاتهامات، يدافع كل متهمٍ عن نفسه، ثم يصوّت المجلس لإعدام المشتبه به."}
            </p>
          </div>
        </div>

        {/* Main roles */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#555555" }}>الأدوار الرئيسية</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MAIN_ROLES.map((r) => <RoleCard key={r.label} {...r} />)}
          </div>
        </div>

        {/* Expansion roles */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#555555" }}>أدوار الإضافات</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXPANSION_ROLES.map((r) => <RoleCard key={r.label} {...r} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
