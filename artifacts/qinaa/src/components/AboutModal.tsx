import { VenetianMask, X } from "lucide-react";

/**
 * "عن القناع" — public about / credits modal. Self-contained so it can be shown
 * both on the unauthenticated Landing page and from the authenticated
 * GameModeSelector. Pure presentational content; no gameplay logic.
 */
export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{ backgroundColor: "rgba(0,0,0,0.82)", backdropFilter: "blur(12px)" }}
      onClick={onClose}>

      {/* Top navbar — single right-side X, taps fall through to backdrop */}
      <div
        dir="rtl"
        className="fixed top-0 inset-x-0 z-[60] flex items-center justify-between px-4 md:px-8 lg:px-12 py-4 pointer-events-none">
        <button
          onClick={onClose}
          title="إغلاق"
          aria-label="إغلاق صناع القناع"
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
        className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl rounded-2xl p-6 flex flex-col gap-5 shadow-2xl"
        style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Logo + Title */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <div style={{ filter: "drop-shadow(0 0 28px #D32F2F55)" }}>
            <VenetianMask size={56} color="#D32F2F" strokeWidth={0.9} />
          </div>
          <h2 className="text-4xl font-black tracking-widest" style={{ color: "#D32F2F" }}>القناع</h2>
          <p className="text-xs text-center leading-relaxed" style={{ color: "#666666" }}>
            لعبة استنتاج وخداع صُنعت للمجالس
          </p>
          <span className="text-xs font-semibold px-3 py-1 rounded-full"
            style={{ backgroundColor: "#0A2A1A", color: "#34D399", border: "1px solid #10B98133" }}>
            الإصدار التجريبي الثالث — Beta v3.0.0
          </span>
        </div>

        {/* Divider */}
        <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.06)" }} />

        {/* Credits */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold tracking-[0.3em] text-center" style={{ color: "#444444" }}>
            صُنّاع القناع
          </span>

          <div className="grid grid-cols-2 gap-6 text-center">
            <a
              href="https://x.com/Yzk5_"
              target="_blank"
              rel="noopener noreferrer"
              className="group block transition-all duration-200 active:scale-95"
              style={{ textDecoration: "none" }}>
              <div className="text-sm font-black tracking-wide text-white transition-colors duration-200 group-hover:text-[#D32F2F] group-active:text-[#D32F2F]">
                Mohammed
              </div>
              <div className="flex items-center justify-center gap-1 text-xs text-white/50 mt-1 leading-snug">
                <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
                </svg>
                <span>التطوير والتصميم البصري</span>
              </div>
            </a>

            <a
              href="https://www.tiktok.com/@abdullah.jj57"
              target="_blank"
              rel="noopener noreferrer"
              className="group block transition-all duration-200 active:scale-95"
              style={{ textDecoration: "none" }}>
              <div className="text-sm font-black tracking-wide text-white transition-colors duration-200 group-hover:text-[#D32F2F] group-active:text-[#D32F2F]">
                Abdullah
              </div>
              <div className="flex items-center justify-center gap-1 text-xs text-white/50 mt-1 leading-snug">
                <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11" aria-hidden="true">
                  <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
                </svg>
                <span>تصميم اللعب وقوانين المجلس</span>
              </div>
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs" style={{ color: "#2A2A2A" }}>© 2026 القناع</p>
      </div>
    </div>
  );
}
