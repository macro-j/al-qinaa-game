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
              <div className="text-xs text-white/50 mt-1 leading-snug">
                تصميم اللعب وقوانين المجلس
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
