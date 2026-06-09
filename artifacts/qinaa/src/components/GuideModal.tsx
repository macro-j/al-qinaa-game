import { useState } from "react";
import { BookOpen, X, Moon, Sun } from "lucide-react";
import { RoleRevealCard } from "./RoleRevealCard";
import { MAIN_ROLE_KEYS, EXPANSION_ROLE_KEYS } from "../lib/roles";

/**
 * "شرح اللعبة" — public game guide. Self-contained so it can be shown both on
 * the unauthenticated Landing page and from the authenticated GameModeSelector.
 * Roles use the shared RoleRevealCard (identical to the in-game reveal card),
 * and all role text comes from ./lib/roles — no copy is authored here.
 */
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
        className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl rounded-2xl flex flex-col gap-5 p-5 overflow-y-auto max-h-[90vh]"
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

        {/* Game phases — segmented tabs (text first, icon to the LEFT for RTL) */}
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
              <span>الليل</span>
              <Moon size={15} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => setPhase("day")}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all duration-150 active:scale-[0.98]"
              style={!isNight
                ? { backgroundColor: "#2A2110", color: "#FDE68A", border: "1px solid rgba(245,158,11,0.4)" }
                : { color: "#777777", border: "1px solid transparent" }}>
              <span>النهار</span>
              <Sun size={15} strokeWidth={2} />
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

        {/* Main roles — in-game reveal cards */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#555555" }}>الأدوار الرئيسية</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MAIN_ROLE_KEYS.map((key) => <RoleRevealCard key={key} roleKey={key} />)}
          </div>
        </div>

        {/* Expansion roles — in-game reveal cards */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.25em] uppercase" style={{ color: "#555555" }}>أدوار الإضافات</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXPANSION_ROLE_KEYS.map((key) => <RoleRevealCard key={key} roleKey={key} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
