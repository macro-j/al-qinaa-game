import { X, ScrollText } from "lucide-react";

export type MatchHistoryEvent = { icon: string; text: string };

export type MatchHistoryPhase = {
  phaseName: string;
  phaseType: "night" | "day";
  events: MatchHistoryEvent[];
};

export function MatchHistoryModal({
  open,
  onClose,
  history,
}: {
  open: boolean;
  onClose: () => void;
  history: MatchHistoryPhase[];
}) {
  if (!open) return null;

  const isEmpty = history.length === 0 || history.every(p => p.events.length === 0);

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
          title="إغلاق"
          aria-label="إغلاق سجل أحداث اللعبة"
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
        className="w-full max-w-md sm:max-w-xl md:max-w-2xl rounded-2xl flex flex-col gap-4 p-5 shadow-2xl max-h-[85vh]"
        style={{ backgroundColor: "#111111", border: "1px solid rgba(211,47,47,0.35)", boxShadow: "0 0 40px rgba(211,47,47,0.12)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 shrink-0">
          <div
            className="w-10 h-10 flex items-center justify-center rounded-xl"
            style={{ backgroundColor: "#1A0000", border: "1px solid rgba(211,47,47,0.45)" }}>
            <ScrollText size={20} color="#D32F2F" strokeWidth={1.8} />
          </div>
          <div className="flex flex-col gap-0.5">
            <h2 className="font-black text-lg text-white">سجل أحداث اللعبة</h2>
            <p className="text-xs" style={{ color: "#666666" }}>ملخص الأسرار والأحداث</p>
          </div>
        </div>

        <div style={{ height: "1px", backgroundColor: "rgba(211,47,47,0.2)" }} />

        <div className="flex-1 overflow-y-auto flex flex-col gap-3 min-h-0 pr-0.5">
          {isEmpty ? (
            <p className="text-sm text-center py-8" style={{ color: "#555555" }}>
              لا توجد أحداث مسجّلة بعد.
            </p>
          ) : (
            history.map((phase) => (
              <div
                key={`${phase.phaseType}-${phase.phaseName}`}
                className="flex flex-col gap-2 rounded-xl p-3"
                style={{
                  backgroundColor: phase.phaseType === "night" ? "#0D0000" : "#0A0A14",
                  border: `1px solid ${phase.phaseType === "night" ? "rgba(211,47,47,0.35)" : "rgba(21,101,192,0.3)"}`,
                  boxShadow: phase.phaseType === "night" ? "inset 0 0 12px rgba(211,47,47,0.06)" : "inset 0 0 12px rgba(21,101,192,0.05)",
                }}>
                <div className="flex items-center gap-2 px-1">
                  <span
                    className="text-xs font-black tracking-wide px-2 py-0.5 rounded-md"
                    style={{
                      backgroundColor: phase.phaseType === "night" ? "#1A0000" : "#00081A",
                      color: phase.phaseType === "night" ? "#FF6B6B" : "#64B5F6",
                      border: `1px solid ${phase.phaseType === "night" ? "rgba(211,47,47,0.4)" : "rgba(21,101,192,0.35)"}`,
                    }}>
                    {phase.phaseName}
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {phase.events.map((event, i) => (
                    <li
                      key={`${phase.phaseName}-${i}`}
                      className="flex flex-row items-center gap-3 px-3 py-2.5 rounded-lg"
                      style={{ backgroundColor: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <span
                        className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full text-base leading-none"
                        style={{
                          backgroundColor: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.1)",
                        }}
                        aria-hidden>
                        {event.icon}
                      </span>
                      <span
                        className="text-sm font-semibold leading-snug flex-1 text-right"
                        style={{ color: "#DDDDDD" }}>
                        {event.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
