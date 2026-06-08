import { useEffect, useState } from "react";
import { Mail, Loader2, ArrowRight, CheckCircle2, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { PrivacyModal, TermsModal } from "./LegalModals";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" className="shrink-0">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
    </svg>
  );
}

/**
 * Login / sign-up modal. Triggered from the Landing page "Play Now" CTA so the
 * user never leaves the page just to see the auth options. Supports Google
 * OAuth and email magic-link (both inherently redirect on submit). The same
 * dark, crimson Al-Qinaa aesthetic as the rest of the app.
 */
export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signInWithGoogle, signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // Reset transient form state whenever the modal is closed so a reopen always
  // starts clean (no stale email/error/sent state from a previous attempt).
  useEffect(() => {
    if (!open) {
      setEmail("");
      setBusy(null);
      setError(null);
      setSent(false);
    }
  }, [open]);

  const handleGoogle = async () => {
    setError(null);
    setBusy("google");
    const { error } = await signInWithGoogle();
    if (error) {
      setError("تعذّر تسجيل الدخول عبر Google. حاول مرة أخرى.");
      setBusy(null);
    }
    // On success the browser redirects to Google — no further action here.
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError("يرجى إدخال بريد إلكتروني صالح.");
      return;
    }
    setError(null);
    setBusy("email");
    const { error } = await signInWithEmail(trimmed);
    setBusy(null);
    if (error) {
      setError("تعذّر إرسال رابط الدخول. تأكد من البريد وحاول مجدداً.");
      return;
    }
    setSent(true);
  };

  if (!open) return null;

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
          aria-label="إغلاق تسجيل الدخول"
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
        className="relative w-full max-w-sm rounded-2xl p-6 flex flex-col items-center gap-7 shadow-2xl"
        style={{ backgroundColor: "#0D0D0D", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}>

        {/* Ambient crimson glow */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden"
          style={{ background: "radial-gradient(60% 50% at 50% 0%, rgba(211,47,47,0.10), transparent 70%)" }} />

        {/* Heading */}
        <div className="relative flex flex-col items-center gap-1.5 text-center pt-1">
          <h2 className="text-2xl font-black" style={{ color: "#ffffff" }}>ابدأ اللعب</h2>
          <p className="text-sm" style={{ color: "#888888" }}>سجّل دخولك لتبدأ اللعب</p>
        </div>

        {sent ? (
          /* Magic-link sent state */
          <div className="relative w-full flex flex-col items-center gap-4 text-center">
            <CheckCircle2 size={48} strokeWidth={1.6} className="text-emerald-400" />
            <p className="text-base font-bold text-white">تحقّق من بريدك الإلكتروني</p>
            <p className="text-sm leading-relaxed" style={{ color: "#999999" }}>
              أرسلنا رابط دخول سريع إلى <span className="text-white font-bold">{email}</span>.
              افتح الرابط من نفس الجهاز لإكمال تسجيل الدخول.
            </p>
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              className="text-sm font-bold transition-colors hover:text-white"
              style={{ color: "#D32F2F" }}>
              استخدام بريد آخر
            </button>
          </div>
        ) : (
          <div className="relative w-full flex flex-col gap-4">

            {/* Google OAuth */}
            <button
              onClick={handleGoogle}
              disabled={busy !== null}
              className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl font-bold text-sm bg-white text-neutral-900 transition-all duration-150 hover:bg-neutral-100 active:scale-[0.98] disabled:opacity-60">
              {busy === "google" ? <Loader2 size={18} className="animate-spin" /> : <GoogleIcon />}
              <span>تسجيل الدخول باستخدام Google</span>
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />
              <span className="text-xs" style={{ color: "#555555" }}>أو</span>
              <div className="flex-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />
            </div>

            {/* Email magic link */}
            <form onSubmit={handleEmail} className="w-full flex flex-col gap-3">
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.10)" }}>
                <Mail size={18} className="shrink-0" style={{ color: "#666666" }} />
                <input
                  type="email"
                  inputMode="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-neutral-600 outline-none text-right"
                  style={{ direction: "ltr" }}
                />
              </div>
              <button
                type="submit"
                disabled={busy !== null}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm text-white transition-all duration-150 active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: "#D32F2F" }}>
                {busy === "email"
                  ? <Loader2 size={18} className="animate-spin" />
                  : <><span>الدخول السريع عبر البريد</span><ArrowRight size={16} /></>}
              </button>
            </form>

            {error && (
              <p className="text-sm text-center" style={{ color: "#EF5350" }}>{error}</p>
            )}
          </div>
        )}

        <p className="relative text-center text-xs leading-relaxed" style={{ color: "#555555" }}>
          بتسجيل الدخول، فإنك توافق على{" "}
          <button
            type="button"
            onClick={() => setShowTerms(true)}
            className="text-red-400 hover:text-red-300 underline cursor-pointer transition-colors">
            شروط الاستخدام
          </button>{" "}
          و
          <button
            type="button"
            onClick={() => setShowPrivacy(true)}
            className="text-red-400 hover:text-red-300 underline cursor-pointer transition-colors">
            سياسة الخصوصية
          </button>{" "}
          الخاصة بلعبة القناع.
        </p>
      </div>

      <TermsModal open={showTerms} onClose={() => setShowTerms(false)} />
      <PrivacyModal open={showPrivacy} onClose={() => setShowPrivacy(false)} />
    </div>
  );
}
