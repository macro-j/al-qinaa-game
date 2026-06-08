import { useState } from "react";
import { VenetianMask, BookOpen, Info, Play } from "lucide-react";
import { AuthModal } from "./AuthModal";
import { GuideModal } from "./GuideModal";
import { AboutModal } from "./AboutModal";
import { PrivacyModal, TermsModal } from "./LegalModals";

const ROOT_STYLE: React.CSSProperties = { backgroundColor: "var(--n-bg, #000000)" };

/**
 * Public landing page shown to unauthenticated visitors at the root path.
 * Logo + tagline, a primary "Play Now" CTA that opens the AuthModal (no
 * full-page redirect), and public access to "How to Play" (rules) and "About".
 * The game board and store remain gated behind auth (handled in App.tsx).
 */
export function LandingPage() {
  const [showAuth, setShowAuth] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  return (
    <div className="min-h-full w-full flex flex-col relative" style={ROOT_STYLE}>

      {/* ── Centered hero ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center gap-10 w-full max-w-md">

          {/* Logo + Title */}
          <div className="flex flex-col items-center gap-3">
            <div style={{ filter: "drop-shadow(0 0 40px #D32F2F55)" }}>
              <VenetianMask size={120} color="#D32F2F" strokeWidth={0.8} />
            </div>
            <h1 className="text-6xl font-black tracking-widest" style={{ color: "#D32F2F" }}>القناع</h1>
            <p className="text-sm text-center tracking-wide font-light" style={{ color: "rgba(255,255,255,0.55)" }}>
              القرية تنام والقاتل يصحو..
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col gap-4 w-full">

            {/* Play Now — primary crimson CTA → auth modal */}
            <button
              dir="rtl"
              onClick={() => setShowAuth(true)}
              className="w-full flex items-center justify-center gap-3 px-5 py-5 rounded-2xl font-black text-lg text-white transition-all duration-200 active:scale-95"
              style={{ backgroundColor: "#D32F2F", boxShadow: "0 0 32px #D32F2F44" }}>
              <Play size={20} strokeWidth={2.2} fill="currentColor" />
              <span>العب الآن</span>
            </button>

            {/* How to Play — public rules, ghost style */}
            <button
              onClick={() => setShowGuide(true)}
              className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-3.5 rounded-2xl transition-all duration-200 active:scale-95"
              style={{ backgroundColor: "transparent", border: "1px solid #2A2A2A", color: "#888888" }}>
              <BookOpen size={18} strokeWidth={1.8} />
              <span className="text-sm font-semibold">شرح اللعبة</span>
            </button>

          </div>
        </div>
      </div>

      {/* ── Legal Footer ── */}
      <footer
        dir="rtl"
        className="w-full flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pb-5 pt-2 text-[11px] sm:text-xs"
        style={{ color: "#444444" }}>
        <button
          onClick={() => setShowPrivacy(true)}
          className="transition-colors duration-150 hover:text-neutral-300 active:scale-95">
          سياسة الخصوصية
        </button>
        <button
          onClick={() => setShowTerms(true)}
          className="transition-colors duration-150 hover:text-neutral-300 active:scale-95">
          الشروط والأحكام
        </button>
      </footer>

      {/* ── Info button — fixed top-left ── */}
      <button
        onClick={() => setShowAbout(true)}
        title="عن القناع"
        aria-label="عن القناع"
        className="fixed top-6 left-6 flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 active:scale-90"
        style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A", color: "rgba(255,255,255,0.35)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.85)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}>
        <Info size={18} strokeWidth={1.8} />
      </button>

      {/* ── Modals ── */}
      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
      <GuideModal open={showGuide} onClose={() => setShowGuide(false)} />
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
      <PrivacyModal open={showPrivacy} onClose={() => setShowPrivacy(false)} />
      <TermsModal open={showTerms} onClose={() => setShowTerms(false)} />
    </div>
  );
}
