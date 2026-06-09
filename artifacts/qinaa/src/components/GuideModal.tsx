import { useState } from "react";
import { VenetianMask, BookOpen, X, Moon, Sun, RotateCw, ArrowLeft } from "lucide-react";

/**
 * "شرح اللعبة" — public game guide. Self-contained so it can be shown both on
 * the unauthenticated Landing page and from the authenticated GameModeSelector.
 * Roles are interactive flip cards (front: identity, back: ability); no gameplay
 * logic lives here — purely presentational.
 */

type Team = "mafia" | "village" | "solo";

const TEAM_LABEL: Record<Team, string> = { mafia: "المافيا", village: "القرية", solo: "مستقل" };
const TEAM_BADGE: Record<Team, string> = {
  mafia: "bg-red-900/30 text-red-500 border-red-800",
  village: "bg-green-900/30 text-green-500 border-green-800",
  solo: "bg-amber-900/30 text-amber-500 border-amber-800",
};

type Role = { label: string; color: string; team: Team; desc: string };

const MAIN_ROLES: Role[] = [
  { label: "الولد", color: "#D32F2F", team: "mafia", desc: "يغتال لاعباً واحداً كل ليلة بدم بارد." },
  { label: "الإكة", color: "#B71C1C", team: "mafia", desc: "الكاتم؛ يُسكت لاعباً ويمنعه من الكلام والتصويت في النهار." },
  { label: "الشايب", color: "#FF8F00", team: "village", desc: "العرّاف؛ يكشف هوية لاعب واحد كل ليلة (مافيا أم بريء)." },
  { label: "البنت", color: "#1565C0", team: "village", desc: "الحارس؛ تحمي لاعباً من الاغتيال ليلة واحدة." },
  { label: "المواطن", color: "#9CA3AF", team: "village", desc: "لا يملك قدرة ليلية، سلاحه الوحيد هو الذكاء، النقاش، والتصويت." },
];

const EXPANSION_ROLES: Role[] = [
  { label: "المجنون", color: "#E879F9", team: "solo", desc: "يفوز وحده فقط إذا أقنع المجلس بالتصويت ضده وإعدامه!" },
  { label: "التوأم", color: "#22D3EE", team: "village", desc: "قرويان يعرفان بعضهما.. إذا مات أحدهما، مات الآخر حزناً." },
  { label: "المنتقم", color: "#F59E0B", team: "village", desc: "إذا قُتل، يختار لاعباً ليأخذه معه إلى القبر فوراً." },
  { label: "الساحر", color: "#84CC16", team: "village", desc: "يملك جرعة حياة للإنقاذ، وجرعة سم للقتل (تستخدم مرة واحدة فقط)." },
];

function FlipRoleCard({
  role,
  flipped,
  onFlip,
  onUnflip,
}: {
  role: Role;
  flipped: boolean;
  onFlip: () => void;
  onUnflip: () => void;
}) {
  const { label, color, team, desc } = role;
  return (
    <div dir="rtl" className="h-48 [perspective:1200px]">
      <div
        className="relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>

        {/* ── Front ── icon / name / team badge ── */}
        <button
          type="button"
          onClick={onFlip}
          aria-pressed={flipped}
          aria-label={`عرض قدرة ${label}`}
          className="absolute inset-0 [backface-visibility:hidden] rounded-2xl p-5 flex flex-col items-center justify-center gap-3 text-center transition-colors duration-200 active:scale-[0.98]"
          style={{ backgroundColor: "#0D0D0D", border: `1px solid ${color}33` }}>
          <div style={{ filter: `drop-shadow(0 0 18px ${color}55)` }}>
            <VenetianMask size={44} color={color} strokeWidth={1} />
          </div>
          <span className="text-base font-black" style={{ color }}>{label}</span>
          <span className={`px-2 py-1 rounded-full text-xs font-bold border ${TEAM_BADGE[team]}`}>
            {TEAM_LABEL[team]}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: "#777777" }}>
            <RotateCw size={12} strokeWidth={2} />
            اضغط لكشف القدرة
          </span>
        </button>

        {/* ── Back ── ability description ── */}
        <div
          className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-2xl p-4 flex flex-col gap-2"
          style={{ backgroundColor: "#0D0D0D", border: `1px solid ${color}55` }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-black" style={{ color }}>{label}</span>
            <button
              type="button"
              onClick={onUnflip}
              aria-label="رجوع"
              className="flex items-center justify-center w-7 h-7 rounded-full text-white/50 hover:text-white transition-colors active:scale-90"
              style={{ backgroundColor: "#161616", border: "1px solid #2A2A2A" }}>
              <ArrowLeft size={14} strokeWidth={2} />
            </button>
          </div>
          <p className="flex-1 text-sm leading-relaxed text-right overflow-y-auto" style={{ color: "#BBBBBB" }}>
            {desc}
          </p>
        </div>
      </div>
    </div>
  );
}

export function GuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<"night" | "day">("night");
  // Which role card currently shows its ability (back face).
  const [flippedId, setFlippedId] = useState<string | null>(null);
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
          <p className="text-sm leading-relaxed text-right" style={{ color: "#BBBBBB" }}>
            القرية تحاول كشف المافيا للنجاة، والمافيا تغتال سكان القرية في الظلام.
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
                ? "تُطفأ الأنوار.. تستيقظ المافيا لاختيار الضحية، ويبدأ أصحاب القدرات الخاصة باستخدام قواهم بصمت."
                : "تشرق الشمس.. يبدأ النقاش، الاتهامات، والدفاع عن النفس، وينتهي المجلس بتصويت لإعدام المشتبه به."}
            </p>
          </div>
        </div>

        {/* Main roles — flip cards */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#555555" }}>الأدوار الرئيسية</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MAIN_ROLES.map((r) => (
              <FlipRoleCard
                key={r.label}
                role={r}
                flipped={flippedId === r.label}
                onFlip={() => setFlippedId(r.label)}
                onUnflip={() => setFlippedId(null)}
              />
            ))}
          </div>
        </div>

        {/* Expansion roles — flip cards */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#555555" }}>أدوار الإضافات</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXPANSION_ROLES.map((r) => (
              <FlipRoleCard
                key={r.label}
                role={r}
                flipped={flippedId === r.label}
                onFlip={() => setFlippedId(r.label)}
                onUnflip={() => setFlippedId(null)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
