import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { io, type Socket } from "socket.io-client";
import QRCode from "react-qr-code";
import {
  VenetianMask,
  Plus,
  LogIn,
  LogOut,
  BookOpen,
  Copy,
  Check,
  ArrowRight,
  Users,
  Shuffle,
  Moon,
  Sun,
  Skull,
  Mic,
  Loader2,
  AlertCircle,
  Lock,
  Unlock,
  Share2,
  Timer,
  Smartphone,
  Monitor,
  ChevronRight,
  Trash2,
  UserPlus,
  Search,
  Shield,
  Eye,
  EyeOff,
  User,
  Info,
  X,
  ExternalLink,
  Volume2,
  VolumeX,
  ChevronDown,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./lib/auth";
import { useShop } from "./lib/shop";
import { preloadSfx, unlockSfx, playSfx, startHeartbeat, stopHeartbeat } from "./lib/sfx";
import { AuthModal } from "./components/AuthModal";
import { ProfileModal } from "./components/ProfileModal";
import { GuideModal } from "./components/GuideModal";
import { AboutModal } from "./components/AboutModal";
import { PrivacyModal, TermsModal } from "./components/LegalModals";
import { FREE_GAME_LIMIT } from "./lib/supabase";
import { ROLE_META, getRoleName } from "./lib/roles";

// NarratorMode registers its preloaded pool here so the root App iOS-resume
// overlay can unlock the actual HTMLAudioElement instances via user gesture.
const narratorAudioCacheRef  = { current: {} as Record<string, HTMLAudioElement> };
const narratorActiveAudioRef = { current: null as HTMLAudioElement | null };

/** Shared Web Audio context — created on first user gesture, reused for suspend detection. */
const gameAudioContextRef = { current: null as AudioContext | null };
const onAudioSuspendedChangeRef = {
  current: null as ((suspended: boolean) => void) | null,
};

function getOrCreateGameAudioContext(): AudioContext | null {
  try {
    if (gameAudioContextRef.current) return gameAudioContextRef.current;

    type ACtor = typeof AudioContext;
    const Ctx: ACtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: ACtor }).webkitAudioContext;
    if (!Ctx) return null;

    const ctx = new Ctx();
    ctx.onstatechange = () => {
      if (document.visibilityState !== "visible") return;
      onAudioSuspendedChangeRef.current?.(ctx.state === "suspended");
    };
    gameAudioContextRef.current = ctx;
    return ctx;
  } catch {
    return null;
  }
}

function resumeGameAudioContext(): void {
  const ctx = gameAudioContextRef.current;
  if (ctx?.state === "suspended") {
    void ctx.resume();
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = "menu" | "create-name" | "join" | "lobby" | "player-screen" | "dashboard" | "rejoining";

interface SocketPlayer {
  socketId: string;
  name: string;
}

interface AssignedPlayer extends SocketPlayer {
  roleLabel: string;
  roleColor: string;
  isAlive?: boolean;
}

interface LobbyState {
  code: string;
  isHost: boolean;
  myName: string;
  players: SocketPlayer[];
}

interface MyRole {
  label:      string;
  color:      string;
  code:       string;
  myName:     string;
  players:    string[]; // all other player names (self excluded)
  wolfAllies: string[]; // names of wolf-team allies (only populated for wolf/shadow)
}

interface GameState {
  code:       string;
  players:    AssignedPlayer[];
  myName:     string; // host's own display name — used to find their role card
  wolfAllies: string[]; // host's own wolf allies (if host is wolf/shadow)
}

type GameStartedPayload =
  | { isHost: true;  code: string; players: AssignedPlayer[]; wolfAllies: string[] }
  | { isHost: false; code: string; myRole: { label: string; color: string }; wolfAllies: string[] };

interface MorningResultsPayload {
  killedPlayerName:  string | null;
  silencedPlayerName: string | null;
}

interface InvestigateResultPayload {
  targetName: string;
  roleLabel:  string;
  roleColor:  string;
}

interface VoteUpdatePayload {
  votes:            Record<string, string>; // voterName → targetName
  alivePlayerNames: string[];
  totalAlive:       number;
}

interface MafiaActionSyncPayload {
  actionType: "kill" | "silence";
  targetName: string;
}

interface GameOverPayload {
  winner:              "wolves" | "citizens";
  executedPlayerName:  string | null;
}

// ─── localStorage Persistence ─────────────────────────────────────────────────

const STORAGE_UID     = "qinaa_uid";
const STORAGE_SESSION = "qinaa_session";

interface StoredSession {
  code:   string;
  isHost: boolean;
  myName: string;
}

function getOrCreateUserId(): string {
  let id = localStorage.getItem(STORAGE_UID);
  if (!id) {
    id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(STORAGE_UID, id);
  }
  return id;
}

function saveSession(s: StoredSession) {
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(s));
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_SESSION);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(STORAGE_SESSION);
}

// ─── NarratorMode persistence ────────────────────────────────────────────────

const STORAGE_NARRATOR = "qinaa_narrator_state";
const STORAGE_MODE     = "qinaa_selected_mode";

function loadNarratorState(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(STORAGE_NARRATOR);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch { return null; }
}
function saveNarratorState(s: Record<string, unknown>) {
  try { localStorage.setItem(STORAGE_NARRATOR, JSON.stringify(s)); } catch { /* quota — ignore */ }
}
function clearNarratorState() {
  localStorage.removeItem(STORAGE_NARRATOR);
}
function loadSelectedMode(): "online" | "narrator" | null {
  try {
    const v = localStorage.getItem(STORAGE_MODE);
    return v === "online" || v === "narrator" ? v : null;
  } catch { return null; }
}

// ─── Socket Singleton ─────────────────────────────────────────────────────────

let _socket: Socket | null = null;
function getSocket(): Socket {
  if (!_socket) {
    _socket = io({
      path: "/socket.io/",
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 8_000,
      timeout: 20_000,
    });
  }
  return _socket;
}

// ─── Shared Styles ────────────────────────────────────────────────────────────

const BASE_BUTTON =
  "flex flex-row-reverse items-center gap-4 w-full px-6 py-4 rounded-xl border font-bold text-white text-lg transition-all duration-200 hover:brightness-125 active:scale-95";

const ROOT_STYLE: React.CSSProperties = { backgroundColor: "var(--n-bg, #000000)" };

// ── Haptic Feedback — safe wrapper around navigator.vibrate ───────────────────
const triggerHaptic = (pattern: number | number[]) => {
  if (typeof window !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(pattern); } catch (_) {}
  }
};

function TopBar({ onBack, label }: { onBack?: () => void; label?: string }) {
  return (
    <div className="flex items-center justify-between">
      {onBack ? (
        <button onClick={onBack} className="flex items-center gap-1 text-sm transition-opacity hover:opacity-70 transition-all active:scale-95" style={{ color: "#9E9E9E" }}>
          <ArrowRight size={16} /><span>رجوع</span>
        </button>
      ) : <div />}
      <div className="flex items-center gap-2">
        <VenetianMask size={26} color="#D32F2F" strokeWidth={1.5} />
        <span className="font-black text-lg" style={{ color: "#D32F2F" }}>
          {label ?? "القناع"}
        </span>
      </div>
    </div>
  );
}

function Footer() {
  return <p className="text-center text-xs pb-2" style={{ color: "#333333" }}>القرية تنام.. والقاتل يصحو</p>;
}

function LeaveButton({ onLeave, label = "خروج من الغرفة" }: { onLeave: () => void; label?: string }) {
  return (
    <button
      onClick={onLeave}
      className="flex flex-row-reverse items-center justify-center gap-2 w-full px-4 py-3 rounded-xl border text-sm font-semibold transition-all duration-200 active:scale-95"
      style={{ backgroundColor: "#0D0000", borderColor: "#4A0000", color: "#9E4444" }}
    >
      <LogOut size={16} />
      <span>{label}</span>
    </button>
  );
}

// ─── Connection Banner ────────────────────────────────────────────────────────

function ConnectionBanner({ connected }: { connected: boolean }) {
  if (connected) return null;
  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 py-2 text-xs font-semibold"
      style={{ backgroundColor: "#1A0000", borderBottom: "1px solid #D32F2F", color: "#FF6B6B" }}
    >
      <Loader2 size={13} className="animate-spin flex-shrink-0" />
      <span>جاري إعادة الاتصال بالخادم...</span>
    </div>
  );
}

// ─── Rejoining Screen ─────────────────────────────────────────────────────────

function RejoiningScreen({ onGiveUp }: { onGiveUp: () => void }) {
  return (
    <div className="min-h-full w-full flex flex-col items-center justify-center gap-6 px-6" style={ROOT_STYLE}>
      <div style={{ filter: "drop-shadow(0 0 20px #D32F2F44)" }}>
        <VenetianMask size={80} color="#D32F2F" strokeWidth={1} />
      </div>
      <div className="flex flex-col items-center gap-2">
        <Loader2 size={28} color="#D32F2F" className="animate-spin" />
        <p className="text-white font-bold text-lg">جاري استئناف الجلسة...</p>
        <p className="text-xs" style={{ color: "#555555" }}>نحاول إعادتك إلى الغرفة</p>
      </div>
      <button onClick={onGiveUp} className="text-xs underline transition-all active:scale-95" style={{ color: "#555555" }}>
        بدء من جديد
      </button>
      <p className="text-xs" style={{ color: "#333333" }}>القرية تنام.. والقاتل يصحو</p>
    </div>
  );
}

// ─── Game Mode Selector (top-level entry point) ───────────────────────────────

function GameModeSelector({ onSelect }: { onSelect: (mode: "online" | "narrator") => void }) {
  const [showGuide,   setShowGuide]   = useState(false);
  const [showAbout,   setShowAbout]   = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTerms,   setShowTerms]   = useState(false);
  const [showSupport, setShowSupport] = useState(false);

  // 🛑 التعديل الذكي: قراءة الرابط عند تحميل الصفحة 🛑
  const [showAuth, setShowAuth] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("auth") === "true";
    }
    return false;
  });
  const [showProfile, setShowProfile] = useState(false);

  const { openShop } = useShop();
  const { user, entitlements } = useAuth();
  const freeRemaining = Math.max(0, FREE_GAME_LIMIT - (entitlements?.games_played ?? 0));

  // 🛑 التعديل الذكي الثاني: إضافة وحذف كلمة auth من الرابط تلقائياً 🛑
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (showAuth) {
      url.searchParams.set("auth", "true");
    } else {
      url.searchParams.delete("auth");
    }
    window.history.replaceState({}, "", url.toString());
  }, [showAuth]);

  return (
    <div className="min-h-full w-full flex flex-col relative" style={ROOT_STYLE}>
      {/* flex-1 centering region — footer sits below this, anchored naturally by flex column */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-10 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl">

        {/* Logo + Title */}
        <div className="flex flex-col items-center gap-3">
          <div style={{ filter: "drop-shadow(0 0 40px #D32F2F55)" }}>
            <VenetianMask size={120} color="#D32F2F" strokeWidth={0.8} />
          </div>
          <h1 className="text-6xl font-black tracking-widest" style={{ color: "#D32F2F" }}>القناع</h1>
          <p className="text-sm text-center tracking-wide font-light" style={{ color: "rgba(255,255,255,0.55)" }}>القرية تنام والقاتل يصحو..</p>
        </div>

        {/* Mode buttons */}
        <div className="flex flex-col gap-4 w-full">

          {/* Narrator Mode — PRIMARY
              Standard RTL row: [icon RIGHT] [flex-1 text] [chevron LEFT].
              No items-end / no flex-row-reverse — pure dir="rtl" flow. */}
          <button
            dir="rtl"
            onClick={() => { if (!user) { setShowAuth(true); return; } onSelect("narrator"); }}
            className="w-full flex items-center px-5 py-5 rounded-2xl transition-all duration-200 active:scale-95"
            style={{ backgroundColor: "#061210", border: "1px solid #10B98133", boxShadow: "0 0 24px #10B98111" }}>
            {/* Child 1 — RIGHT: icon */}
            <div className="flex items-center justify-center w-12 h-12 rounded-xl shrink-0"
              style={{ backgroundColor: "#0A1F1C", border: "1px solid #10B98122" }}>
              <Monitor size={24} color="#10B981" strokeWidth={1.8} />
            </div>
            {/* Child 2 — MIDDLE: text block, grows to fill, flush-right */}
            <div className="flex-1 flex flex-col gap-0.5 text-right px-4">
              {/* title row: title rightmost, badge immediately to its LEFT */}
              <div className="flex items-center gap-2">
                <span className="text-lg font-black text-white">طور المجلس</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: "#10B98110", color: "#34D399", border: "1px solid #10B98120" }}>جديد ✨</span>
              </div>
              <span className="text-xs" style={{ color: "#6EE7B7" }}>شاشة واحدة تجمعكم، والراوي يدير أحداث اللعبة</span>
            </div>
            {/* Child 3 — LEFT: chevron, pushed to far left by Child 2's flex-1 */}
            <ChevronRight size={18} color="#10B981" strokeWidth={2} className="rotate-180 shrink-0" />
          </button>

          {/* Online Mode — BETA: AI-narrated multiplayer (hidden during Council Mode playtest) */}
          {false && <button
            onClick={() => {
              const code = window.prompt("أدخل رمز المرور السري:");
              if (code === "0949" || code === "٠٩٤٩") {
                onSelect("online");
              } else {
                window.alert("رمز خاطئ");
              }
            }}
            className="w-full flex flex-row-reverse items-center justify-between px-5 py-5 rounded-2xl transition-all duration-200 active:scale-95"
            style={{ backgroundColor: "#120A06", border: "1px solid #FB923C33", boxShadow: "0 0 24px #FB923C11" }}>
            <div className="flex items-center justify-center w-12 h-12 rounded-xl flex-shrink-0 relative"
              style={{ backgroundColor: "#1F140A", border: "1px solid #FB923C22" }}>
              <Smartphone size={22} color="#FB923C" strokeWidth={1.8} style={{ position: "absolute", top: "8px", right: "10px" }} />
              <Smartphone size={22} color="#FB923C" strokeWidth={1.8} style={{ position: "absolute", bottom: "8px", left: "10px", opacity: 0.55 }} />
            </div>
            <div className="flex flex-col items-end gap-1 flex-1 mx-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: "rgba(234,179,8,0.08)", color: "#EAB308", border: "1px solid rgba(234,179,8,0.2)" }}>قريباً</span>
                <span className="text-lg font-black text-white">طور الراوي الذكي</span>
              </div>
              <span className="text-xs text-right" style={{ color: "#A8825F" }}>انضموا لغرفة واحدة، والراوي الذكي يتولى إدارة الجلسة</span>
            </div>
            <ChevronRight size={18} color="#FB923C" strokeWidth={2} className="rotate-180 flex-shrink-0" />
          </button>}

          {/* Rules — ghost/outline style, visually subordinate */}
          <button
            onClick={() => setShowGuide(true)}
            className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-3.5 rounded-2xl transition-all duration-200 active:scale-95"
            style={{ backgroundColor: "transparent", border: "1px solid #2A2A2A", color: "#666666" }}>
            <BookOpen size={18} strokeWidth={1.8} />
            <span className="text-sm font-semibold">شرح اللعبة</span>
          </button>

        </div>
      </div>
      </div>{/* end flex-1 centering region */}

      {/* ── Signed-in user strip — opens profile modal ── */}
      {user && (
        <div dir="rtl" className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto px-6 pb-3">
          <button
            type="button"
            onClick={() => setShowProfile(true)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl transition-all duration-200 active:scale-[0.99] hover:brightness-110"
            style={{ backgroundColor: "#0D0D0D", border: "1px solid #1F1F1F" }}>
            <div className="flex flex-col gap-1.5 min-w-0 text-right">
              <span className="text-[11px]" style={{ color: "#666666" }}>
                المستخدم:{" "}
                <span dir="ltr" className="text-xs font-bold align-middle" style={{ color: "#9E9E9E" }}>
                  {user.email ?? "—"}
                </span>
              </span>
              {entitlements ? (
                entitlements.has_all_access ? (
                  <span
                    className="inline-flex w-fit items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-md"
                    style={{ backgroundColor: "#1A1206", color: "#FBBF24", border: "1px solid rgba(245,158,11,0.4)" }}>
                    الباقة الشاملة 👑
                  </span>
                ) : entitlements.has_base_game ? (
                  <span
                    className="inline-flex w-fit items-center text-[11px] font-black px-2 py-0.5 rounded-md"
                    style={{ backgroundColor: "#161616", color: "#DDDDDD", border: "1px solid #333333" }}>
                    اللعبة الأساسية
                  </span>
                ) : (
                  <span
                    className="inline-flex w-fit items-center text-[11px] font-black px-2 py-0.5 rounded-md"
                    style={{ backgroundColor: "#120808", color: "#EF9A9A", border: "1px solid rgba(211,47,47,0.3)" }}>
                    التجربة المجانية (المتبقي: {freeRemaining})
                  </span>
                )
              ) : (
                <span className="text-[11px]" style={{ color: "#555555" }}>جارٍ التحقق من الحساب…</span>
              )}
            </div>
            <ChevronRight size={18} color="#666666" strokeWidth={2} className="rotate-180 shrink-0" />
          </button>
        </div>
      )}

      {/* ── Legal Footer ──
          Anchored to the bottom of the 100dvh flex column. Position in
          flex flow (not fixed) so it never overlaps the centered content,
          and never introduces a native scroll since the outer column is
          overflow:hidden with a finite 100dvh height. */}
      <footer
        dir="rtl"
        className="w-full flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pb-5 pt-2 text-[11px] sm:text-xs"
        style={{ color: "#444444" }}>
        {/* Shop — prominent amber entry point (public; purchase actions inside are auth-gated) */}
        <button
          onClick={openShop}
          className="font-bold text-amber-400 transition-all duration-150 hover:text-amber-300 active:scale-95"
          style={{ textShadow: "0 0 12px rgba(251,191,36,0.45)" }}>
          باقات اللعبة
        </button>
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
        <button
          onClick={() => setShowSupport(true)}
          className="transition-colors duration-150 hover:text-neutral-300 active:scale-95">
          الدعم الفني
        </button>
      </footer>

      {/* ── Info button — fixed top-left ── */}
      <button
        onClick={() => setShowAbout(true)}
        className="fixed top-6 left-6 flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 active:scale-90"
        style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A", color: "rgba(255,255,255,0.35)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.85)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}>
        <Info size={18} strokeWidth={1.8} />
      </button>

      {/* ── Auth Modal — opened when a guest taps a gated action ── */}
      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />

      {/* ── Profile Modal — account details, logout, delete ── */}
      {user && (
        <ProfileModal open={showProfile} onClose={() => setShowProfile(false)} user={user} />
      )}

      {/* ── About Modal ── */}
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />

      {/* ── Game Guide Modal ── */}
      <GuideModal open={showGuide} onClose={() => setShowGuide(false)} />

      {/* ── Privacy Policy Modal ── */}
      <PrivacyModal open={showPrivacy} onClose={() => setShowPrivacy(false)} />

      {/* ── Terms & Conditions Modal ── */}
      <TermsModal open={showTerms} onClose={() => setShowTerms(false)} />

      {/* ── Support Modal ── */}
      {showSupport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ backgroundColor: "rgba(0,0,0,0.88)", backdropFilter: "blur(12px)" }}
          onClick={() => setShowSupport(false)}>
          <div
            dir="rtl"
            className="fixed top-0 inset-x-0 z-[60] flex items-center justify-between px-4 md:px-8 lg:px-12 py-4 pointer-events-none">
            <button
              onClick={() => setShowSupport(false)}
              className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full text-white/70 hover:text-white transition-colors active:scale-90"
              style={{ backgroundColor: "rgba(13,13,13,0.55)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
              <X size={18} strokeWidth={2} />
            </button>
          </div>
          <div
            dir="rtl"
            className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl rounded-2xl p-6 flex flex-col gap-5 shadow-2xl"
            style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center gap-2 pt-1 text-center">
              <span className="font-black text-base text-white">الدعم الفني</span>
              <p className="text-sm" style={{ color: "#777777" }}>اختر الطريقة الأنسب للتواصل</p>
            </div>
            <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.06)" }} />
            <div className="flex flex-col gap-3">
              {/* WhatsApp — standard RTL: [icon RIGHT] [flex-1 text LEFT] */}
              <a
                dir="rtl"
                href="https://wa.me/639756108041"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-200 active:scale-[0.97]"
                style={{ backgroundColor: "#0A1A0F", border: "1px solid #25D36622", textDecoration: "none" }}
                onClick={() => setShowSupport(false)}>
                {/* Child 1 — RIGHT: icon */}
                <div className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
                  style={{ backgroundColor: "#0F2B18", border: "1px solid #25D36633" }}>
                  <svg viewBox="0 0 24 24" fill="#25D366" width="22" height="22" aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </div>
                {/* Child 2 — LEFT: text, grows + flush-right next to icon */}
                <div className="flex-1 text-right">
                  <span className="block font-black text-sm" style={{ color: "#25D366" }}>تواصل عبر واتساب</span>
                  <span className="block text-xs mt-0.5" style={{ color: "#4A7A5A" }}>ردّ سريع خلال ساعات</span>
                </div>
              </a>
              {/* Email — same standard RTL structure */}
              <a
                dir="rtl"
                href="mailto:qinaa.support@gmail.com"
                className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-200 active:scale-[0.97]"
                style={{ backgroundColor: "#0A0E1A", border: "1px solid #4285F422", textDecoration: "none" }}
                onClick={() => setShowSupport(false)}>
                {/* Child 1 — RIGHT: icon */}
                <div className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
                  style={{ backgroundColor: "#0E1528", border: "1px solid #4285F433" }}>
                  <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden="true">
                    <rect width="20" height="16" x="2" y="4" rx="2" stroke="#4285F4" strokeWidth="1.6"/>
                    <path d="m2 7 10 7 10-7" stroke="#4285F4" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </div>
                {/* Child 2 — LEFT: text, grows + flush-right next to icon */}
                <div className="flex-1 text-right">
                  <span className="block font-black text-sm" style={{ color: "#4285F4" }}>تواصل عبر البريد</span>
                  <span className="block text-xs mt-0.5" style={{ color: "#3A4A7A" }}>qinaa.support@gmail.com</span>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Narrator Mode — role engine constants ────────────────────────────────────

const MIN_PLAYERS = 5;

type AssignedRole = { name: string; role: string; color: string };
type LivePlayer   = { name: string; role: string; color: string; isAlive: boolean; isSilenced: boolean; deathReason: "vote" | "night" | null };

// ── Phase 3: Death pipeline ──
// "mafia"   = killed by الولد at night
// "poison"  = poisoned by Magician at night
// "vote"    = executed by day vote
// "twin"    = died because their twin partner died (cascading link)
// "avenger" = killed by an Avenger's revenge pick
type DeathCause = "mafia" | "poison" | "vote" | "twin" | "avenger";
type DeathEntry = { name: string; cause: DeathCause };

const DEATH_CAUSE_LABEL: Record<DeathCause, string> = {
  mafia:   "قتلته المافيا",
  poison:  "مات مسموماً",
  vote:    "أعدمته القرية",
  twin:    "فقد توأمه فلحق به",
  avenger: "أخذه المنتقم معه",
};

// Arabic pluralization helper for corpse counts.
// Arabic uses distinct grammatical forms for 1 (singular), 2 (dual),
// 3-10 (small plural — feminine numeral + plural noun), and 11+ (number + plural).
const formatCorpsesCount = (count: number): string => {
  switch (count) {
    case 1:  return "جثة واحدة";
    case 2:  return "جثتان";
    case 3:  return "ثلاث جثث";
    case 4:  return "أربع جثث";
    case 5:  return "خمس جثث";
    default: return `${count} جثث`;
  }
};

// ── سرعة المجلس (Game Speed presets) ──────────────────────────────────────
// Four pacing profiles for the table. Each preset drives THREE timers:
//   • turn      — per-role night action window (seconds)
//   • discuss   — open day discussion window  (seconds)
//   • lastWords — accused player's final defense window (seconds)
// The three named presets live in SPEED_PRESETS below; the fourth, "custom",
// is host-defined at runtime from `customSpeeds` state. Every timer site
// reads from the derived `speedPreset` value (see NarratorMode), which
// resolves custom→customSpeeds and otherwise indexes SPEED_PRESETS.
type GameSpeed = "fast" | "medium" | "slow" | "custom";
type SpeedTimings = { turn: number; discuss: number; lastWords: number };
const SPEED_PRESETS: Record<Exclude<GameSpeed, "custom">, SpeedTimings & { labelAr: string }> = {
  fast:   { turn: 15, discuss: 60,  lastWords: 30, labelAr: "سريع"  },
  medium: { turn: 30, discuss: 90,  lastWords: 45, labelAr: "متوسط" },
  slow:   { turn: 45, discuss: 120, lastWords: 60, labelAr: "بطيء"  },
};
// Discrete options offered in the three custom-time dropdowns. Covers the
// full range from very-fast night turns (15s) up to long social-deduction
// discussion windows (5 min). The same option list is reused for all three
// timers — host can mix any combination.
const CUSTOM_TIME_OPTIONS: ReadonlyArray<number> = [15, 30, 45, 60, 90, 120, 180, 240, 300];
const formatTimeOption = (sec: number): string => {
  if (sec < 60) return `${sec} ثانية`;
  const m = sec / 60;
  return Number.isInteger(m) ? `${m} ${m === 1 ? "دقيقة" : m === 2 ? "دقيقتان" : "دقائق"}` : `${sec} ثانية`;
};

// Role identity, descriptions, and display-name mapping (ROLE_META,
// ROLE_DISPLAY_NAME, getRoleName) live in ./lib/roles — the single source of
// truth shared by the in-game reveal, the Shop, and the Guide.

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateAndShuffleRoles(
  playerNames: string[],
  activeMods: Record<string, boolean> = {}
): AssignedRole[] {
  // ── 1. Base roles (priority order — mirrors server roleDefs) ──
  const baseDeck: { role: string; color: string }[] = [
    { role: "الولد",  color: "#D32F2F" },
    { role: "الإكة",  color: "#B71C1C" },
    { role: "الشايب", color: "#FF8F00" },
    { role: "البنت",  color: "#1565C0" },
  ];

  // ── 2. Inject mod roles per activeMods ──
  // Twins = 2 identical entries. Madman/Avenger/Magician = 1 each.
  // Distinct role IDs ('madman', 'twin', 'avenger', 'magician') so phases can identify them.
  const modDeck: { role: string; color: string }[] = [];
  if (activeMods.madman)   modDeck.push({ role: "madman",   color: ROLE_META["madman"].color });
  if (activeMods.twins) {
    modDeck.push({ role: "twin", color: ROLE_META["twin"].color });
    modDeck.push({ role: "twin", color: ROLE_META["twin"].color }); // exactly two
  }
  if (activeMods.avenger)  modDeck.push({ role: "avenger",  color: ROLE_META["avenger"].color });
  if (activeMods.magician) modDeck.push({ role: "magician", color: ROLE_META["magician"].color });

  // ── 3. Fill remaining slots with citizens (vanilla reserve guarantees ≥1) ──
  const totalUsed = baseDeck.length + modDeck.length;
  const citizenCount = Math.max(0, playerNames.length - totalUsed);
  const citizenDeck: { role: string; color: string }[] = Array.from(
    { length: citizenCount },
    () => ({ role: "المواطن", color: "#555555" })
  );

  // ── 4. Shuffle the deck of role-cards, then deal one to each (shuffled) player ──
  const deck = shuffle([...baseDeck, ...modDeck, ...citizenDeck]);
  const shuffledPlayers = shuffle(playerNames);
  const assigned: AssignedRole[] = shuffledPlayers.map((name, i) => ({
    name,
    role: deck[i].role,
    color: deck[i].color,
  }));

  // Engine sanity log — confirms the deck math (e.g. 8 players + Twins+Madman = 4+2+1+1)
  console.log("[Qinaa Deck] composition:", {
    players: playerNames.length,
    base: baseDeck.length,
    mods: modDeck.map(m => m.role),
    citizens: citizenCount,
    total: deck.length,
  });

  // Shuffle deal order so intro night sequence is unpredictable
  return shuffle(assigned);
}

// ─── Expansion Pack — static mod definitions (UI only, no logic yet) ─────────

const EXPANSION_MODS: { id: string; name: string; description: string; accent: string; border: string; glow: string; minPlayers: number }[] = [
  {
    id: "madman",
    name: "المجنون",
    description: "يفوز فوراً وتخسر القرية إذا تم إعدامه بالتصويت في النهار",
    accent: "#E879F9",
    border: "rgba(112,26,117,0.35)",
    glow: "rgba(232,121,249,0.06)",
    minPlayers: 6,
  },
  {
    id: "twins",
    name: "التوأم",
    description: "قرويان يعرفان بعضهما، إذا مات أحدهما يموت الآخر فوراً",
    accent: "#22D3EE",
    border: "rgba(8,51,68,0.35)",
    glow: "rgba(34,211,238,0.06)",
    minPlayers: 8,
  },
  {
    id: "avenger",
    name: "المنتقم",
    description: "إذا قُتل أو أُعدم، يختار شخصاً ليقتله ويأخذه معه للقبر",
    accent: "#A0522D",
    border: "rgba(90,35,10,0.40)",
    glow: "rgba(160,82,45,0.07)",
    minPlayers: 6,
  },
  {
    id: "magician",
    name: "الساحر",
    description: "يملك جرعة حياة لإنقاذ ضحية المافيا، وجرعة سم للتخلص من أي لاعب",
    accent: "#A3E635",
    border: "rgba(54,83,20,0.35)",
    glow: "rgba(163,230,53,0.06)",
    minPlayers: 7,
  },
];

// Slot cost per mod — used for player-count validation
const MOD_COST: Record<string, number> = { madman: 1, twins: 2, avenger: 1, magician: 1 };
// Maps an expansion mod's logic id → its store/owned_items catalog id, so the
// setup UI can check whether the host actually owns each premium role.
const MOD_TO_ITEM: Record<string, string> = {
  madman: "role_madman",
  twins: "role_twins",
  avenger: "role_avenger",
  magician: "role_wizard",
};
// Base roles that always consume slots (Boy, Akka, Old Man, Girl)
const BASE_ROLES_COUNT = 4;

// ─── Setup preferences (persist across reloads / new games) ─────────────────

const STORAGE_SETUP_PREFS = "qinaa_setup_prefs";

interface SetupPrefs {
  isPassPhoneMode: boolean;
  boyInheritsAce: boolean;
  isModsEnabled: boolean;
  activeMods: Record<string, boolean>;
  magicianPotionMode: "dual" | "single";
  gameSpeed: GameSpeed;
  customSpeedsV1: SpeedTimings;
  /** When true, night-phase narrator VO is silenced; SFX/victory still play. */
  isNarratorMuted: boolean;
}

function defaultActiveMods(): Record<string, boolean> {
  return EXPANSION_MODS.reduce(
    (acc, m) => ({ ...acc, [m.id]: false }),
    {} as Record<string, boolean>,
  );
}

function defaultCustomSpeeds(): SpeedTimings {
  return { turn: 30, discuss: 90, lastWords: 45 };
}

function sanitizeCustomSpeeds(raw: unknown): SpeedTimings {
  const defaults = defaultCustomSpeeds();
  if (!raw || typeof raw !== "object") return defaults;
  const obj = raw as Partial<SpeedTimings>;
  const sane = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    turn: sane(obj.turn, defaults.turn),
    discuss: sane(obj.discuss, defaults.discuss),
    lastWords: sane(obj.lastWords, defaults.lastWords),
  };
}

function sanitizeActiveMods(raw: unknown): Record<string, boolean> {
  const base = defaultActiveMods();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  for (const id of Object.keys(base)) {
    base[id] = obj[id] === true;
  }
  return base;
}

function defaultSetupPrefs(): SetupPrefs {
  return {
    isPassPhoneMode: false,
    boyInheritsAce: false,
    isModsEnabled: false,
    activeMods: defaultActiveMods(),
    magicianPotionMode: "dual",
    gameSpeed: "medium",
    customSpeedsV1: defaultCustomSpeeds(),
    isNarratorMuted: false,
  };
}

/** Night-phase narrator voice-over clips (wake / prompt / sleep / city transitions). */
const NARRATOR_VOICE_FILES = new Set([
  "start.m4a",
  "morning.m4a",
  "w1.m4a", "w2.m4a", "w3.m4a",
  "e1.m4a", "e2.m4a", "e3.m4a",
  "s1.m4a", "s2.m4a", "s3.m4a",
  "b1.m4a", "b2.m4a", "b3.m4a",
  "wh1.m4a", "wh2.m4a", "wh3.m4a",
]);

function isNarratorVoiceTrack(fileName: string): boolean {
  return NARRATOR_VOICE_FILES.has(fileName);
}

/** Hydrate setup prefs from dedicated storage, migrating once from narrator snapshot. */
function loadSetupPrefs(narratorFallback?: Record<string, unknown> | null): SetupPrefs {
  const defaults = defaultSetupPrefs();
  try {
    const raw = localStorage.getItem(STORAGE_SETUP_PREFS);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SetupPrefs>;
      return {
        ...defaults,
        isPassPhoneMode: parsed.isPassPhoneMode === true,
        boyInheritsAce: parsed.boyInheritsAce === true,
        isModsEnabled: parsed.isModsEnabled === true,
        activeMods: sanitizeActiveMods(parsed.activeMods),
        magicianPotionMode: parsed.magicianPotionMode === "single" ? "single" : "dual",
        gameSpeed:
          parsed.gameSpeed === "fast" ||
          parsed.gameSpeed === "medium" ||
          parsed.gameSpeed === "slow" ||
          parsed.gameSpeed === "custom"
            ? parsed.gameSpeed
            : defaults.gameSpeed,
        customSpeedsV1: sanitizeCustomSpeeds(parsed.customSpeedsV1),
        isNarratorMuted:
          parsed.isNarratorMuted === true ||
          (parsed as { isMuted?: boolean }).isMuted === true,
      };
    }
  } catch { /* ignore corrupt snapshot */ }

  if (narratorFallback) {
    return {
      ...defaults,
      isPassPhoneMode: narratorFallback.isPassPhoneMode === true,
      boyInheritsAce: narratorFallback.boyInheritsAce === true,
      isModsEnabled: narratorFallback.isModsEnabled === true,
      activeMods: sanitizeActiveMods(narratorFallback.activeMods),
      magicianPotionMode:
        narratorFallback.magicianPotionMode === "single" ? "single" : "dual",
      gameSpeed:
        narratorFallback.gameSpeedV1 === "fast" ||
        narratorFallback.gameSpeedV1 === "medium" ||
        narratorFallback.gameSpeedV1 === "slow" ||
        narratorFallback.gameSpeedV1 === "custom"
          ? (narratorFallback.gameSpeedV1 as GameSpeed)
          : defaults.gameSpeed,
      customSpeedsV1: sanitizeCustomSpeeds(narratorFallback.customSpeedsV1),
      isNarratorMuted:
        narratorFallback.isNarratorMuted === true ||
        narratorFallback.isMuted === true,
    };
  }

  return defaults;
}

function saveSetupPrefs(prefs: SetupPrefs): void {
  try {
    localStorage.setItem(STORAGE_SETUP_PREFS, JSON.stringify(prefs));
  } catch { /* quota — ignore */ }
}

// ─── Narrator Mode — component ────────────────────────────────────────────────

function NarratorMode({ onBack }: { onBack: () => void }) {
  const { canStartGame, incrementGamesPlayed, entitlements, refreshEntitlements } = useAuth();
  const { openShop } = useShop();
  // ── Hydrate from localStorage on mount (read once) ──
  const SAVED = loadNarratorState();
  const SETUP = loadSetupPrefs(SAVED);
  const pick = <T,>(key: string, fallback: T): T =>
    (SAVED && key in SAVED ? (SAVED[key] as T) : fallback);

  // ── Setup phase state ──
  const [players, setPlayers]       = useState<string[]>(() => pick("players", [] as string[]));
  const [newPlayer, setNewPlayer]   = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const inputRef                    = useRef<HTMLInputElement>(null);

  // ── Distribution phase state ──
  const [phase, setPhase]                   = useState<"setup" | "pre_distribution" | "distribution" | "night" | "day" | "reveal" | "avenger_revenge" | "execution_results" | "game_over">(() => pick("phase", "setup" as const));

  // ── Entitlement counter — observe (never drive) the phase machine ──
  // Init true when a finished game is restored from storage so a refresh on
  // the game-over screen never double-counts. Resets when a new round begins.

  const [assignedRoles, setAssignedRoles]   = useState<AssignedRole[]>(() => pick("assignedRoles", [] as AssignedRole[]));
  const [currentIndex, setCurrentIndex]     = useState(() => pick("currentIndex", 0));
  // Hold-to-reveal state (mirrors Online Mode's onPointerDown/Up pattern)
  const [isPressing, setIsPressing]             = useState(false);
  const [hasRevealedOnce, setHasRevealedOnce]   = useState(() => pick("hasRevealedOnce", false));
  const [isCardFlipped, setIsCardFlipped]       = useState(false);

  // ── Game loop state ──
  const [livePlayers, setLivePlayers]           = useState<LivePlayer[]>(() => pick("livePlayers", [] as LivePlayer[]));
  const [nightStep, setNightStep]               = useState<string>(() => pick("nightStep", "الولد"));
  const [nightActions, setNightActions]         = useState<{ killTarget: string | null; silenceTarget: string | null; investigateTarget: string | null; protectTarget: string | null; magicianHealTarget: string | null; magicianPoisonTarget: string | null }>(() => pick("nightActions", { killTarget: null, silenceTarget: null, investigateTarget: null, protectTarget: null, magicianHealTarget: null, magicianPoisonTarget: null }));
  const [selectedTarget, setSelectedTarget]     = useState<string | null>(null);
  const [investigatedTarget, setInvestigatedTarget] = useState<string | null>(() => pick("investigatedTarget", null as string | null));
  // dayResult shape changed for Phase 3 (multi-death). Storage key bumped to V2 so legacy sessions hydrate clean.
  const [dayResult, setDayResult]               = useState<{ deaths: DeathEntry[]; silenced: string | null }>(() => pick("dayResultV2", { deaths: [] as DeathEntry[], silenced: null as string | null }));
  const [nightCount, setNightCount]             = useState(() => pick("nightCount", 1));
  const [confirmExecute, setConfirmExecute]     = useState<string | null>(null);
  const [daySubPhase, setDaySubPhase]           = useState<"results" | "discussion" | "voting_tally" | "vote_tie" | "no_quorum" | "justification" | "final_vote">(() => pick("daySubPhase", "results" as const));

  // ── Magician (الساحر) — configurable potion capacity ──
  // The magician owns two independent flags. Depending on `magicianPotionMode`
  // chosen in setup, they behave either as two separate potions ("dual") or as
  // a single shared potion that locks both flags on first use ("single").
  // Persistence key bumped to V3 since the shape changed again.
  const [magicianState, setMagicianState] = useState<{ hasHeal: boolean; hasPoison: boolean }>(
    () => pick("magicianStateV3", { hasHeal: true, hasPoison: true })
  );
  // Setup-time configuration: "dual" (default — two separate potions) or
  // "single" (one shared potion). Persists so the user's preference carries
  // across new games until they change it.
  const [magicianPotionMode, setMagicianPotionMode] = useState<"dual" | "single">(
    () => SETUP.magicianPotionMode,
  );
  // Transient per-night UI choices (reset at the start of every magician turn)
  const [magicianHealUsedThisNight, setMagicianHealUsedThisNight] = useState(false);
  const [magicianPoisonTarget, setMagicianPoisonTarget]           = useState<string | null>(null);
  // Magician blind-commit UI: actions → optional poison_pick / heal_success (auto-advances).
  const [magicianUiPhase, setMagicianUiPhase] = useState<"actions" | "poison_pick" | "heal_success">("actions");
  const magicianHealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMagicianPoisonRef = useRef<string | null>(null);

  // ── House Rules (إعدادات المجلس) ──
  // boyInheritsAce: when true, if the Ace (الإكة) is dead, the Boy (الولد)
  // inherits her silence ability and may perform BOTH a kill and a silence in
  // a single combined screen on his turn. Default false. Persists as a user
  // preference for subsequent games.
  const [boyInheritsAce, setBoyInheritsAce] = useState<boolean>(
    () => SETUP.boyInheritsAce,
  );

  // ── Pass-the-Phone Mode (نظام تمرير الجوال) ──
  // When enabled, the distribution phase shows a full-screen blind/lock
  // gate before each player's role card. Prevents over-the-shoulder peeks
  // while passing the device. Persisted across reloads like other house
  // rules; the transient `isBlindScreen` flag below is intentionally NOT
  // persisted — it always resets to the mode's default on phase entry.
  const [isPassPhoneMode, setIsPassPhoneMode] = useState<boolean>(
    () => SETUP.isPassPhoneMode,
  );
  const [isBlindScreen, setIsBlindScreen] = useState<boolean>(false);
  // Game speed preset (drives the 3 timers). Persists across sessions.
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>(
    () => SETUP.gameSpeed,
  );
  // ── Custom speed timings (مخصص) ──
  // Host-defined values for the three timers, used only when gameSpeed
  // === "custom". Defaults mirror the "medium" preset so toggling to
  // custom feels neutral. Persisted independently so the host's custom
  // values survive even while a named preset is active, and re-appear
  // the next time they switch back to "مخصص".
  const [customSpeeds, setCustomSpeeds] = useState<SpeedTimings>(
    () => SETUP.customSpeedsV1,
  );
  // Resolved active timings: custom→customSpeeds, otherwise the named preset.
  // Single source of truth for every timer site in the app.
  const speedPreset = gameSpeed === "custom"
    ? { ...customSpeeds, labelAr: "مخصص" }
    : SPEED_PRESETS[gameSpeed];
  // Transient per-night boy picks (only used in inheritance mode — the standard
  // boy still uses the shared `selectedTarget`). Reset on entry to the boy turn
  // and on every game-reset path.
  const [boyKillTarget, setBoyKillTarget]       = useState<string | null>(null);
  const [boySilenceTarget, setBoySilenceTarget] = useState<string | null>(null);

  // ── Night cinematic transitions ──
  const [nightTransition, setNightTransition]         = useState<"none" | "city_sleeps" | "role_wakes" | "role_sleeps" | "city_wakes">(() => pick("nightTransition", "none" as const));
  const [nightTransitionLabel, setNightTransitionLabel] = useState<string>(() => pick("nightTransitionLabel", ""));
  const nightTransitionNextRef                         = useRef<(() => void) | null>(null);
  const postRevealRef                                  = useRef<(() => void) | null>(null);
  const [isNightKillReveal, setIsNightKillReveal]     = useState(() => pick("isNightKillReveal", false));

  // ── Day/night timers — local epoch ms passed to <Countdown /> ──
  const [timerEndsAt, setTimerEndsAt]   = useState<number | null>(null);

  // ── Smart voting engine ──
  const [voteCounts, setVoteCounts]         = useState<Record<string, number>>(() => pick("voteCounts", {} as Record<string, number>));
  const [accusedPlayer, setAccusedPlayer]   = useState<string | null>(() => pick("accusedPlayer", null as string | null));
  const [finalVoteFor, setFinalVoteFor]     = useState(() => pick("finalVoteFor", 0));
  const [finalVoteAgainst, setFinalVoteAgainst] = useState(() => pick("finalVoteAgainst", 0));

  // ── Win condition + post-execution screens ──
  const [gameOver, setGameOver]               = useState<{ winner: "town" | "mafia" | "madman"; killerName: string | null } | null>(() => pick("gameOver", null as { winner: "town" | "mafia" | "madman"; killerName: string | null } | null));

  // ── Phase 3: Avenger interrupt flow ──
  // When an avenger dies, the normal flow pauses and we collect their revenge pick(s)
  // before resuming to either morning announcement (resumeTo="morning") or night start (resumeTo="night").
  const [avengerFlow, setAvengerFlow] = useState<{
    queue: string[];                  // names of avengers awaiting revenge (FIFO)
    deaths: DeathEntry[];             // accumulated deaths so far this resolution
    silenced: string | null;          // silence carries over to morning UI
    resumeTo: "morning" | "night";    // where to land after the queue drains
    primaryName: string | null;       // for the post-execution reveal cinematic
  } | null>(() => pick("avengerFlow", null as any));
  const [executionReveal, setExecutionReveal] = useState<{ name: string; role: string; color: string } | null>(() => pick("executionReveal", null as { name: string; role: string; color: string } | null));
  // Day-execution multi-death summary: shown after the primary execution reveal
  // when a cascade (twin link or avenger revenge) produced extra casualties,
  // so the narrator can announce ALL deaths to the village before night begins.
  const [executionResult, setExecutionResult] = useState<{ deaths: DeathEntry[]; primaryName: string } | null>(() => pick("executionResult", null as { deaths: DeathEntry[]; primaryName: string } | null));

  // ── Night 15-second action timer ──
  const [nightTimerExpired, setNightTimerExpired] = useState(false);
  // ── Narrator voice-over mute (SFX / victory clips stay audible) ──
  const [isNarratorMuted, setIsNarratorMuted] = useState(
    () => SETUP.isNarratorMuted,
  );

  // ── Expansion Pack state (UI only — logic wired in future sprint) ──
  // Persisted so the user's add-on selection (Twins / Madman / Avenger /
  // Magician) survives reloads AND the "Play Again with same players" flow.
  const [isModsEnabled, setIsModsEnabled] = useState<boolean>(() => SETUP.isModsEnabled);
  const [activeMods, setActiveMods] = useState<Record<string, boolean>>(
    () => SETUP.activeMods,
  );
  const toggleMod = (id: string) => {
    setActiveMods(prev => {
      if (prev[id]) return { ...prev, [id]: false }; // always allow turning off
      // Premium gate — a locked role (not owned, no all-access) can never be enabled.
      const itemId = MOD_TO_ITEM[id];
      if (itemId && !entitlements?.has_all_access
        && !(entitlements?.owned_items?.includes(itemId) ?? false)) {
        return prev;
      }
      // minPlayers guard — hard block regardless of UI state
      const mod = EXPANSION_MODS.find(m => m.id === id);
      if (mod && players.length < mod.minPlayers) return prev;
      // Vanilla reserve: always keep at least 1 citizen slot free
      const capacity = players.length - BASE_ROLES_COUNT - 1;
      if (capacity <= 0) return prev;
      const usedSlots = Object.entries(prev)
        .filter(([, on]) => on)
        .reduce((sum, [modId]) => sum + (MOD_COST[modId] ?? 1), 0);
      if (usedSlots + (MOD_COST[id] ?? 1) > capacity) return prev; // budget exceeded
      return { ...prev, [id]: true };
    });
  };

  // Premium safety: once entitlements are known, force OFF any active mod the
  // user does not own (e.g. a stale selection persisted from a prior session or
  // a different account) so a paid role can never leak into the deck.
  useEffect(() => {
    if (!entitlements) return;
    setActiveMods(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [id, on] of Object.entries(prev)) {
        const itemId = MOD_TO_ITEM[id];
        if (on && itemId && !entitlements.has_all_access
          && !entitlements.owned_items.includes(itemId)) {
          next[id] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [entitlements]);

  // Auto-reset: turn off mods that violate minPlayers or exceed vanilla-reserve capacity
  useEffect(() => {
    const count = players.length;
    // capacity = player slots minus base roles minus 1 vanilla citizen reserve
    const capacity = count - BASE_ROLES_COUNT - 1;
    if (capacity <= 0) {
      setActiveMods(EXPANSION_MODS.reduce((acc, m) => ({ ...acc, [m.id]: false }), {} as Record<string, boolean>));
      return;
    }
    setActiveMods(prev => {
      let used = 0;
      const next = { ...prev };
      for (const mod of EXPANSION_MODS) {
        if (next[mod.id]) {
          const cost = MOD_COST[mod.id] ?? 1;
          // First: minPlayers check — then: slot budget check
          if (count < mod.minPlayers || used + cost > capacity) {
            next[mod.id] = false;
          } else {
            used += cost;
          }
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.length]);

  // ── Persist setup preferences independently (survives reload + empty roster) ──
  useEffect(() => {
    saveSetupPrefs({
      isPassPhoneMode,
      boyInheritsAce,
      isModsEnabled,
      activeMods,
      magicianPotionMode,
      gameSpeed,
      customSpeedsV1: customSpeeds,
      isNarratorMuted,
    });
  }, [
    isPassPhoneMode,
    boyInheritsAce,
    isModsEnabled,
    activeMods,
    magicianPotionMode,
    gameSpeed,
    customSpeeds,
    isNarratorMuted,
  ]);

  // ── Sync in-game narrator snapshot to localStorage on every change ──
  useEffect(() => {
    if (phase === "setup" && players.length === 0) {
      clearNarratorState();
      return;
    }
    saveNarratorState({
      phase, players, assignedRoles, currentIndex, hasRevealedOnce,
      livePlayers, nightStep, nightActions, investigatedTarget,
      dayResultV2: dayResult, nightCount, daySubPhase, nightTransition, nightTransitionLabel,
      isNightKillReveal, voteCounts, accusedPlayer, finalVoteFor,
      finalVoteAgainst, gameOver, executionReveal,
      magicianStateV3: magicianState, magicianPotionMode, boyInheritsAce, isPassPhoneMode, gameSpeedV1: gameSpeed, avengerFlow, executionResult,
      isModsEnabled, activeMods,
      customSpeedsV1: customSpeeds,
    });
  }, [
    phase, players, assignedRoles, currentIndex, hasRevealedOnce,
    livePlayers, nightStep, nightActions, investigatedTarget,
    dayResult, nightCount, daySubPhase, nightTransition, nightTransitionLabel,
    isNightKillReveal, voteCounts, accusedPlayer, finalVoteFor,
    finalVoteAgainst, gameOver, executionReveal,
    magicianState, magicianPotionMode, boyInheritsAce, isPassPhoneMode, gameSpeed, avengerFlow, executionResult,
    isModsEnabled, activeMods, customSpeeds,
  ]);

  // ── Audio Manager — preloaded cache for zero-delay playback ──
  const audioCache     = useRef<Record<string, HTMLAudioElement>>({});
  const currentPlaying = useRef<HTMLAudioElement | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const files = [
      "start.m4a",
      "w1.m4a", "w2.m4a", "w3.m4a",
      "e1.m4a", "e2.m4a", "e3.m4a",
      "s1.m4a", "s2.m4a", "s3.m4a",
      "b1.m4a", "b2.m4a", "b3.m4a",
      "wh1.m4a", "wh2.m4a", "wh3.m4a",
      "morning.m4a", "success.m4a", "fail.m4a",
      "mafia_win.mp3", "town_win.mp3", "madman_win.mp3",
    ];
    files.forEach(file => {
      const audio = new Audio("/audio/" + file);
      audio.preload = "auto";
      audioCache.current[file] = audio;
    });
    narratorAudioCacheRef.current = audioCache.current;
    // Register the non-narrator SFX (flip / reveal / heartbeat) in the shared
    // SFX layer so they overlap the narrator instead of interrupting it.
    preloadSfx();

    // ── One-time audio unlock on first user interaction ───────────────────
    // Browsers (esp. iOS Safari) block audio until a user gesture resumes
    // the AudioContext. We resume it + call .load() on every cached element
    // to warm the media pipeline, so subsequent .play() calls from async
    // effects/timers don't get silently rejected.
    const unlock = () => {
      const ctx = getOrCreateGameAudioContext();
      if (ctx?.state === "suspended") void ctx.resume();
      Object.values(audioCache.current).forEach(a => {
        try { a.load(); } catch { /* ignored */ }
      });
      unlockSfx();
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);

  const playGameAudio = (fileName: string) => {
    if (isNarratorVoiceTrack(fileName) && isNarratorMuted) return;
    if (currentPlaying.current) {
      currentPlaying.current.pause();
      currentPlaying.current.currentTime = 0;
    }
    const audio = audioCache.current[fileName];
    if (!audio) return;
    audio.currentTime = 0;
    currentPlaying.current = audio;
    activeAudioRef.current = audio;
    narratorActiveAudioRef.current = audio;
    audio.play().catch(() => {});
  };

  // Hard-stop any playing cue. Called by every game-reset path so a returning
  // narrator never hears a pending transition cue leak into the setup screen.
  const stopAllAudio = () => {
    if (currentPlaying.current) {
      currentPlaying.current.pause();
      currentPlaying.current.currentTime = 0;
      currentPlaying.current = null;
    }
  };

  // ── Night-phase audio maps — used by inline triggers at every
  // setNightTransition() site so audio fires in the same callstack frame
  // as the state change (no decoupled effect, no race conditions).
  const NIGHT_WAKE_AUDIO:   Record<string, string> = { "الولد": "w1.m4a", "الإكة": "e1.m4a", "magician": "wh1.m4a", "الشايب": "s1.m4a", "البنت": "b1.m4a" };
  const NIGHT_PROMPT_AUDIO: Record<string, string> = { "الولد": "w2.m4a", "الإكة": "e2.m4a", "magician": "wh2.m4a", "الشايب": "s2.m4a", "البنت": "b2.m4a" };
  const NIGHT_SLEEP_AUDIO:  Record<string, string> = { "الولد": "w3.m4a", "الإكة": "e3.m4a", "magician": "wh3.m4a", "الشايب": "s3.m4a", "البنت": "b3.m4a" };
  const playRoleAudio = (kind: "wake" | "prompt" | "sleep", role: string) => {
    const map = kind === "wake" ? NIGHT_WAKE_AUDIO : kind === "prompt" ? NIGHT_PROMPT_AUDIO : NIGHT_SLEEP_AUDIO;
    const file = map[role];
    if (file) playGameAudio(file);
  };

  // ── Victory audio — fires once when entering game_over ──
  useEffect(() => {
    if (phase !== "game_over" || !gameOver) return;
    if (gameOver.winner === "madman") {
      playGameAudio("madman_win.mp3");
      return;
    }
    playGameAudio(gameOver.winner === "mafia" ? "mafia_win.mp3" : "town_win.mp3");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, gameOver?.winner]);

  // ── State-to-audio mapping (reveal/day only) ──
  // Night-phase audio is no longer driven here. It is now triggered inline
  // at every setNightTransition() call site so the .play() request fires in
  // the same callstack as the state change — eliminating the duplicate
  // "start.m4a" race and ensuring audio aligns 1:1 with the UI transition.
  useEffect(() => {
    if (phase === "reveal" && isNightKillReveal) {
      playGameAudio("success.m4a");
    } else if (phase === "day" && daySubPhase === "results" && dayResult.deaths.length === 0) {
      playGameAudio("fail.m4a");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, daySubPhase]);

  // ── Auto-advance night transitions after delay ──
  useEffect(() => {
    if (nightTransition === "none") return;
    const startAudio = audioCache.current["start.m4a"];
    const citySleepsDelay = (startAudio && !isNaN(startAudio.duration))
      ? (startAudio.duration * 1000) + 1500
      : 4500;
    const delay =
      nightTransition === "city_sleeps" ? citySleepsDelay :
      nightTransition === "role_wakes"  ? 2000 :
      nightTransition === "role_sleeps" ? 3500 : // 2500ms cinematic + 1000ms dramatic pause
      2500; // city_wakes
    const t = setTimeout(() => {
      const next = nightTransitionNextRef.current;
      nightTransitionNextRef.current = null;
      setNightTransition("none");
      // If there's no follow-up transition queued, we've landed on the role
      // action prompt — play the role's "prompt" cue (w2/e2/s2/b2). Otherwise
      // the chained `next()` callback below will trigger its own audio.
      if (!next) {
        playRoleAudio("prompt", nightStep);
      }
      next?.();
    }, delay);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nightTransition]);

  // ── 15-second night action timer — resets when role changes ──
  useEffect(() => {
    if (phase !== "night" || nightTransition !== "none") return;
    setNightTimerExpired(false);
    const turnMs = speedPreset.turn * 1000;
    setTimerEndsAt(Date.now() + turnMs);
    const t = setTimeout(() => setNightTimerExpired(true), turnMs);
    return () => clearTimeout(t);
  }, [nightStep, nightTransition, phase, speedPreset.turn]);

  // ── Auto-skip: when night timer hits 0, fire the same action as the skip button ──
  useEffect(() => {
    if (!nightTimerExpired) return;
    if (phase !== "night" || nightTransition !== "none") return;
    handleNightStep();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nightTimerExpired]);

  // ── Tie / No-quorum cinematic — 4 s display then auto-advance to night ──
  useEffect(() => {
    if (phase !== "day" || (daySubPhase !== "vote_tie" && daySubPhase !== "no_quorum")) return;
    const t = setTimeout(() => handleStartNextNight(), 4000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daySubPhase, phase]);

  // ── Screen Wake Lock — keeps host device awake during the session ──
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => {
    const acquire = async () => {
      try {
        if ("wakeLock" in navigator) {
          // @ts-ignore — WakeLock API may not be in all TS lib versions
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch { /* device may deny the request silently */ }
    };
    acquire();
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  // ── beforeunload guard — warns host before accidental tab close/refresh ──
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (phase !== "setup" && phase !== "game_over") {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [phase]);

  const addPlayer = () => {
    const trimmed = newPlayer.trim();
    if (!trimmed) return;
    if (players.includes(trimmed)) {
      setInputError("هذا الاسم موجود مسبقاً، الرجاء اختيار اسم آخر");
      return;
    }
    setPlayers((prev) => [...prev, trimmed]);
    setNewPlayer("");
    setInputError(null);
    inputRef.current?.focus();
  };

  const removePlayer = (name: string) =>
    setPlayers((prev) => prev.filter((p) => p !== name));

  const handleDistribute = () => {
    // ── Gatekeeper: block a new round once the free trial is spent ──
    if (!canStartGame) {
      if (!entitlements) {
        // Entitlements not loaded yet (or fetch failed) — stay fail-closed,
        // re-verify, and ask the user to retry rather than wrongly upselling.
        void refreshEntitlements();
        toast.error("جارٍ التحقق من اشتراكك. يرجى المحاولة بعد لحظات.");
        return;
      }
      openShop();
      toast.error("لقد استهلكت تجربتك المجانية (مرتين). يرجى الاشتراك لمتابعة اللعب!");
      return;
    }
    // Pass activeMods only when the master toggle is on; otherwise pure-vanilla deck
    const modsForDeck = isModsEnabled ? activeMods : {};
    const roles = generateAndShuffleRoles(players, modsForDeck);
    setAssignedRoles(roles);
    setCurrentIndex(0);
    setIsPressing(false);
    setHasRevealedOnce(false);
    // Blind-screen gate seeds from the mode toggle: ON → every card is
    // locked until the named player taps to unlock; OFF → legacy behavior
    // (card visible immediately, flip-to-reveal).
    setIsBlindScreen(isPassPhoneMode);
    setPhase("pre_distribution");

    // 🛑 الضربة القاضية: الخصم المباشر فوراً عند ضغط الزر 🛑
    void incrementGamesPlayed();
  };

  // Night order: wolf → shadow → magician → seer → guard
  // Magician is inserted between shadow and seer per the expansion spec.
  // Once the magician has spent their one potion, their phase is skipped
  // entirely on every subsequent night — no UI, no pause, no waste of time.
  const getNightOrder = (lp: LivePlayer[]): string[] =>
    (["الولد", "الإكة", "magician", "الشايب", "البنت"] as const).filter(r => {
      if (!lp.some(p => p.role === r && p.deathReason !== "vote")) return false;
      // Skip magician only when BOTH flags are exhausted. In dual mode each
      // potion is independent, so the phase keeps coming until both are spent.
      if (r === "magician" && !magicianState.hasHeal && !magicianState.hasPoison) return false;
      return true;
    });

  // ── Win condition checker — called after every death ──
  const checkWinCondition = (players: LivePlayer[]): "town" | "mafia" | null => {
    const killerAlive = players.find(p => p.role === "الولد")?.isAlive ?? false;
    if (!killerAlive) return "town";
    const alive      = players.filter(p => p.isAlive);
    const aliveMafia = alive.filter(p => p.role === "الولد" || p.role === "الإكة").length;
    const aliveTown  = alive.filter(p => p.role !== "الولد" && p.role !== "الإكة").length;
    if (aliveMafia >= aliveTown) return "mafia";
    return null;
  };

  // ── Gender helper — returns the correct verb form for a role ──
  const FEMININE_ROLES = new Set(["البنت", "الإكة"]);
  const roleWakes = (role: string) => FEMININE_ROLES.has(role) ? "تصحى" : "يصحى";
  const roleSleeps = (role: string) => FEMININE_ROLES.has(role) ? "تنام" : "ينام";

  // ── Helper: launch city_sleeps → role_wakes → night action ──
  const startNightWithTransition = (order: string[]) => {
    const firstRole = order[0] ?? "الولد";
    nightTransitionNextRef.current = () => {
      setNightTransitionLabel(`${getRoleName(firstRole)} ${roleWakes(firstRole)}`);
      nightTransitionNextRef.current = null;
      setNightTransition("role_wakes");
      playRoleAudio("wake", firstRole);
    };
    setNightTransitionLabel("الجميع ينام الكل يغمض عينه");
    setNightTransition("city_sleeps");
    playGameAudio("start.m4a"); // direct call — guarantees audio on every night start
  };

  const handleNext = () => {
    const isLast = currentIndex === assignedRoles.length - 1;
    if (isLast) {
      const lp: LivePlayer[] = assignedRoles.map(ar => ({ name: ar.name, role: ar.role, color: ar.color, isAlive: true, isSilenced: false, deathReason: null }));
      const order = getNightOrder(lp);
      setLivePlayers(lp);
      setNightStep(order[0] ?? "الولد");
      setNightActions({ killTarget: null, silenceTarget: null, investigateTarget: null, protectTarget: null, magicianHealTarget: null, magicianPoisonTarget: null });
      setSelectedTarget(null);
      setBoyKillTarget(null);
      setBoySilenceTarget(null);
      setIsPressing(false);
      setHasRevealedOnce(false);
      setIsCardFlipped(false);
      setNightCount(1);
      // Reset magician potions for a fresh game
      setMagicianState({ hasHeal: true, hasPoison: true });
      setMagicianHealUsedThisNight(false);
      setMagicianPoisonTarget(null);
      setMagicianUiPhase("actions");
      startNightWithTransition(order);
      setPhase("night");
    } else {
      // ── Snappy, spoiler-safe transition ──
      // The flip card is keyed by `currentIndex`, so bumping the index
      // unmounts the old motion.div and mounts a fresh one at rotateY:0
      // (front face). No mid-flip role peek, no lingering name — the new
      // player's card appears instantly, already hidden.
      setIsCardFlipped(false);
      setIsPressing(false);
      setHasRevealedOnce(false);
      // Re-arm the blind gate for the next player — only if the mode is on.
      // When off this is a no-op and the legacy flow is fully preserved.
      setIsBlindScreen(isPassPhoneMode);
      setCurrentIndex((i) => i + 1);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ── Phase 3: centralized death pipeline ──
  // resolveDeaths: takes a seed list of deaths, cascades twin links until
  // stable, and returns (a) the full death list with causes and (b) the
  // subset of avengers (alive at start) whose revenge needs to fire.
  // ─────────────────────────────────────────────────────────────────────────
  const resolveDeaths = (initial: DeathEntry[], players: LivePlayer[]): { deaths: DeathEntry[]; avengers: string[] } => {
    const deathMap = new Map<string, DeathEntry>();
    for (const d of initial) {
      const p = players.find(pl => pl.name === d.name);
      if (p?.isAlive && !deathMap.has(d.name)) deathMap.set(d.name, d);
    }
    // Twin cascade — loop until no new partners are added (handles edge chains)
    let changed = true;
    while (changed) {
      changed = false;
      for (const name of Array.from(deathMap.keys())) {
        const player = players.find(pl => pl.name === name);
        if (!player || player.role !== "twin") continue;
        const partner = players.find(pl => pl.role === "twin" && pl.name !== name && pl.isAlive);
        if (partner && !deathMap.has(partner.name)) {
          deathMap.set(partner.name, { name: partner.name, cause: "twin" });
          changed = true;
        }
      }
    }
    // Avengers — only those who were alive at the start of this resolution
    const avengers: string[] = [];
    for (const name of deathMap.keys()) {
      const p = players.find(pl => pl.name === name);
      if (p?.role === "avenger" && p.isAlive) avengers.push(name);
    }
    return { deaths: Array.from(deathMap.values()), avengers };
  };

  // Apply a death set to livePlayers with a single deathReason; optionally apply silence.
  // silenceTarget=null means "do not modify silence" — for revenge picks mid-flow we don't re-silence.
  const applyDeaths = (
    players: LivePlayer[],
    deaths: DeathEntry[],
    reason: "vote" | "night",
    silenceTarget: string | null,
    overrideSilence: boolean,
  ): LivePlayer[] => {
    const deathSet = new Set(deaths.map(d => d.name));
    return players.map(p => {
      const dying = deathSet.has(p.name);
      return {
        ...p,
        isAlive:     dying ? false : p.isAlive,
        isSilenced:  overrideSilence
          ? (silenceTarget !== null && p.name === silenceTarget && !dying)
          : p.isSilenced,
        deathReason: dying ? reason : p.deathReason,
      };
    });
  };

  // Finalize a morning resolution: surface the death list, run win check,
  // play the cinematic reveal of the first victim if any, then land on the day phase.
  const finalizeMorning = (deaths: DeathEntry[], silenced: string | null, players: LivePlayer[]) => {
    setDayResult({ deaths, silenced });
    const winner = checkWinCondition(players);
    if (winner) {
      const killerName = players.find(p => p.role === "الولد")?.name ?? null;
      setGameOver({ winner, killerName });
      setPhase("game_over");
      return;
    }
    if (deaths.length > 0) {
      const first = deaths[0];
      const dp = players.find(pl => pl.name === first.name);
      if (dp) {
        setExecutionReveal({ name: first.name, role: dp.role, color: ROLE_META[dp.role]?.color ?? "#555555" });
        postRevealRef.current = () => { setDaySubPhase("results"); setPhase("day"); };
        triggerHaptic([200, 100, 200, 100, 400]);
        setIsNightKillReveal(true);
        setPhase("reveal");
        return;
      }
    }
    setDaySubPhase("results");
    setPhase("day");
  };

  // Begin the next night for the given player snapshot. Centralized so both
  // single-death (post-reveal) and multi-death (post-results-screen) execution
  // flows enter the night the same way.
  const proceedToNextNight = (players: LivePlayer[]) => {
    const order = getNightOrder(players);
    setNightStep(order[0] ?? "الولد");
    setSelectedTarget(null);
    setInvestigatedTarget(null);
    setNightCount(n => n + 1);
    setMagicianHealUsedThisNight(false);
    setMagicianPoisonTarget(null);
    setMagicianUiPhase("actions");
    startNightWithTransition(order);
    setPhase("night");
  };

  // Finalize a day-execution resolution. Win check first (covers Avenger
  // revenge that flips the game), then cinematic reveal of the executed
  // player. If the cascade produced extra deaths (twin link or avenger
  // revenge), land on a multi-death summary screen so the narrator can
  // announce every casualty to the village BEFORE night begins. Otherwise
  // proceed directly to night after the reveal.
  const finalizeAfterExecution = (deaths: DeathEntry[], players: LivePlayer[], primaryName: string) => {
    const hasExtraDeaths = deaths.length > 1;
    const winner = checkWinCondition(players);
    // Win check is DEFERRED when a cascade produced extra deaths (twin link
    // or avenger revenge). Even if the cascade ends the game, the narrator
    // must first see the multi-death summary so the village hears every
    // casualty announced. The execution_results screen re-runs the win check
    // when the narrator advances and routes to game_over there if needed.
    if (winner && !hasExtraDeaths) {
      const killerName = players.find(p => p.role === "الولد")?.name ?? null;
      setGameOver({ winner, killerName });
      setPhase("game_over");
      return;
    }
    const dp = players.find(p => p.name === primaryName);
    if (!dp) {
      // Defensive: no player to reveal. Honor the same rule — show the
      // summary first if there were extra deaths, otherwise resolve directly.
      if (hasExtraDeaths) {
        setExecutionResult({ deaths, primaryName });
        setPhase("execution_results");
      } else if (winner) {
        const killerName = players.find(p => p.role === "الولد")?.name ?? null;
        setGameOver({ winner, killerName });
        setPhase("game_over");
      } else {
        proceedToNextNight(players);
      }
      return;
    }
    setExecutionReveal({ name: primaryName, role: dp.role, color: ROLE_META[dp.role]?.color ?? "#555555" });
    postRevealRef.current = () => {
      if (hasExtraDeaths) {
        setExecutionResult({ deaths, primaryName });
        setPhase("execution_results");
      } else {
        proceedToNextNight(players);
      }
    };
    triggerHaptic([200, 100, 200, 100, 400]);
    setIsNightKillReveal(false);
    setPhase("reveal");
  };

  // Enter (or re-enter) the avenger interrupt phase.
  // Filters out avengers with NO valid targets (auto-skip — they get no
  // revenge but the flow doesn't deadlock). If every queued avenger is
  // skipped, jumps straight to the finalize path instead of stalling.
  const enterAvengerFlow = (
    queue: string[],
    deaths: DeathEntry[],
    silenced: string | null,
    resumeTo: "morning" | "night",
    primaryName: string | null,
    players: LivePlayer[],
  ) => {
    const viable = queue.filter(name => players.some(p => p.isAlive && p.name !== name));
    if (viable.length === 0) {
      setAvengerFlow(null);
      if (resumeTo === "morning") {
        finalizeMorning(deaths, silenced, players);
      } else {
        finalizeAfterExecution(deaths, players, primaryName ?? deaths[0]?.name ?? "");
      }
      return;
    }
    setAvengerFlow({ queue: viable, deaths, silenced, resumeTo, primaryName });
    setPhase("avenger_revenge");
  };

  // Process a single Avenger's revenge pick. Cascades twin link on the
  // chosen target, applies the death, then either continues the queue
  // (via enterAvengerFlow, which handles auto-skip) or resumes the
  // original flow (morning or night).
  const handleAvengerPick = (targetName: string) => {
    if (!avengerFlow) return;
    const reason: "vote" | "night" = avengerFlow.resumeTo === "night" ? "vote" : "night";
    const initial: DeathEntry[] = [{ name: targetName, cause: "avenger" }];
    const { deaths: cascaded, avengers: newAvengers } = resolveDeaths(initial, livePlayers);
    const updated = applyDeaths(livePlayers, cascaded, reason, null, false);
    setLivePlayers(updated);
    // Merge into the accumulated death list (dedup by name; first cause wins)
    const merged: DeathEntry[] = [...avengerFlow.deaths];
    for (const d of cascaded) {
      if (!merged.some(m => m.name === d.name)) merged.push(d);
    }
    // Drop the current avenger; append any newly discovered avengers
    const remainingQueue = [
      ...avengerFlow.queue.slice(1),
      ...newAvengers.filter(n => !avengerFlow.queue.includes(n) && n !== avengerFlow.queue[0]),
    ];
    enterAvengerFlow(remainingQueue, merged, avengerFlow.silenced, avengerFlow.resumeTo, avengerFlow.primaryName, updated);
  };

  const handleNightStep = () => {
    const newActions = { ...nightActions };
    // ── Boy inheritance: if Ace is dead AND house rule is on, the Boy commits
    // BOTH kill and silence from his combined screen on his turn. Otherwise
    // the boy step is a vanilla kill-only commit using `selectedTarget`.
    const aceDead = !livePlayers.some(p => p.role === "الإكة" && p.isAlive);
    const boyInheritActive = nightStep === "الولد" && boyInheritsAce && aceDead;
    if (nightStep === "الولد") {
      if (boyInheritActive) {
        newActions.killTarget    = boyKillTarget;
        newActions.silenceTarget = boySilenceTarget;
      } else {
        newActions.killTarget    = selectedTarget;
      }
    }
    if (nightStep === "الإكة") {
      // Guard: if Ace is dead (e.g. cycling as a phantom step on a non-vote
      // death), do NOT clobber a silenceTarget previously written by the Boy
      // during inheritance mode. Only a living Ace may set her own silence.
      const aceIsAlive = livePlayers.some(p => p.role === "الإكة" && p.isAlive);
      if (aceIsAlive) newActions.silenceTarget = selectedTarget;
    }
    if (nightStep === "الشايب") newActions.investigateTarget = selectedTarget;
    if (nightStep === "البنت")  newActions.protectTarget     = selectedTarget;

    if (nightStep === "magician") {
      // Potion consumption depends on `magicianPotionMode`:
      //   • "dual"   — heal and poison are independent. Each click only
      //                burns its own flag, and both may fire in the same night.
      //   • "single" — heal and poison share one potion. Either click
      //                permanently locks BOTH flags for the rest of the game.
      // Either way, a passive skip / timeout / "ينام الساحر" with no
      // explicit selection leaves both flags untouched.
      const healCommitted   = magicianHealUsedThisNight;
      const poisonTarget    = magicianPoisonTarget ?? pendingMagicianPoisonRef.current;
      const poisonCommitted = !!poisonTarget;

      if (healCommitted && nightActions.killTarget) {
        newActions.magicianHealTarget = nightActions.killTarget;
      }
      if (poisonCommitted) {
        newActions.magicianPoisonTarget = poisonTarget;
      }
      pendingMagicianPoisonRef.current = null;

      if (healCommitted || poisonCommitted) {
        if (magicianPotionMode === "single") {
          setMagicianState({ hasHeal: false, hasPoison: false });
        } else {
          setMagicianState(prev => ({
            hasHeal:   prev.hasHeal   && !healCommitted,
            hasPoison: prev.hasPoison && !poisonCommitted,
          }));
        }
      }
    }

    const order = getNightOrder(livePlayers);
    const idx   = order.indexOf(nightStep);

    if (idx < order.length - 1) {
      // ── role_sleeps → role_wakes → next action ──
      const nextRole = order[idx + 1];
      nightTransitionNextRef.current = () => {
        setNightActions(newActions);
        setNightStep(nextRole);
        setSelectedTarget(null);
      setBoyKillTarget(null);
      setBoySilenceTarget(null);
        setInvestigatedTarget(null);
        // Reset magician transients on entry to magician turn
        if (nextRole === "magician") {
          setMagicianHealUsedThisNight(false);
          setMagicianPoisonTarget(null);
          setMagicianUiPhase("actions");
        }
        setNightTransitionLabel(`${getRoleName(nextRole)} ${roleWakes(nextRole)}`);
        nightTransitionNextRef.current = null;
        setNightTransition("role_wakes");
        playRoleAudio("wake", nextRole);
      };
      setNightTransitionLabel(`${getRoleName(nightStep)} ${roleSleeps(nightStep)}..`);
      setNightTransition("role_sleeps");
      playRoleAudio("sleep", nightStep);
    } else {
      // ── role_sleeps → city_wakes → compute results → win check ──
      const goToMorning = () => {
        const { killTarget, protectTarget, silenceTarget, magicianHealTarget, magicianPoisonTarget: poisonT } = newActions;
        // Boy's victim survives if EITHER protected by Girl OR healed by Magician
        const boyVictim    = (killTarget && killTarget !== protectTarget && killTarget !== magicianHealTarget) ? killTarget : null;
        // Magician's poison: separate, unprotectable casualty
        const poisonVictim = poisonT ?? null;
        // Build seed deaths for the centralized pipeline (twin cascade + avenger interrupt handled there)
        const seed: DeathEntry[] = [];
        if (boyVictim)    seed.push({ name: boyVictim,    cause: "mafia"  });
        if (poisonVictim && poisonVictim !== boyVictim) seed.push({ name: poisonVictim, cause: "poison" });
        const { deaths, avengers } = resolveDeaths(seed, livePlayers);
        const updated = applyDeaths(livePlayers, deaths, "night", silenceTarget, true);
        setLivePlayers(updated);
        setNightActions({ killTarget: null, silenceTarget: null, investigateTarget: null, protectTarget: null, magicianHealTarget: null, magicianPoisonTarget: null });
        setSelectedTarget(null);
      setBoyKillTarget(null);
      setBoySilenceTarget(null);
        if (avengers.length > 0) {
          // Pause the morning announcement until every dead avenger has chosen revenge
          // (auto-skips avengers with no valid targets via enterAvengerFlow)
          enterAvengerFlow(avengers, deaths, silenceTarget, "morning", null, updated);
          return;
        }
        finalizeMorning(deaths, silenceTarget, updated);
      };
      // role_sleeps fires first, its callback chains into city_wakes
      nightTransitionNextRef.current = () => {
        nightTransitionNextRef.current = goToMorning;
        setNightTransitionLabel("الكل يصحى");
        setNightTransition("city_wakes");
        playGameAudio("morning.m4a");
      };
      setNightTransitionLabel(`${getRoleName(nightStep)} ${roleSleeps(nightStep)}..`);
      setNightTransition("role_sleeps");
      playRoleAudio("sleep", nightStep);
    }
  };

  const handleEndGame = () => {
    if (!window.confirm("هل أنت متأكد أنك تريد إنهاء اللعبة والعودة للرئيسية؟")) return;
    stopAllAudio();
    setAssignedRoles([]);
    setLivePlayers([]);
    setCurrentIndex(0);
    setIsPressing(false);
    setHasRevealedOnce(false);
    setNightActions({ killTarget: null, silenceTarget: null, investigateTarget: null, protectTarget: null, magicianHealTarget: null, magicianPoisonTarget: null });
    setDayResult({ deaths: [], silenced: null });
    setNightCount(1);
    setInvestigatedTarget(null);
    setDaySubPhase("results");
    setNightTransition("none");
    nightTransitionNextRef.current = null;
    setGameOver(null);
    setExecutionReveal(null);
    setExecutionResult(null);
    setNightTimerExpired(false);
    setTimerEndsAt(null);
    setVoteCounts({});
    setAccusedPlayer(null);
    setFinalVoteFor(0);
    setFinalVoteAgainst(0);
    // Reset magician potions
    setMagicianState({ hasHeal: true, hasPoison: true });
    setMagicianHealUsedThisNight(false);
    setMagicianPoisonTarget(null);
    setMagicianUiPhase("actions");
    // Reset boy inheritance transients
    setBoyKillTarget(null);
    setBoySilenceTarget(null);
    // House rules / setup prefs persist via STORAGE_SETUP_PREFS — not reset here.
    setIsBlindScreen(false);
    // Reset avenger interrupt flow
    setAvengerFlow(null);
    setPhase("setup");
  };

  const resetVotingState = () => {
    setTimerEndsAt(null);
    setVoteCounts({});
    setAccusedPlayer(null);
    setFinalVoteFor(0);
    setFinalVoteAgainst(0);
    setConfirmExecute(null);
  };

  const handleStartNextNight = () => {
    const updatedPlayers = livePlayers.map(p => ({ ...p, isSilenced: false }));
    setLivePlayers(updatedPlayers);
    const order = getNightOrder(updatedPlayers);
    setNightStep(order[0] ?? "الولد");
    setSelectedTarget(null);
    setInvestigatedTarget(null);
    setDaySubPhase("results");
    setNightCount(n => n + 1);
    // Reset magician transients only — magicianState (potions) carries over
    setMagicianHealUsedThisNight(false);
    setMagicianPoisonTarget(null);
    setMagicianUiPhase("actions");
    resetVotingState();
    startNightWithTransition(order);
    setPhase("night");
  };

  const handleExecute = (name: string) => {
    const executedPlayer = livePlayers.find(p => p.name === name);
    if (!executedPlayer) return;

    // ── Madman Win — INSTANT bypass of all standard win/cascade logic ──
    // Per spec: if the executed player is the madman, the game ends immediately.
    if (executedPlayer.role === "madman") {
      const updated = livePlayers.map(p =>
        p.name === name
          ? { ...p, isAlive: false, deathReason: "vote" as const, isSilenced: false }
          : { ...p, isSilenced: false }
      );
      setLivePlayers(updated);
      resetVotingState();
      setGameOver({ winner: "madman", killerName: name });
      setPhase("game_over");
      return;
    }

    // ── Standard execution: cascade twin link, queue avenger revenge, then resolve ──
    const seed: DeathEntry[] = [{ name, cause: "vote" }];
    const { deaths, avengers } = resolveDeaths(seed, livePlayers);
    const updated = applyDeaths(livePlayers, deaths, "vote", null, true);
    setLivePlayers(updated);
    resetVotingState();

    if (avengers.length > 0) {
      // Pause execution flow until every avenger picks; resume into next night.
      // (auto-skips avengers with no valid targets via enterAvengerFlow)
      enterAvengerFlow(avengers, deaths, null, "night", name, updated);
      return;
    }
    finalizeAfterExecution(deaths, updated, name);
  };

  const remaining     = Math.max(0, MIN_PLAYERS - players.length);
  const canDistribute = players.length >= MIN_PLAYERS;

  // ─────────────────────────────────────────────────────────────────────────
  // ── Unified Top Navbar — iOS-style sticky bar above every phase.
  //    The container is pointer-events-none so taps fall through to any
  //    content that visually sits under the bar (e.g. scroll lists that
  //    extend to the top of the viewport). Each button re-enables pointer
  //    events for itself, so the navbar never blocks underlying UI.
  //
  //    Layout (RTL): first DOM child = visually RIGHT → primary nav action
  //    (Back arrow on setup, X for an active game). Last DOM child =
  //    visually LEFT → Mute toggle.
  //
  //    Rendered fixed so it floats above motion.div phase transitions
  //    without inheriting their transforms.
  const navAction = phase === "setup"
    ? { onClick: onBack,        Icon: ArrowRight, title: "العودة للقائمة الرئيسية" }
    : { onClick: handleEndGame, Icon: X,          title: "إنهاء اللعبة"           };
  const floatingButtons = (
    <div
      dir="rtl"
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-4 md:px-8 lg:px-12 py-4 pointer-events-none">
      {/* RIGHT — primary nav action (Back when on setup, Close otherwise) */}
      <button
        onClick={navAction.onClick}
        title={navAction.title}
        aria-label={navAction.title}
        className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full text-white/70 hover:text-white transition-colors active:scale-90"
        style={{
          backgroundColor: "rgba(13,13,13,0.55)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}>
        <navAction.Icon size={18} strokeWidth={2} />
      </button>

      {/* LEFT — narrator VO mute (SFX / victory stay audible) */}
      <button
        onClick={() => setIsNarratorMuted(m => !m)}
        title={isNarratorMuted ? "تشغيل الراوي الصوتي" : "كتم الراوي الصوتي"}
        aria-label={isNarratorMuted ? "تشغيل الراوي الصوتي" : "كتم الراوي الصوتي"}
        className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full transition-colors active:scale-90 hover:text-white"
        style={{
          backgroundColor: "rgba(13,13,13,0.55)",
          border: `1px solid ${isNarratorMuted ? "rgba(211,47,47,0.32)" : "rgba(255,255,255,0.06)"}`,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          color: isNarratorMuted ? "#D32F2F" : "rgba(255,255,255,0.70)",
        }}>
        {isNarratorMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
    </div>
  );

  // ── In-flow spacer that reserves room below the fixed navbar (px-5 py-4
  //    + 40px button ≈ 72px). h-16 keeps every phase's first element clear
  //    of the bar without needing per-screen offsets.
  const globalControls = <div className="h-16 shrink-0 w-full" />;

  // ── All phase content lives here so we can wrap it in AnimatePresence ──
  const renderPhaseContent = (): React.ReactNode => {

  // PHASE: pre_distribution — "Everyone Sleep" atmospheric gate
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "pre_distribution") {
    return (
      <PreDistributionScreen
        onStart={() => setPhase("distribution")}
        playGameAudio={playGameAudio}
      />
    );
  }

  // PHASE: distribution
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "distribution" && assignedRoles.length > 0) {
    const current = assignedRoles[currentIndex];
    const meta    = ROLE_META[current.role] ?? ROLE_META["المواطن"];
    const isLast  = currentIndex === assignedRoles.length - 1;

    const CARD_HEIGHT = 320;

    // ── Pass-the-Phone gate ──
    // Intercepts before the role card is even mounted. Only renders when
    // the user explicitly enabled the mode in Settings; otherwise this
    // block is bypassed entirely and the legacy flow runs unchanged.
    if (isPassPhoneMode && isBlindScreen) {
      return (
        <div className="min-h-full w-full flex flex-col px-5 py-8" style={ROOT_STYLE}>
          {globalControls}
          <motion.div
            key={`blind-${currentIndex}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col flex-1 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto items-center justify-center gap-8 text-center">

            {/* Counter — mirrors the distribution header for continuity */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#D32F2F" }}>
                الليلة التعريفية
              </span>
              <p className="text-xs" style={{ color: "#333333" }}>
                {currentIndex + 1} / {assignedRoles.length}
              </p>
            </div>

            {/* Lock seal — pulsing crimson glow signals "secure, do not open" */}
            <motion.div
              initial={{ scale: 0.85 }}
              animate={{ scale: [0.92, 1, 0.92] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="flex items-center justify-center rounded-full"
              style={{
                width: 132, height: 132,
                backgroundColor: "#0A0000",
                border: "1.5px solid #2A0000",
                boxShadow: "0 0 60px #D32F2F33, inset 0 0 30px #00000088",
              }}>
              <Lock size={56} color="#D32F2F" strokeWidth={1.6} />
            </motion.div>

            {/* Pass-to instruction */}
            <div className="flex flex-col items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: "#555555" }}>
                مرر الجوال إلى
              </span>
              <span className="text-3xl font-black text-white" style={{ textShadow: "0 0 24px #D32F2F66" }}>
                {current.name}
              </span>
            </div>

            <div className="flex-1" />

            {/* Reveal CTA — named so only the intended player taps it */}
            <motion.button
              onClick={() => setIsBlindScreen(false)}
              whileTap={{ scale: 0.95 }}
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-300 active:scale-95"
              style={{
                backgroundColor: "#D32F2F",
                color: "#ffffff",
                border: "none",
                boxShadow: "0 0 24px #D32F2F44",
              }}>
              <Unlock size={20} strokeWidth={2} />
              <span>أنا {current.name}، اكشف دوري</span>
            </motion.button>

          </motion.div>
        </div>
      );
    }

    return (
      <div className="min-h-full w-full flex flex-col px-5 py-8" style={ROOT_STYLE}>
        {globalControls}
        <div className="flex flex-col flex-1 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto gap-6">

          {/* ── Header ── */}
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#D32F2F" }}>
              الليلة التعريفية
            </span>
            <h1 className="text-2xl font-black text-white">الجميع ينام..</h1>
            <p className="text-xs" style={{ color: "#333333" }}>
              {currentIndex + 1} / {assignedRoles.length}
            </p>
          </div>

          {/* ── Call-out ── keyed by index so the name swaps instantly on Next */}
          <div key={`callout-${currentIndex}`} className="flex flex-col items-center gap-2 py-4 rounded-2xl"
            style={{ backgroundColor: "#0A0A0A", border: "1px solid #1E1E1E" }}>
            <span className="text-sm font-semibold" style={{ color: "#555555" }}>يستيقظ الآن :</span>
            <span className="text-3xl font-black text-white">{current.name}</span>
          </div>

          {/* ── 3D Flip Card ──
              key={currentIndex} forces a clean unmount/remount on Next so the
              previous player's flip animation and back-face content can't
              linger or peek through during the transition. */}
          <div
            key={currentIndex}
            onClick={() => {
              if (isCardFlipped) return;
              setIsCardFlipped(true);
              playSfx("card_flip.mp3");
              playSfx("role_reveal.mp3");
            }}
            style={{ perspective: "900px", height: CARD_HEIGHT, cursor: isCardFlipped ? "default" : "pointer" }}
            className="w-full select-none">

            {/* Rotating inner wrapper */}
            <motion.div
              whileTap={isCardFlipped ? {} : { scale: 0.98 }}
              animate={{ rotateY: isCardFlipped ? 180 : 0 }}
              transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
              style={{
                width: "100%",
                height: "100%",
                transformStyle: "preserve-3d",
                position: "relative",
              }}>

              {/* ── FRONT (hidden/mystery) ── */}
              <div style={{
                position: "absolute", inset: 0,
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                borderRadius: 16,
                backgroundColor: "#0D0D0D",
                border: "1.5px solid #222222",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 20,
                padding: "20px 16px",
              }}>
                <span style={{ color: "#555555", fontSize: 18, fontWeight: 800, textAlign: "center" }}>قناعك مخفي</span>
                {/* Fixed bounding box for lock icon — identical on both faces */}
                <div style={{ height: 32, width: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Lock size={24} color="#666666" />
                </div>
                {/* Fixed bounding box for mask art — identical on both faces */}
                <div style={{ height: 112, width: 112, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <VenetianMask size={80} color="#2A2A2A" strokeWidth={1.2} />
                </div>
                <span style={{ color: "#444444", fontSize: 13, textAlign: "center" }}>
                  اضغط لتكشف قناع {current.name}
                </span>
              </div>

              {/* ── BACK (role reveal) ── */}
              <div style={{
                position: "absolute", inset: 0,
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
                borderRadius: 16,
                backgroundColor: "#0A0000",
                border: `1.5px solid ${meta.color}55`,
                boxShadow: `0 0 40px ${meta.color}22`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 20,
                padding: "20px 16px",
              }}>
                {/* Slot 1 — mirrors "قناعك مخفي" */}
                <span style={{ color: "#555555", fontSize: 18, fontWeight: 800, textAlign: "center" }}>قناعك يا {current.name} هو</span>

                {/* Slot 2 — fixed bounding box for unlock icon, identical to front face */}
                <div style={{ height: 32, width: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Unlock size={24} color="#4CAF50" />
                </div>

                {/* Slot 3 — fixed bounding box for mask art, identical to front face */}
                <div style={{ height: 112, width: 112, display: "flex", alignItems: "center", justifyContent: "center", filter: `drop-shadow(0 0 20px ${meta.color}99)` }}>
                  <VenetianMask size={80} color={meta.color} strokeWidth={1.2} />
                </div>

                {/* Slot 4 — role name, mirrors instruction text slot */}
                <span style={{
                  color: "#FFFFFF", fontSize: 28, fontWeight: 900,
                  textAlign: "center", lineHeight: 1.2,
                  textShadow: `0 0 24px ${meta.color}66`,
                }}>
                  {getRoleName(current.role)}
                </span>

                {/* Description box — extra slot below the 4 mirrored elements */}
                <div style={{
                  width: "100%",
                  backgroundColor: "rgba(0,0,0,0.45)",
                  borderRadius: 10,
                  padding: "10px 14px",
                  border: `1px solid ${meta.color}22`,
                }}>
                  {/* Smart Twin reveal — show partner's name on the card itself */}
                  {current.role === "twin" && (() => {
                    const otherTwin = assignedRoles.find(r => r.role === "twin" && r.name !== current.name);
                    if (!otherTwin) return null;
                    return (
                      <span style={{ color: "#CCCCCC", fontSize: 13, textAlign: "center", lineHeight: 1.7, display: "block", direction: "rtl", marginBottom: 6, fontWeight: 700 }}>
                        توأمك هو: <span style={{ color: meta.color, fontWeight: 900 }}>{otherTwin.name}</span>
                      </span>
                    );
                  })()}
                  <span style={{ color: "#888888", fontSize: 11, textAlign: "center", lineHeight: 1.7, display: "block", direction: "rtl" }}>
                    {meta.desc}
                  </span>
                </div>
              </div>

            </motion.div>
          </div>

          {/* ── Spacer ── */}
          <div className="flex-1" />

          {/* ── Next player button — only enabled after card is flipped ── */}
          <motion.button
            onClick={handleNext}
            disabled={!isCardFlipped}
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-300 active:scale-95"
            style={{
              backgroundColor: isCardFlipped ? "#D32F2F" : "#111111",
              color:           isCardFlipped ? "#ffffff" : "#2A2A2A",
              border:          isCardFlipped ? "none" : "1px solid #1A1A1A",
              boxShadow:       isCardFlipped ? "0 0 24px #D32F2F44" : "none",
            }}>
            <VenetianMask size={20} strokeWidth={2} />
            <span>{isLast ? "إنهاء الليلة التعريفية" : "اللاعب التالي"}</span>
          </motion.button>

        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: night
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "night") {

    // ── Cinematic interstitial — fullscreen dark/dawn screen ──────────────
    if (nightTransition !== "none") {
      const isDawn    = nightTransition === "city_wakes";
      const isWaking  = nightTransition === "role_wakes";
      const wakeMeta  = isWaking ? (ROLE_META[nightStep] ?? ROLE_META["المواطن"]) : null;
      return (
        <div className="min-h-full w-full flex flex-col items-center justify-center gap-8 px-8" style={ROOT_STYLE}>
          {isDawn
            ? <Sun size={56} color="#FFB300" strokeWidth={1} style={{ opacity: 0.85 }} />
            : isWaking
            ? <VenetianMask size={56} color={wakeMeta!.color} strokeWidth={1} style={{ opacity: 0.8 }} />
            : <Moon size={56} color="#1E1E3A" strokeWidth={1} style={{ opacity: 0.6 }} />}
          <p className="text-2xl font-black text-center leading-relaxed"
            style={{ color: isDawn ? "#FFB300" : isWaking ? wakeMeta!.color : "#2A2A4A" }}>
            {nightTransitionLabel}
          </p>
        </div>
      );
    }

    const aliveTargets = livePlayers.filter(p => p.isAlive);
    const meta         = ROLE_META[nightStep] ?? ROLE_META["المواطن"];
    // Seer (الشايب) step: reveal مافيا vs بريء for each player
    const isSeerStep   = nightStep === "الشايب";

    // Boy inheritance: shared across header label, stepHint, panel, and confirm
    // button. Activates only when the house rule is on AND the Ace is dead.
    const aceAlive          = livePlayers.some(p => p.role === "الإكة" && p.isAlive);
    const boyInheritActiveTop = nightStep === "الولد" && boyInheritsAce && !aceAlive;
    const boyInheritReady     = boyInheritActiveTop && !!boyKillTarget && !!boySilenceTarget;

    const stepHint =
      nightStep === "الولد"   ? (boyInheritActiveTop ? "تذبح وتسكت مين يا ولد؟" : "تذبح مين يا ولد؟") :
      nightStep === "الإكة"   ? "تسكتين مين يا إكة؟" :
      nightStep === "الشايب"  ? "تسأل عن مين يا شايب؟" :
      nightStep === "magician" ? "اختر إجراءك يا ساحر" :
                                "تحمين مين يا بنت؟";
    // Header label gets a special "وريث الزعامة" tag in inheritance mode.
    const roleHeaderLabel = boyInheritActiveTop
      ? `${getRoleName(nightStep)} (وريث الزعامة)`
      : getRoleName(nightStep);

    const arabicNights = ["الأولى","الثانية","الثالثة","الرابعة","الخامسة","السادسة","السابعة","الثامنة","التاسعة","العاشرة"];
    const nightLabel = arabicNights[nightCount - 1] ?? String(nightCount);

    return (
      <div className="min-h-full w-full flex flex-col px-5 py-8" style={ROOT_STYLE}>
        {globalControls}
        <div className="flex flex-col gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto flex-1">

          {/* ── Cinematic header ── */}
          <div className="flex flex-col items-center gap-1 text-center pt-1">
            <Moon size={18} color="#444" strokeWidth={1.5} />
            <h1 className="text-xl font-black text-white mt-1">الليل يخيم على القرية</h1>
            <p className="text-xs" style={{ color: "#333" }}>الليلة {nightLabel} · الجميع ينام..</p>
            {timerEndsAt && (
              <div className="mt-2 w-full px-4 py-3 rounded-xl"
                style={{
                  backgroundColor: nightTimerExpired ? "#1A0000" : "#0D0D0D",
                  border: `1px solid ${nightTimerExpired ? "#D32F2F55" : "#1A1A1A"}`,
                }}>
                <DayTimerBar endsAt={timerEndsAt} maxSeconds={speedPreset.turn} urgentAt={Math.max(3, Math.floor(speedPreset.turn / 3))} />
              </div>
            )}
          </div>

          {/* ── Who's awake — mirrors night action panel header ── */}
          <div className="flex flex-col items-center gap-3 py-5 rounded-2xl"
            style={{ backgroundColor: "#0D0000", border: `1px solid ${meta.color}`, boxShadow: `0 0 20px ${meta.glow}` }}>
            <div className="flex items-center justify-center w-12 h-12 rounded-xl"
              style={{ backgroundColor: meta.color + "18", border: `1px solid ${meta.color}44` }}>
              <VenetianMask size={22} color={meta.color} strokeWidth={1.5} />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-xs font-bold tracking-widest uppercase" style={{ color: meta.color }}>دورك الآن</span>
              <span className="text-2xl font-black" style={{ color: meta.color }}>{roleHeaderLabel}</span>
              <span className="text-sm font-semibold mt-1" style={{ color: "#CCCCCC" }}>{stepHint}</span>
            </div>
          </div>

          {/* ── Mafia ally info banner — shown ONLY to الولد so host can point out partner ── */}
          {nightStep === "الولد" && (() => {
            const ally = livePlayers.find(p => p.isAlive && p.role === "الإكة");
            if (!ally) return null;
            return (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full"
                style={{ backgroundColor: "#1A0000", border: "1px solid #D32F2F44" }}>
                {/* Wolf badge — first in DOM = far right in RTL, exact same w-8 h-8 as index numbers */}
                <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full text-base"
                  style={{ backgroundColor: "rgba(153,27,27,0.3)", border: "1px solid rgba(211,47,47,0.35)" }}>
                  🐺
                </span>
                {/* Label + name — second in DOM = left of badge in RTL */}
                <div className="flex items-center gap-1">
                  <span className="text-xs" style={{ color: "#666666" }}>حليفك (الإكة):</span>
                  <span className="text-sm font-bold text-white">{ally.name}</span>
                </div>
              </div>
            );
          })()}

          {/* ── Boy-synergy banner — shown ONLY to الإكة so she can coordinate her silence with the Boy's planned kill ── */}
          {nightStep === "الإكة" && (() => {
            const boy = livePlayers.find(p => p.role === "الولد" && p.isAlive);
            const boyTarget = nightActions.killTarget;
            if (!boy || !boyTarget) return null;
            return (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full"
                style={{ backgroundColor: "#1A0000", border: "1px solid #D32F2F44" }}>
                <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full text-base"
                  style={{ backgroundColor: "rgba(153,27,27,0.3)", border: "1px solid rgba(211,47,47,0.35)" }}>
                  🔪
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-xs" style={{ color: "#666666" }}>الولد يخطط لاغتيال:</span>
                  <span className="text-sm font-bold text-white">{boyTarget}</span>
                </div>
              </div>
            );
          })()}

          {/* ── Target player list — per-role filtering + badge rules ── */}
          {(() => {
            // Find the player holding this role (dead or alive) for phantom turn detection
            const currentPlayer    = livePlayers.find(p => p.role === nightStep) ?? null;
            const isCurrentPlayerDead = currentPlayer !== null && !currentPlayer.isAlive;

            if (isCurrentPlayerDead) {
              return (
                <div className="flex flex-col items-center gap-3 py-4 px-4 rounded-2xl"
                  style={{ backgroundColor: "#0D0D0D", border: "1px solid #2A2A2A" }}>
                  <span className="text-2xl">👻</span>
                  <p className="text-xs text-center leading-relaxed font-semibold" style={{ color: "#888888" }}>
                    (هذا اللاعب مقتول. تظاهر بسؤاله وانتظر قليلاً للحفاظ على الغموض)
                  </p>
                </div>
              );
            }

            // ── Magician (الساحر) — blind commitment: 3 actions, no victim peek ──
            if (nightStep === "magician") {
              const magMeta   = ROLE_META["magician"];
              const isSingle  = magicianPotionMode === "single";
              const canHeal   = magicianState.hasHeal && !(isSingle && !!magicianPoisonTarget);
              const canPoison = magicianState.hasPoison && !(isSingle && magicianHealUsedThisNight);

              const commitHealAndAdvance = () => {
                triggerHaptic([30, 50, 30]);
                setMagicianHealUsedThisNight(true);
                setMagicianUiPhase("heal_success");
                if (magicianHealTimerRef.current) clearTimeout(magicianHealTimerRef.current);
                magicianHealTimerRef.current = setTimeout(() => {
                  handleNightStep();
                }, 1200);
              };

              const commitPoisonAndAdvance = (targetName: string) => {
                triggerHaptic([30, 50, 30]);
                pendingMagicianPoisonRef.current = targetName;
                setMagicianPoisonTarget(targetName);
                handleNightStep();
              };

              if (magicianUiPhase === "heal_success") {
                return (
                  <div className="px-4 py-6 rounded-2xl text-center"
                    style={{ backgroundColor: "#1B2A0E", border: `1px solid ${magMeta.color}`, boxShadow: `0 0 20px ${magMeta.color}33` }}>
                    <span className="text-base font-black" style={{ color: "#A3E635" }}>
                      تم إنقاذ الضحية بنجاح
                    </span>
                  </div>
                );
              }

              if (magicianUiPhase === "poison_pick") {
                return (
                  <div className="flex flex-col gap-3">
                    <div className="px-4 py-3 rounded-xl text-center"
                      style={{ backgroundColor: "#1A0000", border: "1px solid #D32F2F55" }}>
                      <span className="text-sm font-bold text-white">اختر هدف الاغتيال</span>
                    </div>
                    <div className="flex flex-col gap-2 p-2 rounded-xl"
                      style={{ backgroundColor: "#0A0A0A", border: "1px solid #222" }}>
                      {livePlayers.filter(p => p.isAlive).map((p, idx) => (
                        <div key={p.name}
                          className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                          style={{ backgroundColor: "#141414", border: "1px solid #222222" }}>
                          <div className="flex items-center gap-3">
                            <span className="w-8 h-8 flex items-center justify-center rounded-full font-bold text-sm flex-shrink-0"
                              style={{
                                backgroundColor: "rgba(255,255,255,0.06)",
                                color:           "#888888",
                                border:          "1px solid rgba(255,255,255,0.08)",
                              }}>
                              {idx + 1}
                            </span>
                            <span className="text-sm font-semibold" style={{ color: "#AAAAAA" }}>
                              {p.name}
                            </span>
                          </div>
                          <button
                            onClick={() => commitPoisonAndAdvance(p.name)}
                            className="px-3 py-1 rounded-lg text-xs font-bold transition-all duration-150 active:scale-95 flex-shrink-0"
                            style={{ backgroundColor: "#2A0F0F", color: "#FF8888", border: "1px solid #D32F2F55" }}>
                            اختر
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => { triggerHaptic(20); setMagicianUiPhase("actions"); }}
                      className="w-full px-4 py-2.5 rounded-xl font-bold text-xs transition-all duration-150 active:scale-95"
                      style={{ backgroundColor: "#0A0A0A", color: "#666666", border: "1px solid #1A1A1A" }}>
                      تراجع
                    </button>
                  </div>
                );
              }

              return (
                <div className="flex flex-col gap-3">
                  <button
                    disabled={!canHeal}
                    onClick={commitHealAndAdvance}
                    className="w-full px-4 py-3.5 rounded-xl font-black text-sm transition-all duration-150 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: "#1B2A0E",
                      color:           canHeal ? "#A3E635" : "#666666",
                      border:          `1px solid ${canHeal ? magMeta.color : "#222"}`,
                      boxShadow:       canHeal ? `0 0 16px ${magMeta.color}33` : "none",
                    }}>
                    إنقاذ الضحية (جرعة حياة)
                  </button>
                  <button
                    disabled={!canPoison}
                    onClick={() => { triggerHaptic(20); setMagicianUiPhase("poison_pick"); }}
                    className="w-full px-4 py-3.5 rounded-xl font-black text-sm transition-all duration-150 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: "#141414",
                      color:           canPoison ? "#FF8888" : "#666666",
                      border:          `1px solid ${canPoison ? "#D32F2F55" : "#222"}`,
                      boxShadow:       canPoison ? "0 0 16px #D32F2F22" : "none",
                    }}>
                    اغتيال شخص (جرعة موت)
                  </button>
                  <button
                    onClick={() => { triggerHaptic(20); handleNightStep(); }}
                    className="w-full px-4 py-3.5 rounded-xl font-bold text-sm transition-all duration-150 active:scale-95"
                    style={{ backgroundColor: "#0A0A0A", color: "#AAAAAA", border: "1px solid #1A1A1A" }}>
                    تخطي والنوم
                  </button>
                </div>
              );
            }

            // ── Boy Inheritance (وريث الزعامة) — combined Kill + Silence panel ──
            // Triggered only when the house rule is enabled AND the Ace is dead.
            // Renders two stacked target lists with a clear visual divider so
            // the narrator can pick both victims before pressing the sleep button.
            const aceAliveNow      = livePlayers.some(p => p.role === "الإكة" && p.isAlive);
            const boyInheritActive = nightStep === "الولد" && boyInheritsAce && !aceAliveNow;
            if (boyInheritActive) {
              const boyMeta   = ROLE_META["الولد"];
              const boyAlive  = livePlayers.filter(p => p.isAlive);
              const killList  = boyAlive.filter(p => p.role !== "الولد"); // no self
              const silenceList = boyAlive.filter(p => p.role !== "الولد"); // no self
              const renderTargetList = (
                list: typeof boyAlive,
                selected: string | null,
                onPick: (name: string) => void,
                accent: string,
              ) => (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
                  {list.map((p, idx) => {
                    const isSelected = selected === p.name;
                    const rowBg     = isSelected ? "#1A0000" : "#141414";
                    const rowBorder = isSelected ? accent   : "#222222";
                    return (
                      <button
                        key={p.name}
                        onClick={() => onPick(p.name)}
                        className="flex flex-col items-center justify-center gap-2 px-3 py-3.5 rounded-xl transition-colors duration-200 active:scale-95"
                        style={{ backgroundColor: rowBg, border: `1px solid ${rowBorder}` }}>
                        <span className="w-7 h-7 flex items-center justify-center rounded-full font-bold text-xs flex-shrink-0"
                          style={{
                            backgroundColor: isSelected ? `${accent}22` : "rgba(255,255,255,0.06)",
                            color:           isSelected ? "#ffffff"     : "#888888",
                            border:          `1px solid ${isSelected ? `${accent}66` : "rgba(255,255,255,0.08)"}`,
                          }}>
                          {idx + 1}
                        </span>
                        <span className="text-sm font-semibold text-center leading-tight"
                          style={{ color: isSelected ? "#ffffff" : "#AAAAAA" }}>
                          {p.name}
                        </span>
                        <span className="text-[10px] font-bold tracking-wide"
                          style={{ color: isSelected ? accent : "#444444" }}>
                          {isSelected ? "تم الاختيار" : "اختر"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
              return (
                <div className="flex flex-col gap-4">
                  {/* Inheritance banner */}
                  <div className="px-3 py-2 rounded-xl text-center"
                    style={{ backgroundColor: "#1A0000", border: `1px solid ${boyMeta.color}55` }}>
                    <span className="text-xs font-bold tracking-wide" style={{ color: "#FF8888" }}>
                      وريث الزعامة — الإكة ماتت
                    </span>
                  </div>

                  {/* ── Section A: Kill ── */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-sm font-black" style={{ color: boyMeta.color }}>تذبح مين يا ولد؟</span>
                      {boyKillTarget && (
                        <span className="text-xs font-bold" style={{ color: "#666" }}>· {boyKillTarget}</span>
                      )}
                    </div>
                    {renderTargetList(killList, boyKillTarget, setBoyKillTarget, "#D32F2F")}
                  </div>

                  {/* Clean visual divider between the two sections */}
                  <div className="flex items-center gap-2 px-1">
                    <div className="flex-1 h-px" style={{ backgroundColor: "#1A1A1A" }} />
                    <span className="text-xs font-semibold" style={{ color: "#3A3A3A" }}>ثم</span>
                    <div className="flex-1 h-px" style={{ backgroundColor: "#1A1A1A" }} />
                  </div>

                  {/* ── Section B: Silence ── */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-sm font-black" style={{ color: "#FFB347" }}>تسكت مين يا ولد؟</span>
                      {boySilenceTarget && (
                        <span className="text-xs font-bold" style={{ color: "#666" }}>· {boySilenceTarget}</span>
                      )}
                    </div>
                    {renderTargetList(silenceList, boySilenceTarget, setBoySilenceTarget, "#FFB347")}
                  </div>
                </div>
              );
            }

            // Per-role target pool + smart sorting:
            //   الولد: pool = all alive EXCEPT self. The Ace stays in the pool
            //     but is rendered DISABLED at index 0 — narrator sees the
            //     ally clearly with a wolf glyph but cannot click them.
            //   الإكة: pool = all alive. Boy at index 0, Ace (self) at index 1,
            //     rest follow. Both fully clickable.
            //   البنت: pool = all alive. Girl (self) at index 0 so the
            //     protect-self affordance is the first tap target.
            //   الشايب: pool = all alive except self.
            const allAlive = livePlayers.filter(p => p.isAlive);
            let targetList: typeof allAlive;
            if (nightStep === "الولد") {
              const poolNoSelf = allAlive.filter(p => p.role !== "الولد");
              const ace        = poolNoSelf.find(p => p.role === "الإكة");
              const others     = poolNoSelf.filter(p => p.role !== "الإكة");
              targetList = ace ? [ace, ...others] : others;
            } else if (nightStep === "الإكة") {
              const boy  = allAlive.find(p => p.role === "الولد");
              const ace  = allAlive.find(p => p.role === "الإكة");
              const rest = allAlive.filter(p => p.role !== "الولد" && p.role !== "الإكة");
              targetList = [...(boy ? [boy] : []), ...(ace ? [ace] : []), ...rest];
            } else if (nightStep === "البنت") {
              const girl = allAlive.find(p => p.role === "البنت");
              const rest = allAlive.filter(p => p.role !== "البنت");
              targetList = girl ? [girl, ...rest] : rest;
            } else if (nightStep === "الشايب") {
              targetList = allAlive.filter(p => p.name !== currentPlayer?.name);
            } else {
              targetList = allAlive;
            }

            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
                {targetList.map((p, idx) => {
                  const isSelected      = selectedTarget === p.name;
                  const isCurrentPlayer = currentPlayer !== null && p.name === currentPlayer.name;
                  const isMafiaRole     = p.role === "الولد" || p.role === "الإكة";

                  // ── Friendly-fire lock: Boy can never silence-click the Ace ──
                  const isAllyLocked = nightStep === "الولد" && p.role === "الإكة";

                  // ── Ally badge (حليف): shown only to the other mafia member ──
                  // For الولد this row is the (disabled) Ace; for الإكة it's the Boy.
                  const showAllyBadge =
                    (nightStep === "الولد" && p.role === "الإكة") ||
                    (nightStep === "الإكة" && p.role === "الولد");

                  // ── "أنت" badge: shown on the current player's own row (الإكة & البنت) ──
                  const showSelfBadge =
                    (nightStep === "الإكة" || nightStep === "البنت") && isCurrentPlayer;

                  // ── Seer fog-of-war: badge only after host locks a choice ──
                  const isInvestigated = isSeerStep && investigatedTarget === p.name;
                  const showSeerBadge  = isInvestigated;
                  // Lock all other rows once seer has picked
                  const seerLocked     = isSeerStep && investigatedTarget !== null && !isInvestigated;

                  const isDisabled = isAllyLocked || seerLocked;
                  // Seer reveal: heavily tint the card based on allegiance so
                  // the Narrator sees the result at a glance without reading text.
                  // Seer reveal: vivid solid fill + glow so the result is
                  // unmissable even in a dark room. The revealed card is exempt
                  // from disabled:opacity-30 — it should GLOW, not fade.
                  const rowBg = showSeerBadge
                    ? (isMafiaRole ? "#C62828" : "#2E7D32")
                    : (isSelected ? "#2A0000" : "#141414");
                  const rowBorder = showSeerBadge
                    ? (isMafiaRole ? "#FF5252" : "#69F0AE")
                    : (isSelected ? "#D32F2F" : "#222222");
                  const rowGlow = showSeerBadge
                    ? (isMafiaRole
                        ? "0 0 24px rgba(220,38,38,0.85)"
                        : "0 0 24px rgba(22,163,74,0.85)")
                    : "none";

                  return (
                    <button
                      key={p.name}
                      disabled={isDisabled || (isSeerStep && isInvestigated)}
                      onClick={() => {
                        setSelectedTarget(p.name);
                        if (isSeerStep) setInvestigatedTarget(p.name);
                      }}
                      className={`flex flex-col items-center justify-center gap-2 px-3 py-3.5 rounded-xl transition-colors duration-200 active:scale-95 ${showSeerBadge ? "cursor-default" : "disabled:opacity-30 disabled:cursor-not-allowed"}`}
                      style={{ backgroundColor: rowBg, border: `2px solid ${rowBorder}`, boxShadow: rowGlow }}>

                      {/* Index badge */}
                      <span className="w-7 h-7 flex items-center justify-center rounded-full font-bold text-xs flex-shrink-0"
                        style={{
                          backgroundColor: isSelected ? "rgba(211,47,47,0.18)" : "rgba(255,255,255,0.06)",
                          color:           isSelected ? "#FF6B6B" : "#888888",
                          border: `1px solid ${isSelected ? "rgba(211,47,47,0.4)" : "rgba(255,255,255,0.08)"}`,
                        }}>
                        {idx + 1}
                      </span>

                      {/* Name — wolf glyph appended when this is the Boy's disabled Ace ally */}
                      <span className="text-sm font-semibold text-center leading-tight"
                        style={{ color: isSelected ? "#ffffff" : "#AAAAAA" }}>
                        {p.name}{isAllyLocked ? " 🐺" : ""}
                      </span>

                      {/* Badge stack — at most one wins; kept compact for grid cell */}
                      {showAllyBadge && !isAllyLocked && (
                        <span className="text-[10px] font-bold" style={{ color: "#D32F2F" }}>(حليف 🐺)</span>
                      )}
                      {isAllyLocked && (
                        <span className="text-[10px] font-bold" style={{ color: "#D32F2F" }}>حليفك</span>
                      )}
                      {showSelfBadge && (
                        <span className="text-[10px] font-bold" style={{ color: "#999999" }}>(أنت)</span>
                      )}
                      {showSeerBadge && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: "rgba(255,255,255,0.18)",
                            color:           "#FFFFFF",
                            border:          "1px solid rgba(255,255,255,0.35)",
                          }}>
                          {isMafiaRole ? "مافيا 🐺" : "بريء ✓"}
                        </span>
                      )}

                      {/* Action label — replaces the old standalone "اختر" button */}
                      {!isAllyLocked && (
                        <span className="text-[10px] font-bold tracking-wide"
                          style={{ color: showSeerBadge ? "#FFFFFF" : (isSelected ? "#D32F2F" : "#444444") }}>
                          {isSelected ? "تم الاختيار" : "اختر"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Spacer ── */}
          <div className="flex-1" />

          {/* Magician uses inline action buttons — no bottom sleep control */}
          {nightStep !== "magician" && (() => {
            const currentPlayer       = livePlayers.find(p => p.role === nightStep) ?? null;
            const isCurrentPlayerDead = currentPlayer !== null && !currentPlayer.isAlive;
            const boyInheritActiveBtn = nightStep === "الولد" && boyInheritsAce && !livePlayers.some(p => p.role === "الإكة" && p.isAlive);
            const boyInheritReadyBtn  = boyInheritActiveBtn && !!boyKillTarget && !!boySilenceTarget;
            const hasTarget = boyInheritActiveBtn ? boyInheritReadyBtn : !!selectedTarget;
            return (
              <motion.button
                onClick={handleNightStep}
                disabled={!isCurrentPlayerDead && !hasTarget && !nightTimerExpired}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
                style={{
                  backgroundColor: isCurrentPlayerDead ? "#1A1A1A" : hasTarget ? meta.color : nightTimerExpired ? "#2A2A2A" : "#1A1A1A",
                  color: isCurrentPlayerDead ? "#555555" : hasTarget ? "#ffffff" : nightTimerExpired ? "#888888" : "#333",
                  border: isCurrentPlayerDead ? "1px solid #333" : hasTarget ? "none" : nightTimerExpired ? "1px solid #444" : "1px solid #222",
                  boxShadow: (!isCurrentPlayerDead && hasTarget) ? `0 0 28px ${meta.glow}` : "none",
                }}>
                <Moon size={20} strokeWidth={2} />
                <span>
                  {isCurrentPlayerDead
                    ? `تخطي الدور (ميت)`
                    : selectedTarget
                    ? `${roleSleeps(nightStep)} ${getRoleName(nightStep)}`
                    : nightTimerExpired
                    ? `تخطي دور ${getRoleName(nightStep)}`
                    : `${roleSleeps(nightStep)} ${getRoleName(nightStep)}`}
                </span>
              </motion.button>
            );
          })()}

        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: avenger_revenge — Avenger picks one alive player to take to the grave.
  // Renders a separate UI per pending avenger; loops until the queue drains.
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "avenger_revenge" && avengerFlow && avengerFlow.queue.length > 0) {
    const currentAvenger = avengerFlow.queue[0];
    const targets        = livePlayers.filter(p => p.isAlive && p.name !== currentAvenger);
    const accent         = ROLE_META["avenger"]?.color ?? "#A0522D";
    const accentGlow     = ROLE_META["avenger"]?.glow  ?? "#A0522D33";
    return (
      <div className="min-h-full w-full flex flex-col px-5 py-8 gap-6" style={{ ...ROOT_STYLE, backgroundColor: "#0A0500" }}>
        {globalControls}
        <div className="flex flex-col items-center gap-2 text-center pt-2">
          <div style={{ filter: `drop-shadow(0 0 24px ${accent}99)` }}>
            <Skull size={44} color={accent} strokeWidth={1.2} />
          </div>
          <span className="text-xs font-bold tracking-widest mt-1" style={{ color: accent, letterSpacing: "0.18em" }}>ثأر المنتقم</span>
          <h1 className="text-2xl font-black text-white">المنتقم يختار ضحيته</h1>
          <p className="text-sm font-semibold mt-1" style={{ color: "#888" }}>
            مات <span style={{ color: accent, fontWeight: 900 }}>{currentAvenger}</span> — يأخذ شخصاً واحداً معه للقبر
          </p>
        </div>

        <div className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto px-4 py-3 rounded-2xl flex items-center gap-3"
          style={{ backgroundColor: "#1A0A00", border: `1px solid ${accent}44` }}>
          <VenetianMask size={18} color={accent} strokeWidth={1.5} />
          <span className="text-xs font-semibold" style={{ color: "#AAA" }}>اختر لاعباً واحداً ليلحق به الموت فوراً.</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto">
          {targets.length === 0 ? (
            <p className="col-span-full text-xs text-center py-4" style={{ color: "#666" }}>لا يوجد هدف متاح للانتقام.</p>
          ) : (
            targets.map(p => (
              <button
                key={p.name}
                onClick={() => {
                  triggerHaptic([100, 50, 100]);
                  handleAvengerPick(p.name);
                }}
                className="flex flex-col items-center justify-center gap-2 px-3 py-4 rounded-xl transition-all active:scale-95"
                style={{
                  backgroundColor: "#0D0500",
                  border: `1px solid ${accent}55`,
                  boxShadow: `0 0 14px ${accentGlow}`,
                }}>
                <ChevronRight size={16} color={accent} />
                <span className="text-sm font-semibold text-white text-center">{p.name}</span>
              </button>
            ))
          )}
        </div>

        {avengerFlow.queue.length > 1 && (
          <p className="text-xs text-center" style={{ color: "#444" }}>
            منتقمون آخرون في الانتظار: {avengerFlow.queue.length - 1}
          </p>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: reveal — cinematic reveal of eliminated player's role
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "reveal" && executionReveal) {
    const revealMeta = ROLE_META[executionReveal.role] ?? ROLE_META["المواطن"];
    const continueBtn = (
      <motion.button
        onClick={() => {
          const cb = postRevealRef.current;
          postRevealRef.current = null;
          setExecutionReveal(null);
          cb?.();
        }}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.02 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
        style={{ backgroundColor: "#1A1A1A", color: "#888", border: "1px solid #2A2A2A" }}>
        <ChevronRight size={20} strokeWidth={2} />
        <span>متابعة</span>
      </motion.button>
    );

    if (isNightKillReveal) {
      return (
        <div className="min-h-full w-full flex flex-col items-center justify-center px-5 py-8 gap-8" style={ROOT_STYLE}>
          {globalControls}
          <div className="flex flex-col items-center gap-1 text-center">
            <Skull size={18} color="#555555" strokeWidth={1.5} />
            <span className="text-xs font-bold tracking-widest mt-1" style={{ color: "#555555" }}>اكتشاف</span>
          </div>
          <div className="flex flex-col items-center gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl">
            <div className="w-full flex flex-col items-center gap-4 py-8 px-6 rounded-2xl"
              style={{ backgroundColor: "#0D0D0D", border: "1px solid #33333366", boxShadow: "0 0 40px #11111133" }}>
              <VenetianMask size={56} color="#444444" strokeWidth={1.2} />
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="text-3xl font-black text-white">{executionReveal.name}</span>
                <span className="text-sm leading-relaxed px-4" style={{ color: "#666666" }}>
                  تم العثور على {executionReveal.name} مقتولاً..
                </span>
              </div>
            </div>
          </div>
          {continueBtn}
        </div>
      );
    }

    return (
      <div className="min-h-full w-full flex flex-col items-center justify-center px-5 py-8 gap-8" style={ROOT_STYLE}>
        {globalControls}
        <div className="flex flex-col items-center gap-1 text-center">
          <Skull size={18} color="#D32F2F" strokeWidth={1.5} />
          <span className="text-xs font-bold tracking-widest mt-1" style={{ color: "#D32F2F" }}>تم الاستبعاد</span>
        </div>
        <div className="flex flex-col items-center gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl">
          <div className="w-full flex flex-col items-center gap-4 py-8 px-6 rounded-2xl"
            style={{ backgroundColor: "#0D0000", border: `1px solid ${revealMeta.color}66`, boxShadow: `0 0 40px ${revealMeta.color}22` }}>
            <VenetianMask size={56} color={revealMeta.color} strokeWidth={1.2} />
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="text-3xl font-black text-white">{executionReveal.name}</span>
              <span className="text-xs tracking-widest font-semibold" style={{ color: "#555" }}>كان دوره</span>
              <span className="text-2xl font-black" style={{ color: revealMeta.color }}>
                {getRoleName(executionReveal.role)}
              </span>
              <span className="text-xs text-center px-4 leading-relaxed" style={{ color: "#444" }}>
                {revealMeta.desc}
              </span>
            </div>
          </div>
        </div>
        {continueBtn}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: execution_results — multi-death summary after a day execution
  // cascade (twin link or avenger revenge). The narrator sees every casualty
  // with its cause, then taps the advance button. Win check is DEFERRED to
  // this screen for cascades, so the village always hears the casualties
  // before any game_over routing happens. The button re-runs checkWinCondition
  // on click and routes to game_over (label flips to "إنهاء اللعبة") or night.
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "execution_results" && executionResult) {
    const deathCount = executionResult.deaths.length;
    // Re-evaluate win on the latest snapshot — the cascade that brought us
    // here may have ended the game. If so, the next-button advances to
    // game_over instead of night, and its label flips to "إنهاء اللعبة".
    const pendingWinner = checkWinCondition(livePlayers);
    const advanceLabel  = pendingWinner ? "إنهاء اللعبة" : "بدء الليلة التالية";
    const AdvanceIcon   = pendingWinner ? Skull : Moon;
    return (
      <div className="min-h-full w-full flex flex-col px-5 py-8" style={ROOT_STYLE}>
        {globalControls}
        <div className="flex flex-col gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto flex-1">
          <div className="flex flex-col items-center gap-1 text-center pt-1">
            <Skull size={18} color="#D32F2F" strokeWidth={1.5} />
            <span className="text-xs font-bold tracking-widest mt-1" style={{ color: "#D32F2F" }}>نتيجة الإعدام</span>
            <h1 className="text-2xl font-black text-white">سقط أكثر من ضحية</h1>
          </div>
          <div className="w-full rounded-2xl flex flex-col gap-3 p-4"
            style={{ backgroundColor: "#1A0000", border: "1px solid #D32F2F" }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: "#D32F2F" }} />
              <p className="text-sm font-bold" style={{ color: "#FF6B6B" }}>
                {`بعد الإعدام، سقطت في القرية ${formatCorpsesCount(deathCount)}`}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              {executionResult.deaths.map(d => (
                <div key={d.name} className="flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{ backgroundColor: "#0D0000", border: "1px solid #D32F2F33" }}>
                  <div className="flex items-center gap-2">
                    <Skull size={12} color="#D32F2F" />
                    <span className="text-sm font-bold text-white">{d.name}</span>
                  </div>
                  <span className="text-[10px] font-semibold" style={{ color: "#FF8888", letterSpacing: "0.04em" }}>{DEATH_CAUSE_LABEL[d.cause]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1" />
          <motion.button
            onClick={() => {
              const snapshot = livePlayers;
              setExecutionResult(null);
              // Re-check on the latest snapshot at click time — guarantees
              // the village always sees this summary, then routes correctly.
              const winner = checkWinCondition(snapshot);
              if (winner) {
                const killerName = snapshot.find(p => p.role === "الولد")?.name ?? null;
                setGameOver({ winner, killerName });
                setPhase("game_over");
                return;
              }
              proceedToNextNight(snapshot);
            }}
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
            style={{ backgroundColor: "#D32F2F", color: "#fff", boxShadow: "0 0 32px #D32F2F55" }}>
            <AdvanceIcon size={20} strokeWidth={2} />
            <span>{advanceLabel}</span>
          </motion.button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: game_over — final win/loss screen
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "game_over" && gameOver) {
    const isTownWin   = gameOver.winner === "town";
    const isMadmanWin = gameOver.winner === "madman";
    // Madman win uses bright magenta to clearly distinguish it from town/mafia outcomes
    const accent    = isMadmanWin ? "#E879F9" : (isTownWin ? "#1565C0" : "#D32F2F");
    const bgColor   = isMadmanWin ? "#0A001A" : (isTownWin ? "#000D1A" : "#0D0000");
    const borderCol = isMadmanWin ? "#E879F966" : (isTownWin ? "#1565C066" : "#D32F2F66");
    const glowCol   = isMadmanWin ? "#E879F922" : (isTownWin ? "#1565C022" : "#D32F2F22");
    const headLabel = isMadmanWin ? "فاز المجنون" : (isTownWin ? "فازت القرية" : "فازت المافيا");
    const headIcon  = isTownWin ? <Shield size={56} color={accent} strokeWidth={1.2} /> : <VenetianMask size={56} color={accent} strokeWidth={1.2} />;

    const resetCore = () => {
      stopAllAudio();
      nightTransitionNextRef.current = null;
      setAssignedRoles([]);
      setLivePlayers([]);
      setCurrentIndex(0);
      setIsPressing(false);
      setHasRevealedOnce(false);
      setNightActions({ killTarget: null, silenceTarget: null, investigateTarget: null, protectTarget: null, magicianHealTarget: null, magicianPoisonTarget: null });
      setMagicianState({ hasHeal: true, hasPoison: true });
      setMagicianHealUsedThisNight(false);
      setMagicianPoisonTarget(null);
      setMagicianUiPhase("actions");
      setAvengerFlow(null);
      setDayResult({ deaths: [], silenced: null });
      setNightCount(1);
      setInvestigatedTarget(null);
      setDaySubPhase("results");
      setNightTransition("none");
      setGameOver(null);
      setExecutionReveal(null);
      setExecutionResult(null);
      setNightTimerExpired(false);
      resetVotingState();
    };

    const fullReset = () => {
      resetCore();
      setPlayers([]);
      setPhase("setup");
      clearNarratorState();
    };

    const handlePlayAgainSamePlayers = () => {
      // Replay with the same roster AND the same configuration.
      // resetCore() clears per-game runtime state (votes, deaths, magician
      // potion charges, etc.) but deliberately preserves user-chosen settings:
      // mods (isModsEnabled / activeMods), house rules (boyInheritsAce,
      // isPassPhoneMode, magicianPotionMode), and gameSpeed.
      // We do NOT call clearNarratorState() — that would wipe those settings
      // from localStorage before the next save effect runs. The persistence
      // effect will rewrite the snapshot with the preserved settings and the
      // new player list on the next render.
      const sameNames = assignedRoles.map(p => p.name);
      resetCore();
      setPlayers(sameNames);
      setPhase("setup");
    };

    return (
      <div className="min-h-full w-full flex flex-col items-center justify-center px-5 py-8 gap-6"
        style={{ ...ROOT_STYLE, backgroundColor: bgColor }}>
        {globalControls}

        {/* ── Winner card with pulsing glow ── */}
        <div className="winner-card w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl flex flex-col items-center gap-6 py-12 px-6 rounded-3xl"
          style={{
            ["--glow-sm" as string]: `0 0 40px ${glowCol}, 0 0 80px ${glowCol}`,
            ["--glow-lg" as string]: `0 0 70px ${glowCol}, 0 0 140px ${glowCol}, inset 0 0 30px ${glowCol}`,
            backgroundColor: isTownWin ? "#00081A" : "#0D0000",
            border: `1px solid ${borderCol}`,
          }}>
          <div style={{ filter: `drop-shadow(0 0 18px ${accent}99)` }}>
            {headIcon}
          </div>
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="text-4xl font-black" style={{ color: accent, textShadow: `0 0 28px ${accent}55`, letterSpacing: "0.04em" }}>
              {headLabel}
            </span>
            {isMadmanWin && gameOver.killerName && (
              <p className="text-sm leading-loose" style={{ color: "#666" }}>
                أعدمت القرية المجنون<br />
                <span className="text-base font-black" style={{ color: accent }}>{gameOver.killerName}</span>
                <br />
                <span className="text-xs" style={{ color: "#666" }}>وانتصر بمفرده على الجميع</span>
              </p>
            )}
            {isTownWin && gameOver.killerName && (
              <p className="text-sm leading-loose" style={{ color: "#666" }}>
                تم كشف القاتل<br />
                <span className="text-base font-black" style={{ color: accent }}>{gameOver.killerName}</span>
              </p>
            )}
            {!isTownWin && !isMadmanWin && (
              <p className="text-xs font-semibold" style={{ color: "#444", letterSpacing: "0.18em" }}>
                المافيا تسيطر على القرية
              </p>
            )}
          </div>
        </div>

        {/* ── Last night's victims (shown for Mafia win; lists each casualty + cause) ── */}
        {!isTownWin && !isMadmanWin && (dayResult.deaths.length > 0 || dayResult.silenced) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
            className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl flex flex-col gap-3 px-5 py-4 rounded-2xl"
            style={{
              backgroundColor: "#0A0000",
              border: "1px solid #D32F2F44",
              boxShadow: "inset 0 0 18px #D32F2F18",
            }}>
            <p className="text-xs text-center font-bold tracking-widest" style={{ color: "#D32F2F", letterSpacing: "0.18em" }}>
              ضحايا الليلة الأخيرة
            </p>
            <div className="flex flex-col gap-2">
              {dayResult.deaths.map(d => (
                <div key={d.name} className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ backgroundColor: "#0D0000", border: "1px solid #D32F2F33" }}>
                  {/* Name first in DOM = far right in RTL */}
                  <div className="flex items-center gap-2">
                    <Skull size={12} color="#D32F2F" />
                    <span className="text-sm font-bold" style={{ color: "#FF6B6B" }}>{d.name}</span>
                  </div>
                  <span className="text-[10px] font-semibold" style={{ color: "#888" }}>{DEATH_CAUSE_LABEL[d.cause]}</span>
                </div>
              ))}
              {dayResult.silenced && (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ backgroundColor: "#0D0700", border: "1px solid #FF8F0033" }}>
                  {/* Name first in DOM = far right in RTL */}
                  <span className="text-sm font-bold" style={{ color: "#FFB300" }}>{dayResult.silenced}</span>
                  <span className="text-[10px] font-semibold" style={{ color: "#888" }}>الساكت</span>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Final roles list ── */}
        <div className="flex flex-col gap-2 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl">
          <p className="text-xs text-center font-semibold pb-1" style={{ color: "#2A2A2A", letterSpacing: "0.12em" }}>الأدوار النهائية</p>
          {livePlayers.map(p => {
            const pm = ROLE_META[p.role] ?? ROLE_META["المواطن"];
            return (
              <div key={p.name}
                className="flex items-center justify-between px-3 py-2 rounded-xl"
                style={{ backgroundColor: "#0A0A0A", border: `1px solid ${p.isAlive ? "#1E1E1E" : "#141414"}`, opacity: p.isAlive ? 1 : 0.38 }}>
                {/* Player name + skull — first in DOM = far right in RTL */}
                <div className="flex items-center gap-2">
                  {!p.isAlive && <Skull size={12} color="#3A3A3A" />}
                  <span className="text-xs font-semibold" style={{ color: p.isAlive ? "#AAAAAA" : "#3A3A3A" }}>{p.name}</span>
                </div>
                {/* Role name — last in DOM = far left in RTL */}
                <span className="text-xs font-bold" style={{ color: pm.color }}>{getRoleName(p.role)}</span>
              </div>
            );
          })}
        </div>

        {/* ── Action buttons ── */}
        <div className="flex flex-col gap-3 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl">
          <motion.button
            onClick={handlePlayAgainSamePlayers}
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
            style={{
              backgroundColor: "transparent",
              color: accent,
              border: `1.5px solid ${borderCol}`,
              boxShadow: `0 0 22px ${glowCol}`,
            }}>
            <Shuffle size={20} strokeWidth={2} />
            <span>إعادة اللعبة بنفس اللاعبين</span>
          </motion.button>

          {/* Bottom "العودة للقائمة" removed — the unified top navbar's X
              button now owns this exit, calling handleEndGame which fully
              resets the run and returns to setup. */}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: day — sub-phases: results → discussion → voting_tally → justification → final_vote
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === "day") {
    const alivePlayers = livePlayers.filter(p => p.isAlive);

    const restartGame = () => {
      stopAllAudio();
      nightTransitionNextRef.current = null;
      clearNarratorState();
      setPhase("setup");
      setAssignedRoles([]);
      setLivePlayers([]);
      setCurrentIndex(0);
      setIsPressing(false);
      setHasRevealedOnce(false);
      setNightActions({ killTarget: null, silenceTarget: null, investigateTarget: null, protectTarget: null, magicianHealTarget: null, magicianPoisonTarget: null });
      setMagicianState({ hasHeal: true, hasPoison: true });
      setMagicianHealUsedThisNight(false);
      setMagicianPoisonTarget(null);
      setMagicianUiPhase("actions");
      setAvengerFlow(null);
      setDayResult({ deaths: [], silenced: null });
      setNightCount(1);
      setInvestigatedTarget(null);
      setDaySubPhase("results");
      setNightTransition("none");
      setGameOver(null);
      setExecutionReveal(null);
      setExecutionResult(null);
      setNightTimerExpired(false);
      resetVotingState();
    };

    const restartBtn = (
      <motion.button
        onClick={restartGame}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.02 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        className="w-full flex flex-row-reverse items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold transition-all duration-200 active:scale-95"
        style={{ backgroundColor: "transparent", border: "1px solid #2A2A2A", color: "#555" }}>
        <Shuffle size={16} strokeWidth={2} />
        <span>إعادة اللعبة من البداية</span>
      </motion.button>
    );

    const skipNightBtn = (
      <motion.button
        onClick={handleStartNextNight}
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.02 }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
        style={{ backgroundColor: "#1A1A1A", color: "#888", border: "1px solid #2A2A2A" }}>
        <Moon size={20} strokeWidth={2} />
        <span>بدء الليلة التالية</span>
      </motion.button>
    );

    // ── Multi-death morning banner: lists every casualty with its cause ──
    const deathCount   = dayResult.deaths.length;
    const hasDeaths    = deathCount > 0;
    const morningBanner = (
      <div className="w-full rounded-2xl flex flex-col gap-3 p-4"
        style={{
          backgroundColor: hasDeaths ? "#1A0000" : "#001A0A",
          border: `1px solid ${hasDeaths ? "#D32F2F" : "#33691E"}`,
        }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0"
            style={{ backgroundColor: hasDeaths ? "#D32F2F" : "#4CAF50" }} />
          <p className="text-sm font-bold" style={{ color: hasDeaths ? "#FF6B6B" : "#8BC34A" }}>
            {!hasDeaths
              ? "مرت الليلة بسلام.. لم يمت أحد."
              : `استيقظت القرية على ${formatCorpsesCount(deathCount)}`}
          </p>
        </div>
        {hasDeaths && (
          <div className="flex flex-col gap-1.5">
            {dayResult.deaths.map(d => (
              <div key={d.name} className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ backgroundColor: "#0D0000", border: "1px solid #D32F2F33" }}>
                {/* Name first in DOM = far right in RTL */}
                <div className="flex items-center gap-2">
                  <Skull size={12} color="#D32F2F" />
                  <span className="text-sm font-bold text-white">{d.name}</span>
                </div>
                <span className="text-[10px] font-semibold" style={{ color: "#FF8888", letterSpacing: "0.04em" }}>{DEATH_CAUSE_LABEL[d.cause]}</span>
              </div>
            ))}
          </div>
        )}
        {dayResult.silenced && (
          <p className="text-xs font-semibold" style={{ color: "#FF8F00" }}>والساكت: {dayResult.silenced}</p>
        )}
      </div>
    );

    // ════════════════════════════════════════════
    // SUB-PHASE 1: results — morning announcement only
    // ════════════════════════════════════════════
    if (daySubPhase === "results") {
      return (
        <div className="min-h-full w-full flex flex-col px-5 py-8" style={ROOT_STYLE}>
          {globalControls}
          <div className="flex flex-col gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto flex-1">
            <div className="flex flex-col items-center gap-1 text-center pt-1">
              <Sun size={18} color="#FFB300" strokeWidth={1.5} />
              <span className="text-xs font-bold tracking-widest mt-1" style={{ color: "#FFB300" }}>الصباح</span>
              <h1 className="text-2xl font-black text-white">الكل يصحى</h1>
            </div>
            {morningBanner}
            <div className="flex-1" />
            <motion.button
              onClick={() => {
                setTimerEndsAt(Date.now() + speedPreset.discuss * 1000);
                setDaySubPhase("discussion");
              }}
              whileTap={{ scale: 0.95 }}
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
              style={{ backgroundColor: "#D32F2F", color: "#fff", boxShadow: "0 0 32px #D32F2F55" }}>
              <Users size={20} strokeWidth={2} />
              <span>بدء النقاش</span>
            </motion.button>
            {skipNightBtn}
            {restartBtn}
          </div>
        </div>
      );
    }

    // ════════════════════════════════════════════
    // SUB-PHASE 2: discussion — 60s timer + player list
    // ════════════════════════════════════════════
    if (daySubPhase === "discussion") {
      const startVoting = () => {
        triggerHaptic([50, 100, 50]);
        const init: Record<string, number> = {};
        alivePlayers.forEach(p => { init[p.name] = 0; });
        setVoteCounts(init);
        setTimerEndsAt(null);
        setDaySubPhase("voting_tally");
      };

      return (
        // AutoAdvanceDiscussion removed — discussion no longer auto-advances
        // when the timer hits zero. Host must manually tap "بدء التصويت".
        // DayTimerBar still counts down to 00:00 visually (no phase change).
        <>
          <div className="min-h-full w-full flex flex-col px-5 py-8" style={ROOT_STYLE}>
            {globalControls}
            <div className="flex flex-col gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto flex-1">
              <div className="flex flex-col items-center gap-2 text-center pt-1">
                <span className="text-xs font-bold tracking-widest" style={{ color: "#FFB300" }}>النقاش مفتوح</span>
                <h1 className="text-2xl font-black text-white">الكل يدافع عن نفسه</h1>
                <div className="mt-1 w-full px-4 py-3 rounded-xl" style={{ backgroundColor: "#141414", border: "1px solid #222" }}>
                  <DayTimerBar endsAt={timerEndsAt} maxSeconds={speedPreset.discuss} heartbeat />
                </div>
              </div>
              {morningBanner}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
                {alivePlayers.map((p, idx) => (
                  <div key={p.name}
                    className="flex flex-col items-center gap-2 px-3 py-3.5 rounded-xl"
                    style={{ backgroundColor: "#141414", border: "1px solid #222222" }}>
                    <span className="w-7 h-7 flex items-center justify-center rounded-full font-bold text-xs flex-shrink-0"
                      style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "#888888" }}>
                      {idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-center leading-tight"
                      style={{ color: "#AAAAAA" }}>{p.name}</span>
                    {p.isSilenced && (
                      <span className="text-xs font-bold" style={{ color: "#FF8F00" }}>🤐 ساكت</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex-1" />
              <motion.button
                onClick={startVoting}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
                style={{ backgroundColor: "#D32F2F", color: "#fff", boxShadow: "0 0 32px #D32F2F55" }}>
                <Users size={20} strokeWidth={2} />
                <span>بدء التصويت</span>
              </motion.button>
              {skipNightBtn}
              {restartBtn}
            </div>
          </div>
        </>
      );
    }

    // ════════════════════════════════════════════
    // SUB-PHASE 3: voting_tally — host counts raised hands (individual cap per player)
    // ════════════════════════════════════════════
    if (daySubPhase === "voting_tally") {
      const perPlayerCap = alivePlayers.length;

      const handleCountVotes = () => {
        // ── Absolute-majority rule (النصف + 1) ─────────────────────────────
        // Three distinct outcomes based on vote distribution:
        //
        //   C — Elimination:  maxVotes >= threshold AND single leader
        //       → accused goes to justification sub-phase
        //   B — Actual Tie:   maxVotes >= threshold AND multiple leaders
        //       → "تعادل في الأصوات" cinematic (4s) then night
        //   A — No Quorum:    maxVotes < threshold (or zero votes cast)
        //       → "الأصوات أقل من الحد الأدنى" cinematic (4s) then night
        //
        // Differentiating A from B lets the Narrator give players accurate
        // feedback: a tie is a different situation from insufficient votes.
        const majorityThreshold = Math.floor(alivePlayers.length / 2) + 1;
        const maxVotes = Math.max(0, ...alivePlayers.map(p => voteCounts[p.name] ?? 0));
        const leaders  = alivePlayers.filter(p => (voteCounts[p.name] ?? 0) === maxVotes && maxVotes > 0);

        if (maxVotes >= majorityThreshold && leaders.length === 1) {
          // Condition C: clean majority winner → proceed to trial
          setAccusedPlayer(leaders[0].name);
          setTimerEndsAt(Date.now() + speedPreset.lastWords * 1000);
          setDaySubPhase("justification");
        } else if (maxVotes >= majorityThreshold && leaders.length > 1) {
          // Condition B: threshold met but multiple players share the top count
          setDaySubPhase("vote_tie");
        } else {
          // Condition A: nobody reached majority (includes zero-vote rounds)
          setDaySubPhase("no_quorum");
        }
      };
      return (
        <div className="min-h-full w-full flex flex-col px-5 py-8" style={ROOT_STYLE}>
          {globalControls}
          <div className="flex flex-col gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto flex-1">
            <div className="flex flex-col items-center gap-1 text-center pt-1">
              <span className="text-xs font-bold tracking-widest" style={{ color: "#D32F2F" }}>فرز الأصوات</span>
              <h1 className="text-2xl font-black text-white">كم صوت لكل لاعب؟</h1>
              <span className="text-xs mt-1" style={{ color: "#444" }}>كل لاعب يمكن أن يحصل على {perPlayerCap} أصوات كحد أقصى</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
              {alivePlayers.map((p, idx) => {
                const count  = voteCounts[p.name] ?? 0;
                const canAdd = count < perPlayerCap;
                return (
                  <div key={p.name}
                    className="flex flex-col items-center gap-2 px-2 py-3 rounded-xl"
                    style={{ backgroundColor: "#141414", border: `1px solid ${count > 0 ? "#D32F2F44" : "#222222"}` }}>
                    {/* Number badge */}
                    <span className="w-7 h-7 flex items-center justify-center rounded-full font-bold text-xs flex-shrink-0"
                      style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "#888888" }}>
                      {idx + 1}
                    </span>
                    {/* Name + silenced */}
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-sm font-semibold text-center leading-tight"
                        style={{ color: count > 0 ? "#ffffff" : "#AAAAAA" }}>{p.name}</span>
                      {p.isSilenced && (
                        <span className="text-xs font-bold" style={{ color: "#FF8F00" }}>🤐 ساكت</span>
                      )}
                    </div>
                    {/* Vote count */}
                    <span className="text-2xl font-black tabular-nums leading-none"
                      style={{ color: count > 0 ? "#FF6B6B" : "#333" }}>
                      {count}
                    </span>
                    {/* +/- controls */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setVoteCounts(prev => ({ ...prev, [p.name]: (prev[p.name] ?? 0) + 1 }))}
                        disabled={!canAdd}
                        className="w-8 h-8 rounded-lg font-black text-base transition-all active:scale-90 flex items-center justify-center disabled:opacity-30"
                        style={{ backgroundColor: "#001A00", color: "#8BC34A", border: "1px solid #8BC34A44" }}>
                        +
                      </button>
                      <button
                        onClick={() => setVoteCounts(prev => ({ ...prev, [p.name]: Math.max(0, (prev[p.name] ?? 0) - 1) }))}
                        disabled={count === 0}
                        className="w-8 h-8 rounded-lg font-black text-base transition-all active:scale-90 flex items-center justify-center disabled:opacity-30"
                        style={{ backgroundColor: "#2A0000", color: "#D32F2F", border: "1px solid #D32F2F44" }}>
                        −
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex-1" />
            <motion.button
              onClick={handleCountVotes}
              whileTap={{ scale: 0.95 }}
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
              style={{ backgroundColor: "#D32F2F", color: "#fff", boxShadow: "0 0 32px #D32F2F55" }}>
              <Users size={20} strokeWidth={2} />
              <span>فرز الأصوات</span>
            </motion.button>
            {skipNightBtn}
            {restartBtn}
          </div>
        </div>
      );
    }

    // ════════════════════════════════════════════
    // SUB-PHASE 3b: vote_tie — cinematic tie screen (4 s, then auto-night)
    // ════════════════════════════════════════════
    if (daySubPhase === "vote_tie") {
      return (
        <div className="min-h-full w-full flex flex-col items-center justify-center px-6" style={ROOT_STYLE}>
          {globalControls}
          <div className="flex flex-col items-center gap-6 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl text-center">
            <div style={{ filter: "drop-shadow(0 0 32px #FF8F0066)" }}>
              <VenetianMask size={72} color="#FF8F00" strokeWidth={1} />
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold tracking-widest" style={{ color: "#FF8F00" }}>تعادل</span>
              <h1 className="text-2xl font-black text-white leading-snug">
                تعادل في الأصوات..
              </h1>
              <p className="text-base font-semibold" style={{ color: "#AAAAAA" }}>
                لن يتم إعدام أحد اليوم
              </p>
            </div>
            <div className="mt-2 px-6 py-3 rounded-2xl" style={{ backgroundColor: "#111111", border: "1px solid #FF8F0033" }}>
              <p className="text-xs" style={{ color: "#555" }}>القرية تستعد للنوم...</p>
            </div>
          </div>
        </div>
      );
    }

    // ════════════════════════════════════════════
    // SUB-PHASE 3c: no_quorum — votes insufficient (4 s, then auto-night)
    // Distinct from vote_tie: nobody reached the majority threshold,
    // no tie occurred — simply not enough votes were cast.
    // ════════════════════════════════════════════
    if (daySubPhase === "no_quorum") {
      return (
        <div className="min-h-full w-full flex flex-col items-center justify-center px-6" style={ROOT_STYLE}>
          {globalControls}
          <div className="flex flex-col items-center gap-6 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl text-center">
            <div style={{ filter: "drop-shadow(0 0 32px #55555566)" }}>
              <VenetianMask size={72} color="#555555" strokeWidth={1} />
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold tracking-widest" style={{ color: "#555555" }}>لا يوجد إجماع</span>
              <h1 className="text-2xl font-black text-white leading-snug">
                الأصوات أقل من الحد الأدنى
              </h1>
              <p className="text-base font-semibold" style={{ color: "#AAAAAA" }}>
                لم يتم إعدام أحد
              </p>
            </div>
            <div className="mt-2 px-6 py-3 rounded-2xl" style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A" }}>
              <p className="text-xs" style={{ color: "#555" }}>القرية تستعد للنوم...</p>
            </div>
          </div>
        </div>
      );
    }

    // ════════════════════════════════════════════
    // SUB-PHASE 4: justification — accused defends, 1-min timer
    // ════════════════════════════════════════════
    if (daySubPhase === "justification") {
      return (
        <div className="min-h-full w-full flex flex-col px-5 py-8" style={ROOT_STYLE}>
          {globalControls}
          <div className="flex flex-col gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto flex-1">
            <div className="flex flex-col items-center gap-1 text-center pt-1">
              <span className="text-xs font-bold tracking-widest" style={{ color: "#D32F2F" }}>المحاكمة</span>
              <h1 className="text-2xl font-black text-white">{accusedPlayer} يدافع عن نفسه</h1>
            </div>
            <div className="flex flex-col items-center gap-3 py-6 rounded-2xl"
              style={{ backgroundColor: "#0D0000", border: "1px solid #D32F2F44" }}>
              <VenetianMask size={36} color="#D32F2F" strokeWidth={1.5} />
              <span className="text-lg font-black text-white">{accusedPlayer}</span>
              <p className="text-xs text-center" style={{ color: "#555" }}>{`لديه ${speedPreset.lastWords} ثانية للدفاع عن نفسه`}</p>
              <div className="mt-2 w-full px-4 py-3 rounded-xl" style={{ backgroundColor: "#1A0000", border: "1px solid #D32F2F33" }}>
                <DayTimerBar endsAt={timerEndsAt} maxSeconds={speedPreset.lastWords} />
              </div>
            </div>
            <div className="flex-1" />
            <motion.button
              onClick={() => { triggerHaptic([50, 100, 50]); setTimerEndsAt(null); setDaySubPhase("final_vote"); }}
              whileTap={{ scale: 0.95 }}
              whileHover={{ scale: 1.02 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
              style={{ backgroundColor: "#D32F2F", color: "#fff", boxShadow: "0 0 32px #D32F2F55" }}>
              <Users size={20} strokeWidth={2} />
              <span>بدء التصويت النهائي</span>
            </motion.button>
            {skipNightBtn}
            {restartBtn}
          </div>
        </div>
      );
    }

    // ════════════════════════════════════════════
    // SUB-PHASE 5: final_vote — 👍 vs 👎 relative majority (أوافق > أعارض)
    // ════════════════════════════════════════════
    const finalTotalVoters = alivePlayers.length;
    const finalVotesUsed   = finalVoteFor + finalVoteAgainst;
    const canExecute       = finalVoteFor > finalVoteAgainst;

    const handleFinalVerdict = () => {
      if (canExecute) {
        handleExecute(accusedPlayer!);
      } else {
        handleStartNextNight();
      }
    };
    return (
      <div className="min-h-full w-full flex flex-col px-5 py-8" style={ROOT_STYLE}>
        {globalControls}
        <div className="flex flex-col gap-5 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto flex-1">
          <div className="flex flex-col items-center gap-1 text-center pt-1">
            <span className="text-xs font-bold tracking-widest" style={{ color: "#D32F2F" }}>التصويت النهائي</span>
            <h1 className="text-2xl font-black text-white">هل يُعدَم {accusedPlayer}؟</h1>
          </div>
          <div className="flex gap-3">
            {/* Agree counter */}
            <div className="flex-1 flex flex-col items-center gap-3 py-5 rounded-2xl"
              style={{ backgroundColor: "#001A00", border: "1px solid #33691E" }}>
              <span className="text-2xl">👍</span>
              <span className="text-3xl font-black" style={{ color: "#8BC34A" }}>{finalVoteFor}</span>
              <span className="text-xs font-bold" style={{ color: "#4CAF50" }}>أوافق على الإعدام</span>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setFinalVoteFor(n => Math.max(0, n - 1))}
                  disabled={finalVoteFor === 0}
                  className="w-9 h-9 rounded-lg font-black text-lg transition-all active:scale-90 flex items-center justify-center disabled:opacity-30"
                  style={{ backgroundColor: "#0A2A0A", color: "#8BC34A", border: "1px solid #4CAF5044" }}>
                  −
                </button>
                <button
                  onClick={() => setFinalVoteFor(n => n + 1)}
                  disabled={finalVotesUsed >= finalTotalVoters}
                  className="w-9 h-9 rounded-lg font-black text-lg transition-all active:scale-90 flex items-center justify-center disabled:opacity-30"
                  style={{ backgroundColor: "#1A3A1A", color: "#8BC34A", border: "1px solid #4CAF5066" }}>
                  +
                </button>
              </div>
            </div>
            {/* Disagree counter */}
            <div className="flex-1 flex flex-col items-center gap-3 py-5 rounded-2xl"
              style={{ backgroundColor: "#1A0000", border: "1px solid #D32F2F44" }}>
              <span className="text-2xl">👎</span>
              <span className="text-3xl font-black" style={{ color: "#FF6B6B" }}>{finalVoteAgainst}</span>
              <span className="text-xs font-bold" style={{ color: "#D32F2F" }}>أعارض الإعدام</span>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setFinalVoteAgainst(n => Math.max(0, n - 1))}
                  disabled={finalVoteAgainst === 0}
                  className="w-9 h-9 rounded-lg font-black text-lg transition-all active:scale-90 flex items-center justify-center disabled:opacity-30"
                  style={{ backgroundColor: "#2A0000", color: "#D32F2F", border: "1px solid #D32F2F44" }}>
                  −
                </button>
                <button
                  onClick={() => setFinalVoteAgainst(n => n + 1)}
                  disabled={finalVotesUsed >= finalTotalVoters}
                  className="w-9 h-9 rounded-lg font-black text-lg transition-all active:scale-90 flex items-center justify-center disabled:opacity-30"
                  style={{ backgroundColor: "#3A0000", color: "#D32F2F", border: "1px solid #D32F2F66" }}>
                  +
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1" />
          <motion.button
            onClick={canExecute ? () => handleExecute(accusedPlayer!) : handleFinalVerdict}
            disabled={finalVotesUsed === 0}
            whileTap={finalVotesUsed > 0 ? { scale: 0.95 } : {}}
            whileHover={finalVotesUsed > 0 ? { scale: 1.02 } : {}}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200"
            style={{
              backgroundColor: canExecute ? "#D32F2F" : finalVotesUsed > 0 ? "#1B5E20" : "#1A1A1A",
              color: finalVotesUsed > 0 ? "#fff" : "#555555",
              boxShadow: canExecute ? "0 0 32px #D32F2F55" : finalVotesUsed > 0 ? "0 0 32px #2E7D3255" : "none",
              cursor: finalVotesUsed > 0 ? "pointer" : "not-allowed",
            }}>
            <Users size={20} strokeWidth={2} />
            <span>
              {canExecute
                ? `إعدام ${accusedPlayer} ⚖️`
                : finalVotesUsed > 0
                ? `العفو عن ${accusedPlayer} 🕊️`
                : "سجّل الأصوات أولاً"}
            </span>
          </motion.button>
          {skipNightBtn}
          {restartBtn}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE: setup (default)
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full w-full flex flex-col px-5 pt-3 pb-8" style={ROOT_STYLE}>
      {globalControls}
      <div className="flex flex-col gap-6 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto flex-1">

        {/* ── Header ── */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Monitor size={18} color="#D32F2F" strokeWidth={1.8} />
            <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#D32F2F" }}>طور المجلس</span>
          </div>
          <h1 className="text-2xl font-black text-white text-right">إعداد اللاعبين</h1>
          <p className="text-sm text-right" style={{ color: "#555555" }}>أضف أسماء الحاضرين في المجلس</p>
        </div>

        {/* ── Add Player Input ── */}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={newPlayer}
              onChange={(e) => { setNewPlayer(e.target.value); setInputError(null); }}
              onKeyDown={(e) => e.key === "Enter" && addPlayer()}
              placeholder="اسم اللاعب (مثال: أحمد)"
              maxLength={20}
              className="flex-1 rounded-2xl text-white text-sm outline-none placeholder-neutral-600"
              style={{
                backgroundColor: "#0D0D0D",
                border: `1px solid ${inputError ? "#7A1A1A" : "#2A2A2A"}`,
                direction: "rtl",
                padding: "13px 16px",
                transition: "border-color 0.15s",
              }}
            />
            <button
              onClick={addPlayer}
              disabled={!newPlayer.trim()}
              className="flex items-center justify-center w-12 h-12 rounded-2xl flex-shrink-0 transition-all duration-150 active:scale-95"
              style={{
                backgroundColor: newPlayer.trim() ? "#D32F2F" : "#1A1A1A",
                border: "1px solid transparent",
              }}>
              <Plus size={20} color={newPlayer.trim() ? "#fff" : "#333"} strokeWidth={2.5} />
            </button>
          </div>
          {inputError && (
            <p className="text-xs text-right font-semibold px-1 animate-pulse"
              style={{ color: "#C62828" }}>
              {inputError}
            </p>
          )}
        </div>

        {/* ── Players Counter — sits just above the (scrollable) list so the
            narrator can see the current roster size at a glance even when the
            list is scrolled. ── */}
        {players.length > 0 && (
          <div className="flex items-center justify-end px-1 -mb-1">
            <span className="text-[11px] font-semibold tracking-wide" style={{ color: "#666666" }}>
              {`عدد اللاعبين: ${players.length}`}
            </span>
          </div>
        )}

        {/* ── Players List — capped scroll height keeps the bottom CTA visible
            on small screens regardless of roster size. ── */}
        {players.length > 0 ? (
          <div className="flex flex-col rounded-2xl overflow-y-auto"
            style={{ border: "1px solid #1E1E1E", backgroundColor: "#0A0A0A", maxHeight: "min(42vh, 360px)" }}>
            {players.map((name, idx) => (
              <div key={name} className="flex items-center justify-between px-4 py-3.5"
                style={{ borderBottom: idx < players.length - 1 ? "1px solid #141414" : "none" }}>
                {/* Right group: number badge + name (first in DOM = far right in RTL) */}
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                    style={{ backgroundColor: "#1A1A1A", color: "#D32F2F" }}>
                    {idx + 1}
                  </div>
                  <span className="text-sm font-semibold text-white">{name}</span>
                </div>
                {/* Trash icon: last in DOM = far left in RTL */}
                <button onClick={() => removePlayer(name)}
                  className="flex items-center justify-center w-8 h-8 rounded-xl transition-all duration-150 active:scale-90"
                  style={{ backgroundColor: "transparent" }}>
                  <Trash2 size={15} color="#3A3A3A" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-10 rounded-2xl"
            style={{ border: "1px dashed #1E1E1E" }}>
            <UserPlus size={28} color="#2A2A2A" strokeWidth={1.5} />
            <span className="text-sm" style={{ color: "#333333" }}>لا يوجد لاعبون بعد</span>
          </div>
        )}

        {/* ── Spacer ── */}
        <div className="flex-1" />

        {/* ── Expansion Pack — fully interactive ── */}
        {(() => {
          // capacity reserves 1 citizen slot at all times (vanilla reserve rule)
          const availableSlots = Math.max(0, players.length - BASE_ROLES_COUNT - 1);
          const usedSlots = Object.entries(activeMods)
            .filter(([, on]) => on)
            .reduce((sum, [id]) => sum + (MOD_COST[id] ?? 1), 0);
          const remaining = Math.max(0, availableSlots - usedSlots);
          const activeCount = Object.values(activeMods).filter(Boolean).length;

          return (
            <div className="flex flex-col rounded-2xl overflow-hidden"
              style={{
                border: `1px solid ${isModsEnabled ? "#2A2A2A" : "#1A1A1A"}`,
                backgroundColor: "#080808",
                transition: "border-color 0.3s",
              }}>

              {/* ── Header row — non-interactive, master toggle is the sole control ── */}
              <div
                dir="rtl"
                className="flex items-center justify-between w-full px-4 py-3.5 select-none">

                {/* Right side: Icon → Title → Badge */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Layers size={20} color="#4A4A4A" strokeWidth={1.6} style={{ flexShrink: 0 }} />
                    <span className="text-sm font-black" style={{ color: "#CCCCCC" }}>إضافات القناع</span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md flex-shrink-0"
                      style={{
                        backgroundColor: "rgba(211,47,47,0.10)",
                        color: "#D32F2F",
                        border: "1px solid rgba(211,47,47,0.22)",
                      }}>
                      جديد
                    </span>
                  </div>
                  <span className="text-xs" style={{ color: "#3A3A3A" }}>
                    {isModsEnabled
                      ? availableSlots > 0
                        ? `استهلاك الإضافات: ${usedSlots} / ${availableSlots}`
                        : "أضف لاعبين للتفعيل"
                      : "أدوار إضافية للتجربة"}
                  </span>
                </div>

                {/* Left side: master toggle only — no chevron */}
                <button
                  onClick={() => {
                    if (isModsEnabled) {
                      setIsModsEnabled(false);
                      setActiveMods(EXPANSION_MODS.reduce(
                        (acc, m) => ({ ...acc, [m.id]: false }),
                        {} as Record<string, boolean>
                      ));
                    } else {
                      setIsModsEnabled(true);
                    }
                  }}
                  style={{
                    width: 44, height: 26, borderRadius: 13, flexShrink: 0,
                    backgroundColor: isModsEnabled ? "#D32F2F" : "#1A1A1A",
                    border: `1px solid ${isModsEnabled ? "#B71C1C" : "#2A2A2A"}`,
                    position: "relative", cursor: "pointer",
                    transition: "background-color 0.22s, border-color 0.22s",
                  }} className="transition-all active:scale-95">
                  <div style={{
                    width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff",
                    position: "absolute", top: 3,
                    right: isModsEnabled ? 3 : undefined,
                    left: isModsEnabled ? undefined : 3,
                    boxShadow: "0 1px 4px #0008",
                    transition: "right 0.22s, left 0.22s",
                  }} />
                </button>
              </div>

              {/* ── Expandable panel — strictly bound to isModsEnabled ── */}
              <AnimatePresence initial={false}>
                {isModsEnabled && (
                  <motion.div
                    key="mods-list"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 28 }}
                    style={{ overflow: "hidden" }}>

                    <div style={{ height: 1, backgroundColor: "#141414", margin: "0 16px" }} />

                    <div className="flex flex-col p-3 gap-2">
                      {EXPANSION_MODS.map(mod => {
                        const isOn = activeMods[mod.id];
                        const cost = MOD_COST[mod.id] ?? 1;
                        const belowMinPlayers = players.length < mod.minPlayers;
                        const canAfford = isOn || (usedSlots + cost <= availableSlots && availableSlots > 0);
                        const isDisabled = belowMinPlayers || !canAfford;
                        // Premium gate: locked unless the host owns All-Access or this specific role.
                        const itemId = MOD_TO_ITEM[mod.id];
                        const isPremiumLocked = !!itemId
                          && !entitlements?.has_all_access
                          && !(entitlements?.owned_items?.includes(itemId) ?? false);
                        return (
                          <div key={mod.id}
                            dir="rtl"
                            className="flex flex-col rounded-xl"
                            style={{
                              backgroundColor: isOn ? mod.glow : "#050505",
                              border: `1px solid ${isOn ? mod.border : "#141414"}`,
                              opacity: isPremiumLocked ? 0.5 : (isDisabled ? 0.4 : 1),
                              transition: "background-color 0.25s, border-color 0.25s, opacity 0.2s",
                            }}>

                            <div className="flex items-center justify-between px-3.5 py-3">
                              {/* First in DOM = rightmost in RTL: name + description, non-interactive */}
                              <div className="flex flex-col gap-0.5 flex-1 min-w-0 ml-3"
                                style={{ pointerEvents: "none" }}>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-black"
                                    style={{ color: isOn ? mod.accent : "#555555", transition: "color 0.2s" }}>
                                    {mod.name}
                                  </span>
                                  {isPremiumLocked && (
                                    <Lock size={12} color="#D32F2F" strokeWidth={2.4} style={{ flexShrink: 0 }} />
                                  )}
                                  {cost === 2 && (
                                    <span className="text-xs px-1.5 py-px rounded font-semibold flex-shrink-0"
                                      style={{ backgroundColor: "#111111", color: "#3A3A3A", border: "1px solid #1E1E1E" }}>
                                      ×2
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs leading-relaxed"
                                  style={{ color: isOn ? "#505050" : "#2A2A2A", transition: "color 0.2s" }}>
                                  {mod.description}
                                </span>
                                {/* minPlayers warning — only shown when below threshold */}
                                {belowMinPlayers && (
                                  <span className="text-xs mt-0.5" style={{ color: "#5A2020" }}>
                                    يتطلب {mod.minPlayers} لاعبين كحد أدنى
                                  </span>
                                )}
                                {isPremiumLocked && (
                                  <span className="text-xs mt-0.5 font-bold" style={{ color: "#D32F2F" }}>
                                    هذا الدور يتطلب الشراء
                                  </span>
                                )}
                              </div>

                              {/* Last in DOM = leftmost in RTL: individual toggle — ONLY interactive element.
                                  When premium-locked, the switch is replaced by a lock button that routes
                                  to the store (toast + open shop) instead of toggling the role on. */}
                              {isPremiumLocked ? (
                                <button
                                  onClick={e => { e.stopPropagation(); toast.error("هذا الدور يتطلب الشراء"); openShop(); }}
                                  aria-label={`${mod.name} — مقفل، اضغط للشراء`}
                                  className="flex items-center justify-center active:scale-90 transition-transform"
                                  style={{
                                    width: 38, height: 22, borderRadius: 11, flexShrink: 0,
                                    backgroundColor: "#181818",
                                    border: "1px solid #2A2A2A",
                                    cursor: "pointer",
                                  }}>
                                  <Lock size={12} color="#D32F2F" strokeWidth={2.4} />
                                </button>
                              ) : (
                                <button
                                  onClick={e => { e.stopPropagation(); if (!isDisabled) toggleMod(mod.id); }}
                                  disabled={isDisabled}
                                  style={{
                                    width: 38, height: 22, borderRadius: 11, flexShrink: 0,
                                    backgroundColor: isOn ? mod.accent : "#181818",
                                    border: `1px solid ${isOn ? mod.accent : "#252525"}`,
                                    position: "relative",
                                    cursor: isDisabled ? "not-allowed" : "pointer",
                                    transition: "background-color 0.2s, border-color 0.2s",
                                  }} className="transition-all active:scale-95">
                                  <div style={{
                                    width: 14, height: 14, borderRadius: 7, backgroundColor: "#fff",
                                    position: "absolute", top: 3,
                                    right: isOn ? 3 : undefined,
                                    left: isOn ? undefined : 3,
                                    boxShadow: "0 1px 3px #0006",
                                    transition: "right 0.2s, left 0.2s",
                                  }} />
                                </button>
                              )}
                            </div>

                            {/* ── Magician potion-mode sub-config ──
                                Only appears when the Magician mod is toggled ON.
                                Two mutually exclusive options matching the dark theme. */}
                            {mod.id === "magician" && isOn && (
                              <div className="flex flex-col gap-1.5 px-3.5 pb-3 pt-1">
                                <span className="text-xs font-semibold" style={{ color: "#666666" }}>
                                  سعة الجرعات
                                </span>
                                <div className="flex flex-col gap-1.5">
                                  {([
                                    { id: "dual",   label: "جرعتين منفصلة",      sub: "جرعة حياة وجرعة سم مستقلتان" },
                                    { id: "single", label: "جرعة واحدة مشتركة", sub: "استخدام أي منهما يستنفد الاثنتين" },
                                  ] as const).map(opt => {
                                    const selected = magicianPotionMode === opt.id;
                                    return (
                                      <button
                                        key={opt.id}
                                        type="button"
                                        onClick={e => { e.stopPropagation(); setMagicianPotionMode(opt.id); }}
                                        className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-all duration-150 active:scale-[0.99] text-right"
                                        style={{
                                          backgroundColor: selected ? "#0E1604" : "#0A0A0A",
                                          border: `1px solid ${selected ? mod.accent : "#1A1A1A"}`,
                                          boxShadow: selected ? `0 0 14px ${mod.accent}22` : "none",
                                        }}>
                                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                          <span className="text-sm font-bold"
                                            style={{ color: selected ? mod.accent : "#888888" }}>
                                            {opt.label}
                                          </span>
                                          <span className="text-xs"
                                            style={{ color: selected ? "#5A7A2E" : "#3A3A3A" }}>
                                            {opt.sub}
                                          </span>
                                        </div>
                                        <span
                                          style={{
                                            width: 16, height: 16, borderRadius: 8, flexShrink: 0,
                                            border: `2px solid ${selected ? mod.accent : "#333333"}`,
                                            backgroundColor: selected ? mod.accent : "transparent",
                                            transition: "background-color 0.15s, border-color 0.15s",
                                          }}
                                        />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                          </div>
                        );
                      })}
                    </div>

                    {/* Footer: remaining citizens count */}
                    <div className="px-4 pb-3 flex items-center justify-between" dir="rtl">
                      <span className="text-xs" style={{ color: "#282828" }}>
                        {availableSlots > 0
                          ? `المتبقي من المواطنين: ${remaining}`
                          : "أضف لاعبين لتفعيل الإضافات"}
                      </span>
                      {availableSlots > 0 && (
                        <span className="text-xs tabular-nums"
                          style={{ color: usedSlots >= availableSlots ? "#7A1A1A" : "#282828" }}>
                          {usedSlots}/{availableSlots}
                        </span>
                      )}
                    </div>

                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })()}

        {/* ── إعدادات المجلس — compact premium card ────────────────────────
            One unified container with a slim header, a segmented "سرعة"
            control, and a low-profile inheritance row. Tight vertical
            rhythm keeps the bottom CTA in view on small screens. */}
        <div className="flex flex-col rounded-2xl overflow-hidden"
          style={{ backgroundColor: "#141414", border: "1px solid #1F1F1F" }}>

          {/* Header */}
          <div className="flex flex-col gap-0.5 px-3.5 pt-3 pb-2.5"
            style={{ borderBottom: "1px solid #1A1A1A" }}>
            <span className="text-sm font-black text-white text-right">إعدادات المجلس</span>
            <span className="text-[11px] leading-snug text-right" style={{ color: "#666" }}>
              تعديلات اختيارية على اللعبة. اختر ما يناسب مجلسكم.
            </span>
          </div>

          {/* ── Row 1: سرعة المجلس (segmented radio + custom expansion) ──
              Four-way segmented control: سريع · متوسط · بطيء · مخصص. When
              "مخصص" is active, an animated panel expands beneath with three
              native-styled dropdowns (turn / discuss / defense) bound to
              `customSpeeds`. The summary label up top always reflects the
              live `speedPreset`, so it mirrors custom values automatically. */}
          <div className="flex flex-col gap-2 px-3.5 py-3"
            style={{ borderBottom: "1px solid #1A1A1A" }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wide" style={{ color: "#888" }}>
                {`دور: ${speedPreset.turn}ث · نقاش: ${speedPreset.discuss}ث · دفاع: ${speedPreset.lastWords}ث`}
              </span>
              <span className="text-xs font-bold text-white">سرعة المجلس</span>
            </div>
            <div className="flex flex-row-reverse gap-1.5 rounded-xl p-1"
              style={{ backgroundColor: "#0A0A0A", border: "1px solid #1A1A1A" }}>
              {([
                { id: "fast",   labelAr: "سريع"  },
                { id: "medium", labelAr: "متوسط", isDefault: true },
                { id: "slow",   labelAr: "بطيء"  },
                { id: "custom", labelAr: "مخصص"  },
              ] as ReadonlyArray<{ id: GameSpeed; labelAr: string; isDefault?: boolean }>).map(({ id, labelAr, isDefault }) => {
                const isActive = gameSpeed === id;
                return (
                  <button
                    key={id}
                    onClick={() => setGameSpeed(id)}
                    className="flex-1 px-1.5 py-2 rounded-lg text-xs font-bold transition-all duration-150 active:scale-[0.97]"
                    style={{
                      backgroundColor: isActive ? "#D32F2F" : "transparent",
                      color:           isActive ? "#FFFFFF" : "#777777",
                      border:          `1px solid ${isActive ? "#D32F2F" : "transparent"}`,
                      boxShadow:       isActive ? "0 0 14px #D32F2F33" : "none",
                    }}>
                    <span className="flex flex-col items-center gap-0.5 leading-none">
                      <span>{labelAr}</span>
                      {isDefault && (
                        <span className="text-[9px] font-bold"
                          style={{ color: isActive ? "#FFFFFFB3" : "#5C5C5C" }}>
                          (افتراضي)
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ── Custom-times expanded panel ──
                Animated reveal when gameSpeed === "custom". Three native
                <select> dropdowns (one per timer), styled to match the dark
                card. RTL flow + Tajawal inherited from globals; the
                appearance-none + chevron pattern keeps the picker looking
                consistent across iOS / Android / desktop browsers. */}
            <AnimatePresence initial={false}>
              {gameSpeed === "custom" && (
                <motion.div
                  key="custom-speeds"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  style={{ overflow: "hidden" }}>
                  <div className="mt-2 flex flex-col gap-2 rounded-xl px-3 py-3"
                    style={{ backgroundColor: "#0A0A0A", border: "1px solid #1A1A1A" }}>
                    {([
                      { key: "turn",      labelAr: "مدة الدور"   },
                      { key: "discuss",   labelAr: "مدة النقاش"  },
                      { key: "lastWords", labelAr: "مدة الدفاع" },
                    ] as ReadonlyArray<{ key: keyof SpeedTimings; labelAr: string }>).map(({ key, labelAr }) => (
                      // RTL row: label FIRST (renders on the right under
                      // dir="rtl"), select LAST (renders on the left). Mirrors
                      // the DOM-order contract used by rows 2 & 3 of this
                      // settings card — text container first, control second.
                      <div key={key} className="flex items-center justify-between gap-3 w-full">
                        <span className="text-xs font-bold text-right flex-1 min-w-0" style={{ color: "#CCCCCC" }}>
                          {labelAr}
                        </span>
                        <div className="relative flex-shrink-0">
                          {/* Chevron — placed on the LEFT in RTL since that's the
                              trailing edge of the control. pointer-events-none so
                              taps fall through to the underlying <select>. */}
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none"
                            style={{ color: "#888" }}>▾</span>
                          <select
                            value={customSpeeds[key]}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              setCustomSpeeds(prev => ({ ...prev, [key]: v }));
                            }}
                            dir="rtl"
                            className="appearance-none text-xs font-bold rounded-lg pr-3 pl-6 py-2 transition-colors duration-150 focus:outline-none"
                            style={{
                              backgroundColor: "#141414",
                              color: "#FFFFFF",
                              border: "1px solid #2A2A2A",
                              fontFamily: "inherit",
                              minWidth: "6.5rem",
                            }}>
                            {CUSTOM_TIME_OPTIONS.map(sec => (
                              <option key={sec} value={sec} style={{ backgroundColor: "#141414", color: "#FFFFFF" }}>
                                {formatTimeOption(sec)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Row 1.5: الراوي الصوتي ──
              Mutes night-phase narrator VO only; card / victory / UI SFX stay on. */}
          <button
            onClick={() => setIsNarratorMuted(m => !m)}
            className="w-full flex items-center justify-between gap-3 px-3.5 py-3 transition-colors duration-200 active:scale-[0.995]"
            style={{ backgroundColor: !isNarratorMuted ? "#170000" : "transparent", borderBottom: "1px solid #1A1A1A" }}>
            <div className="flex flex-col gap-0.5 text-right flex-1 min-w-0">
              <span className="text-xs font-bold" style={{ color: !isNarratorMuted ? "#FFFFFF" : "#AAAAAA" }}>
                الراوي الصوتي
              </span>
              <span className="text-[10.5px] leading-snug truncate" style={{ color: "#5C5C5C" }}>
                تعليقات الليل (صحى/نام) · المؤثرات والفوز تبقى شغّالة
              </span>
            </div>
            <div className="w-9 h-5 rounded-full relative transition-colors duration-200 flex-shrink-0"
              style={{ backgroundColor: !isNarratorMuted ? "#D32F2F" : "#262626" }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200"
                style={{
                  backgroundColor: "#FFFFFF",
                  right: !isNarratorMuted ? "0.125rem" : "1.125rem",
                }} />
            </div>
          </button>

          {/* ── Row 2: توريث الزعامة ──
              DOM order matches إضافات القناع: text container first, toggle
              second. Parent is `flex justify-between` so RTL flow pushes
              the text to the right edge and the switch to the left edge. */}
          <button
            onClick={() => setBoyInheritsAce(v => !v)}
            className="w-full flex items-center justify-between gap-3 px-3.5 py-3 transition-colors duration-200 active:scale-[0.995]"
            style={{ backgroundColor: boyInheritsAce ? "#170000" : "transparent" }}>
            <div className="flex flex-col gap-0.5 text-right flex-1 min-w-0">
              <span className="text-xs font-bold" style={{ color: boyInheritsAce ? "#FFFFFF" : "#AAAAAA" }}>
                توريث الزعامة (للولد)
              </span>
              <span className="text-[10.5px] leading-snug truncate" style={{ color: "#5C5C5C" }}>
                (يقوم بالاغتيال والتسكيت معًا إذا ماتت الإكة) · (الافتراضي: مغلق)
              </span>
            </div>
            <div className="w-9 h-5 rounded-full relative transition-colors duration-200 flex-shrink-0"
              style={{ backgroundColor: boyInheritsAce ? "#D32F2F" : "#262626" }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200"
                style={{
                  backgroundColor: "#FFFFFF",
                  right: boyInheritsAce ? "0.125rem" : "1.125rem",
                }} />
            </div>
          </button>

          {/* ── Row 3: نظام تمرير الجوال — same layout contract as Row 2 ── */}
          <button
            onClick={() => setIsPassPhoneMode(v => !v)}
            className="w-full flex items-center justify-between gap-3 px-3.5 py-3 transition-colors duration-200 active:scale-[0.995]"
            style={{ backgroundColor: isPassPhoneMode ? "#170000" : "transparent" }}>
            <div className="flex flex-col gap-0.5 text-right flex-1 min-w-0">
              <span className="text-xs font-bold" style={{ color: isPassPhoneMode ? "#FFFFFF" : "#AAAAAA" }}>
                نظام تمرير الجوال
              </span>
              <span className="text-[10.5px] leading-snug truncate" style={{ color: "#5C5C5C" }}>
                إخفاء الكرت عند الانتقال للاعب التالي · (الافتراضي: مغلق)
              </span>
            </div>
            <div className="w-9 h-5 rounded-full relative transition-colors duration-200 flex-shrink-0"
              style={{ backgroundColor: isPassPhoneMode ? "#D32F2F" : "#262626" }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200"
                style={{
                  backgroundColor: "#FFFFFF",
                  right: isPassPhoneMode ? "0.125rem" : "1.125rem",
                }} />
            </div>
          </button>
        </div>

        {/* ── Bottom: helper text + CTA + back ── */}
        <div className="flex flex-col gap-3">
          {!canDistribute && (
            <p className="text-xs text-center font-semibold" style={{ color: "#444444" }}>
              أضف {remaining} {remaining === 1 ? "لاعباً" : "لاعبين"} على الأقل للبدء
            </p>
          )}
          <motion.button
            onClick={handleDistribute}
            disabled={!canDistribute}
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            className="w-full flex flex-row-reverse items-center justify-center gap-3 px-5 py-4 rounded-2xl font-black text-base transition-all duration-200 active:scale-95"
            style={{
              backgroundColor: canDistribute ? "#D32F2F" : "#1A1A1A",
              color: canDistribute ? "#ffffff" : "#333333",
              border: canDistribute ? "none" : "1px solid #222222",
              boxShadow: canDistribute ? "0 0 24px #D32F2F44" : "none",
            }}>
            <VenetianMask size={20} strokeWidth={2} />
            <span>توزيع الأقنعة</span>
          </motion.button>

          {/* Bottom "back" button removed — primary back action lives in the
              unified top navbar (floatingButtons) to keep a single iOS-style
              navigation surface across the app. */}
        </div>

      </div>
    </div>
  );

  }; // end renderPhaseContent

  // ── Transition key: changes on every major phase (+ day sub-phase) ──
  const phaseKey   = phase === "day" ? `day-${daySubPhase}` : phase;
  const isDayPhase = phase === "day";

  return (
    <motion.div
      initial={false}
      animate={{ "--n-bg": isDayPhase ? "#1A1A1A" : "#000000" } as unknown as Record<string, string>}
      transition={{ duration: 1.5, ease: "easeInOut" }}
      style={{ "--n-bg": "#000000", height: "100dvh", width: "100%", display: "flex", flexDirection: "column", overflow: "hidden" } as React.CSSProperties}
    >
      {floatingButtons}
      <AnimatePresence mode="wait">
        <motion.div
          key={phaseKey}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -15 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          style={{ width: "100%", flex: 1, overflowY: "auto", minHeight: 0 }}
        >
          {renderPhaseContent()}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// ─── In-game Main Menu (Online mode lobby) ────────────────────────────────────

function MainMenu({ onCreateRoom, onJoinRoom, onBack }: { onCreateRoom: () => void; onJoinRoom: () => void; onBack: () => void }) {
  return (
    <div className="min-h-full w-full flex flex-col items-center justify-center px-6" style={ROOT_STYLE}>
      <div className="flex flex-col items-center gap-8 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl">
        <div className="flex flex-col items-center gap-3">
          <div style={{ filter: "drop-shadow(0 0 40px #D32F2F55)" }}>
            <VenetianMask size={120} color="#D32F2F" strokeWidth={0.8} />
          </div>
          <h1 className="text-6xl font-black tracking-widest" style={{ color: "#D32F2F" }}>القناع</h1>
          <p className="text-sm text-center" style={{ color: "#9E9E9E" }}>القرية تنام.. والقاتل يصحو</p>
        </div>
        <div className="flex flex-col gap-5 w-full">
          <button onClick={onCreateRoom} className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <Plus size={22} color="#D32F2F" strokeWidth={2.5} /><span>إنشاء غرفة</span>
          </button>
          <button onClick={onJoinRoom} className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <LogIn size={22} color="#D32F2F" strokeWidth={2.5} /><span>دخول لعبة</span>
          </button>
          <button onClick={onBack}
            className="w-full flex flex-row-reverse items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold transition-all duration-200 active:scale-95"
            style={{ backgroundColor: "transparent", border: "1px solid #2A2A2A", color: "#555555" }}>
            <ArrowRight size={16} strokeWidth={2} />
            <span>العودة للقائمة الرئيسية</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared Name Input Layout ─────────────────────────────────────────────────

function NameInputLayout({
  title, subtitle, buttonLabel,
  onBack, onSubmit,
  name, setName, loading, error,
  extraField,
}: {
  title: string; subtitle: string; buttonLabel: string;
  onBack: () => void; onSubmit: () => void;
  name: string; setName: (v: string) => void;
  loading: boolean; error: string;
  extraField?: React.ReactNode;
}) {
  return (
    <div className="min-h-full w-full flex flex-col items-center justify-center px-6" style={ROOT_STYLE}>
      <div className="flex flex-col gap-6 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl">
        <TopBar onBack={onBack} />
        <div>
          <h2 className="text-2xl font-black text-white">{title}</h2>
          <p className="text-sm mt-1" style={{ color: "#9E9E9E" }}>{subtitle}</p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold tracking-wider" style={{ color: "#9E9E9E" }}>اسمك في اللعبة</label>
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              placeholder="مثال: أحمد" maxLength={20}
              className="w-full rounded-2xl text-white text-base outline-none placeholder-neutral-600"
              style={{
                backgroundColor: "#111111",
                border: "1px solid #2A2A2A",
                direction: "rtl",
                padding: "14px 18px",
                lineHeight: "1.5",
              }}
            />
          </div>
          {extraField}
          {error && (
            <div className="flex flex-row-reverse items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: "#3A0000" }}>
              <AlertCircle size={14} color="#FF6B6B" />
              <span className="text-xs" style={{ color: "#FF6B6B" }}>{error}</span>
            </div>
          )}
          <button onClick={onSubmit} disabled={loading}
            className="flex items-center justify-center gap-2 w-full px-6 py-4 rounded-xl font-bold text-white text-lg transition-all duration-200 active:scale-95"
            style={{ backgroundColor: "#D32F2F", opacity: loading ? 0.7 : 1 }}>
            {loading && <Loader2 size={18} className="animate-spin" />}
            <span>{loading ? "جاري الاتصال..." : buttonLabel}</span>
          </button>
        </div>
        <Footer />
      </div>
    </div>
  );
}

// ─── Create Room Screen ───────────────────────────────────────────────────────

function CreateNameScreen({ onBack, onSubmit }: { onBack: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const handle = () => {
    if (!name.trim()) { setError("أدخل اسمك أولاً"); return; }
    setLoading(true); setError("");
    onSubmit(name.trim());
  };
  return (
    <NameInputLayout title="أنت الراوي" subtitle="أدخل اسمك لإنشاء الغرفة" buttonLabel="إنشاء الغرفة"
      onBack={onBack} onSubmit={handle} name={name} setName={setName} loading={loading} error={error} />
  );
}

// ─── Join Room Screen ─────────────────────────────────────────────────────────

function JoinRoomScreen({ onBack, onSubmit, initialCode = "" }: {
  onBack: () => void;
  onSubmit: (name: string, code: string, onError: (msg: string) => void) => void;
  initialCode?: string;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Sync if initialCode changes (e.g. QR scan brings a pre-filled code)
  useEffect(() => { setCode(initialCode); }, [initialCode]);

  const handle = () => {
    if (!name.trim()) { setError("أدخل اسمك"); return; }
    if (code.trim().length !== 4) { setError("أدخل كود الغرفة كاملاً"); return; }
    const reversedCode = code.trim().split("").reverse().join("");
    console.log("Attempting to join with code:", reversedCode);
    setLoading(true); setError("");
    onSubmit(name.trim(), reversedCode, (msg: string) => {
      setLoading(false);
      setError(msg);
    });
  };

  return (
    <NameInputLayout
      title="دخول لعبة" subtitle="أدخل اسمك وكود الغرفة" buttonLabel="دخول الغرفة"
      onBack={onBack} onSubmit={handle} name={name} setName={setName} loading={loading} error={error}
      extraField={
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold tracking-wider" style={{ color: "#9E9E9E" }}>كود الغرفة</label>
          <input
            dir="ltr"
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => e.key === "Enter" && handle()}
            placeholder="0000"
            className="w-full rounded-xl font-black tabular-nums outline-none border-2"
            style={{
              backgroundColor: "#111111",
              borderColor: code.length > 0 ? "#D32F2F" : "#2A2A2A",
              borderWidth: 1,
              color: "#FFFFFF",
              caretColor: "#D32F2F",
              direction: "ltr",
              letterSpacing: "0.8em",
              textIndent: "0.8em",
              textAlign: "center",
              fontSize: "2rem",
              padding: "1rem 1rem",
              lineHeight: "1.4",
            }}
          />
        </div>
      }
    />
  );
}

// ─── Lobby Screen (Real-Time) ─────────────────────────────────────────────────

function LobbyScreen({
  lobby,
  onLeave,
  onGameStarted,
}: {
  lobby: LobbyState;
  onLeave: () => void;
  onGameStarted: (payload: GameStartedPayload) => void;
}) {
  const [players, setPlayers] = useState<SocketPlayer[]>(lobby.players);
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [closed, setClosed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [kicked, setKicked] = useState(false);

  const canStart = lobby.isHost && players.length >= 2;

  useEffect(() => {
    const socket = getSocket();
    const onPlayersUpdated = ({ players: updated }: { players: SocketPlayer[] }) => setPlayers(updated);
    const onRoomClosed = () => setClosed(true);
    const onGameStartedEvt = (payload: GameStartedPayload) => onGameStarted(payload);
    const onKickedFromRoom = () => setKicked(true);

    socket.on("playersUpdated", onPlayersUpdated);
    socket.on("roomClosed", onRoomClosed);
    socket.on("gameStarted", onGameStartedEvt);
    socket.on("kickedFromRoom", onKickedFromRoom);
    return () => {
      socket.off("playersUpdated", onPlayersUpdated);
      socket.off("roomClosed", onRoomClosed);
      socket.off("gameStarted", onGameStartedEvt);
      socket.off("kickedFromRoom", onKickedFromRoom);
    };
  }, [onGameStarted]);

  const handleStartGame = useCallback(() => {
    if (!canStart || starting) return;
    setStarting(true);
    getSocket().emit("startGame", { code: lobby.code });
  }, [canStart, starting, lobby.code]);

  const copyCode = useCallback(async () => {
    try { await navigator.clipboard.writeText(lobby.code); } catch {}
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [lobby.code]);

  const handleShare = useCallback(async () => {
    const visualCode = lobby.code.split("").reverse().join("");
    const joinUrl = `${window.location.origin}${window.location.pathname}?code=${visualCode}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "انضم للعب 'القناع'!",
          text: "استخدم هذا الرابط للانضمام لغرفة اللعب الجماعي:",
          url: joinUrl,
        });
      } catch {}
    } else {
      try { await navigator.clipboard.writeText(joinUrl); } catch {}
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    }
  }, [lobby.code]);


  if (kicked) {
    return (
      <div className="min-h-full w-full flex flex-col items-center justify-center px-6 gap-4" style={ROOT_STYLE}>
        <Skull size={48} color="#D32F2F" />
        <p className="text-white font-bold text-xl">تم طردك من الغرفة</p>
        <p className="text-sm text-center" style={{ color: "#9E9E9E" }}>قرر المضيف إزالتك من هذه الجلسة</p>
        <button onClick={onLeave} className="mt-4 px-6 py-3 rounded-xl font-bold text-white transition-all active:scale-95" style={{ backgroundColor: "#D32F2F" }}>
          العودة للقائمة الرئيسية
        </button>
      </div>
    );
  }

  if (closed) {
    return (
      <div className="min-h-full w-full flex flex-col items-center justify-center px-6 gap-4" style={ROOT_STYLE}>
        <AlertCircle size={48} color="#D32F2F" />
        <p className="text-white font-bold text-lg">تم إغلاق الغرفة</p>
        <p className="text-sm" style={{ color: "#9E9E9E" }}>غادر المضيف أو انتهت الجلسة</p>
        <button onClick={onLeave} className="mt-4 px-6 py-3 rounded-xl font-bold text-white transition-all active:scale-95" style={{ backgroundColor: "#D32F2F" }}>
          العودة للقائمة الرئيسية
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full flex flex-col" style={ROOT_STYLE}>
      <div className="flex flex-col flex-1 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto px-4 py-6 gap-5">

        <TopBar />

        <div className="flex items-center justify-center">
          <span className="text-xs px-3 py-1 rounded-full font-semibold"
            style={{
              backgroundColor: lobby.isHost ? "#3A0000" : "#001A3A",
              color:           lobby.isHost ? "#FF6B6B" : "#64B5F6",
              border: `1px solid ${lobby.isHost ? "#D32F2F" : "#1565C0"}`,
            }}>
            {lobby.isHost ? "أنت الراوي (المضيف)" : "أنت لاعب"}
          </span>
        </div>

        {/* Room Code Card */}
        <div className="rounded-xl border p-5 flex flex-col gap-4" style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#9E9E9E" }}>كود الغرفة</span>
            <button onClick={copyCode} className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70 transition-all active:scale-95"
              style={{ color: copied ? "#4CAF50" : "#9E9E9E" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "تم النسخ" : "نسخ"}</span>
            </button>
          </div>
          <div
            dir="ltr"
            className="w-full rounded-xl border-2 font-black tabular-nums flex items-center justify-center"
            style={{
              backgroundColor: "#0D0D0D",
              borderColor: "#D32F2F",
              color: "#D32F2F",
              direction: "ltr",
              letterSpacing: "1em",
              textAlign: "center",
              fontSize: "2rem",
              padding: "1rem 1.5rem",
            }}
          >
            {lobby.code.split("").reverse().join("")}
          </div>
          {(() => {
            const joinUrl = `${window.location.origin}${window.location.pathname}?code=${lobby.code.split("").reverse().join("")}`;
            return (
              <div className="w-full flex flex-col items-center gap-3">
                <div className="w-full rounded-2xl flex flex-col items-center gap-3 p-5"
                  style={{ backgroundColor: "#0A0A0A", border: "1px solid #D32F2F", boxShadow: "0 0 18px #D32F2F18" }}>
                  <QRCode
                    value={joinUrl}
                    size={170}
                    bgColor="#0A0A0A"
                    fgColor="#FFFFFF"
                    style={{ width: "100%", maxWidth: 190, height: "auto", borderRadius: 4 }}
                  />
                  <span className="text-xs font-medium tracking-wide" style={{ color: "#666666", direction: "rtl" }}>امسح للانضمام مباشرة</span>
                </div>
                <button
                  onClick={handleShare}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg transition-colors active:opacity-70 transition-all active:scale-95"
                  style={{
                    backgroundColor: "#0D0D0D",
                    border: "1px solid #D32F2F",
                    color: shareCopied ? "#4CAF50" : "#D32F2F",
                  }}
                >
                  <Share2 size={15} />
                  <span className="text-sm font-semibold">
                    {shareCopied ? "تم نسخ الرابط" : "مشاركة رابط الدعوة"}
                  </span>
                </button>
              </div>
            );
          })()}
          <div className="flex items-center justify-center gap-2 py-2 rounded-lg" style={{ backgroundColor: "#0D0D0D" }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#4CAF50" }} />
            <span className="text-xs" style={{ color: "#9E9E9E" }}>في انتظار اللاعبين...</span>
          </div>
        </div>

        {/* Real-Time Player List */}
        <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ backgroundColor: "#1A1A1A", borderColor: "#333333" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={16} color="#D32F2F" />
              <span className="font-bold text-sm text-white">اللاعبون</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: players.length >= 2 ? "#1B5E20" : "#4A0000", color: players.length >= 2 ? "#4CAF50" : "#D32F2F" }}>
              {players.length} / 2+
            </span>
          </div>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
            {players.map((player, idx) => (
              <div key={player.socketId} className="flex flex-row-reverse items-center gap-3 px-3 py-2.5 rounded-lg" style={{ backgroundColor: "#0D0D0D" }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: "#D32F2F", color: "#fff" }}>{idx + 1}</div>
                <div className="flex-1 min-w-0 flex flex-row-reverse items-center gap-2">
                  <span className="text-white text-sm font-medium">{player.name}</span>
                  {player.name === lobby.myName && (
                    <span className="text-xs" style={{ color: "#555555" }}>(أنت)</span>
                  )}
                </div>
                {player.name === lobby.myName && lobby.isHost && (
                  <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: "#3A0000", color: "#FF6B6B" }}>مضيف</span>
                )}
                {lobby.isHost && player.name !== lobby.myName && (
                  <button
                    onClick={() => getSocket().emit("kickPlayer", { code: lobby.code, playerName: player.name })}
                    className="flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 transition-opacity active:opacity-60 transition-all active:scale-95"
                    style={{ backgroundColor: "#3A0000", border: "1px solid #D32F2F" }}
                    title="طرد اللاعب">
                    <span className="text-xs font-bold leading-none" style={{ color: "#D32F2F" }}>✕</span>
                  </button>
                )}
              </div>
            ))}
          </div>
          {players.length === 0 && <p className="text-center text-xs py-2" style={{ color: "#555555" }}>لا يوجد لاعبون بعد</p>}
        </div>

        {/* Start Button — HOST ONLY */}
        {lobby.isHost && (
          <>
            <button onClick={handleStartGame} disabled={!canStart || starting}
              className="flex flex-row-reverse items-center justify-center gap-3 w-full px-6 py-4 rounded-xl border font-bold text-lg transition-all duration-200 active:scale-95"
              style={{
                backgroundColor: canStart ? "#D32F2F" : "#1A1A1A",
                borderColor:     canStart ? "#D32F2F" : "#333333",
                color:           canStart ? "#ffffff" : "#555555",
                cursor: canStart ? "pointer" : "not-allowed",
                opacity: canStart ? 1 : 0.6,
              }}>
              {starting ? <Loader2 size={22} className="animate-spin" /> : <Shuffle size={22} strokeWidth={2.5} />}
              <span>{starting ? "جاري التوزيع..." : "ابدأ توزيع الأقنعة"}</span>
            </button>
            {!canStart && !starting && (
              <p className="text-center text-xs -mt-2" style={{ color: "#555555" }}>
                يلزم {Math.max(0, 2 - players.length)} لاعب إضافي للبدء
              </p>
            )}
          </>
        )}

        {/* Player waiting message — NON-HOST ONLY */}
        {!lobby.isHost && (
          <div className="flex items-center justify-center gap-2 py-3 rounded-xl"
            style={{ backgroundColor: "#1A1A1A", border: "1px solid #333333" }}>
            <Loader2 size={16} color="#9E9E9E" className="animate-spin" />
            <span className="text-sm" style={{ color: "#9E9E9E" }}>في انتظار بدء اللعبة...</span>
          </div>
        )}

        <LeaveButton onLeave={onLeave} />
        <Footer />
      </div>
    </div>
  );
}

// ─── Player Screen (Role Reveal) ──────────────────────────────────────────────

/**
 * Online Mode Silent-Night transition overlay.
 *
 * When the active game phase moves AWAY from a night role phase
 * (e.g. night_wolf → night_shadow, or night_guard → day_discussion),
 * fades in a full-screen "X ينام" card for ~2 seconds before revealing
 * the next role's UI. Pure client-side: no server timer changes.
 *
 * Renders nothing outside of role-phase transitions.
 */
const NIGHT_ROLE_NAMES: Record<string, string> = {
  night_wolf:   "الولد",
  night_shadow: "الإكة",
  night_seer:   "الشايب",
  night_guard:  "البنت",
};

function NightRoleSleepingOverlay({ phase }: { phase: string }) {
  const prevPhaseRef = useRef<string>(phase);
  const [sleepingRole, setSleepingRole] = useState<string | null>(null);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (prev === phase) return;
    // Only show when leaving an active role phase (not night_sleep itself)
    const leavingRoleName = NIGHT_ROLE_NAMES[prev];
    if (!leavingRoleName) return;
    setSleepingRole(leavingRoleName);
    const t = setTimeout(() => setSleepingRole(null), 2000);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <AnimatePresence>
      {sleepingRole && (
        <motion.div
          key="night-role-sleeping"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeInOut" }}
          className="fixed inset-0 flex items-center justify-center"
          style={{
            backgroundColor: "rgba(0,0,0,0.94)",
            zIndex: 100,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <motion.div
            initial={{ scale: 0.92, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center gap-4 px-10 text-center"
          >
            <div style={{ fontSize: "3.5rem", lineHeight: 1 }}>😴</div>
            <p className="text-3xl font-black" style={{ color: "#D32F2F", letterSpacing: "0.02em" }}>
              {sleepingRole} ينام
            </p>
            <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#555555" }}>
              القرية هادئة
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PlayerScreen({ role, gamePhase, morningResults, voteUpdate, alivePlayerNames, phaseEndsAt, myDeathReason, executionInfo, trialState, accusedPlayer, onLeave }: {
  role: MyRole;
  gamePhase: string;
  morningResults: MorningResultsPayload | null;
  voteUpdate: VoteUpdatePayload | null;
  alivePlayerNames: string[];
  phaseEndsAt: number | null;
  myDeathReason: "assassinated" | "executed" | null;
  executionInfo: { name: string; roleLabel: string; roleColor: string } | null;
  trialState: "none" | "accused" | "revoting";
  accusedPlayer: string | null;
  onLeave: () => void;
}) {
  const [revealed, setRevealed]           = useState(false);
  const [selectedTarget, setSelected]     = useState<string | null>(null);
  const [actionSubmitted, setSubmitted]   = useState(false);
  const [investigateResult, setInvResult] = useState<InvestigateResultPayload | null>(null);
  const [votedFor, setVotedFor]           = useState<string | null>(null);
  const [mafiaSync, setMafiaSync]         = useState<{ killTarget: string | null; silenceTarget: string | null }>({ killTarget: null, silenceTarget: null });

  // On reconnect during voting phase, restore any vote already cast by this player
  useEffect(() => {
    if (gamePhase === "voting" && voteUpdate?.votes[role.myName]) {
      setVotedFor(voteUpdate.votes[role.myName]);
    }
    // Reset votedFor when voting phase ends so it's clean for next round
    if (gamePhase !== "voting") {
      setVotedFor(null);
    }
  }, [gamePhase, voteUpdate, role.myName]);

  const isWolf         = role.label === "الولد";
  const isShadow       = role.label === "الإكة";
  const isMafia        = isWolf || isShadow;
  const isInvestigator = role.label === "الشايب";
  const isProtector    = role.label === "البنت";

  const isMyTurn =
    (gamePhase === "night_wolf"   && isWolf)         ||
    (gamePhase === "night_shadow" && isShadow)       ||
    (gamePhase === "night_seer"   && isInvestigator) ||
    (gamePhase === "night_guard"  && isProtector);

  const isNightPhase = gamePhase.startsWith("night_");

  const actionLabel = isWolf
    ? "تذبح مين هذي الليلة يا ولد؟"
    : isShadow
      ? "تسكتين مين يا إكة الليلة؟"
      : isInvestigator
        ? "تسأل عن مين يا شايب؟"
        : "تحمين مين يا بنت؟";

  const getActionType = (): string => {
    if (isWolf)         return "kill";
    if (isShadow)       return "silence";
    if (isInvestigator) return "investigate";
    return "protect";
  };

  // Build filtered target list — recomputed whenever alivePlayerNames or the
  // active phase changes. Never stored in state; always derived fresh.
  // الولد  (Wolf):      all alive players EXCEPT self — can see/select الإكة
  // الإكة  (Shadow):    ALL alive players — can silence anyone including self or wolf
  // الشايب (Seer):      all alive players EXCEPT self
  // البنت  (Guard):     ALL alive players — can protect anyone including self
  const targetList = useMemo(() => {
    const aliveOthers = alivePlayerNames.filter((n) => n !== role.myName);
    if (isWolf)         return aliveOthers;      // wolf: alive minus self
    if (isShadow)       return alivePlayerNames; // shadow: everyone alive
    if (isProtector)    return alivePlayerNames; // guard: everyone alive
    return aliveOthers;                          // seer: alive minus self
  }, [alivePlayerNames, gamePhase, role.myName, isWolf, isShadow, isProtector]);

  const handleSelectTarget = (name: string) => {
    setSelected(name);
    setSubmitted(false);
  };

  const handleSubmitAction = () => {
    if (!selectedTarget) return;
    getSocket().emit("submitNightAction", {
      actionType: getActionType(),
      targetName: selectedTarget,
      roomCode:   role.code,
    });
    setSubmitted(true);
  };

  // Reset when phase changes (clear mafia sync on sleep or day)
  useEffect(() => {
    setSelected(null);
    setSubmitted(false);
    setInvResult(null);
    setVotedFor(null);
    if (gamePhase === "night_sleep" || gamePhase === "day_discussion") {
      setMafiaSync({ killTarget: null, silenceTarget: null });
    }
  }, [gamePhase]);

  // Listen for private investigator result
  useEffect(() => {
    const socket = getSocket();
    const onResult = (payload: InvestigateResultPayload) => setInvResult(payload);
    socket.on("investigateResult", onResult);
    return () => { socket.off("investigateResult", onResult); };
  }, []);

  // Listen for mafia team synergy updates (only relevant for wolf/shadow players)
  useEffect(() => {
    if (!isMafia) return;
    const socket = getSocket();
    const onSync = (payload: MafiaActionSyncPayload) => {
      setMafiaSync((prev) => ({
        killTarget:    payload.actionType === "kill"    ? payload.targetName : prev.killTarget,
        silenceTarget: payload.actionType === "silence" ? payload.targetName : prev.silenceTarget,
      }));
    };
    socket.on("mafiaActionSync", onSync);
    return () => { socket.off("mafiaActionSync", onSync); };
  }, [isMafia]);


  const reveal  = useCallback(() => setRevealed(true),  []);
  const conceal = useCallback(() => setRevealed(false), []);

  return (
    <div className="min-h-full w-full flex flex-col" style={ROOT_STYLE}>
      <NightRoleSleepingOverlay phase={gamePhase} />
      <div className="flex flex-col flex-1 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto px-4 py-6 gap-6">

        <TopBar />

        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold" style={{ color: "#9E9E9E" }}>{role.myName}</span>
          <Countdown endsAt={phaseEndsAt} heartbeat={gamePhase === "day_discussion" || gamePhase === "voting"} />
        </div>

        {/* Dead player screen — overlays content when eliminated */}
        {alivePlayerNames.length > 0 && !alivePlayerNames.includes(role.myName) && (
          <DeadScreen myName={role.myName} deathReason={myDeathReason} />
        )}

        <div className="flex-1 flex flex-col items-center justify-center gap-6"
          style={{ display: alivePlayerNames.length > 0 && !alivePlayerNames.includes(role.myName) ? "none" : "flex" }}>
          <motion.div
            onPointerDown={reveal}
            onPointerUp={conceal}
            onPointerLeave={conceal}
            onPointerCancel={conceal}
            whileTap={{ scale: 0.98 }}
            className="w-full rounded-2xl border-2 flex flex-col items-center justify-center gap-5 py-12 px-6 select-none transition-all duration-300"
            style={{
              backgroundColor: revealed ? "#0A0000" : "#111111",
              borderColor:     revealed ? role.color : "#2A2A2A",
              boxShadow:       revealed ? `0 0 40px ${role.color}33` : "none",
              cursor: "pointer",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            {revealed ? (
              <>
                <VenetianMask size={64} color={role.color} strokeWidth={1.2} />
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs tracking-widest font-semibold" style={{ color: "#666666" }}>قناعك</span>
                  <span className="text-3xl font-black text-center leading-tight"
                    style={{ color: role.color, direction: "rtl" }}>
                    {role.label}
                  </span>
                  <span className="text-xs text-center px-2 leading-relaxed" style={{ color: "#888888" }}>
                    {role.label === "الولد"  && "أنت القاتل. اختر ضحيتك كل ليلة."}
                    {role.label === "الإكة"  && "أنت الكاتم. امنع لاعب من الكلام غداً."}
                    {role.label === "الشايب" && "أنت العرّاف. اكشف حقيقة لاعب كل ليلة."}
                    {role.label === "البنت"  && "أنت الحارس. احمِ لاعباً من القتل."}
                    {role.label === "المواطن" && "أنت من الشعب. ابحث عن المافيا وصوّت ضدهم."}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2" style={{ color: "#444444" }}>
                  <Unlock size={14} /><span className="text-xs">أنت ترى قناعك</span>
                </div>
              </>
            ) : (
              <>
                <div className="relative">
                  <VenetianMask size={64} color="#2A2A2A" strokeWidth={1.2} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Lock size={22} color="#555555" />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xl font-bold" style={{ color: "#444444" }}>قناعك مخفي</span>
                  <span className="text-sm text-center" style={{ color: "#333333" }}>اضغط وامسك للكشف عن قناعك</span>
                </div>
                <div className="flex items-center gap-2" style={{ color: "#333333" }}>
                  <Lock size={14} /><span className="text-xs">مخفي عن الجميع</span>
                </div>
              </>
            )}
          </motion.div>

          <p className="text-xs text-center px-4" style={{ color: "#333333" }}>
            {revealed ? "ارفع إصبعك لإخفاء القناع مجدداً" : "اضغط مطولاً على البطاقة للكشف — سيختفي عند الرفع"}
          </p>
        </div>

        {/* ── Morning Results Banner ── */}
        {gamePhase === "day_discussion" && morningResults && !executionInfo && (
          <div className="w-full rounded-2xl flex flex-col gap-2 p-4"
            style={{ backgroundColor: morningResults.killedPlayerName ? "#1A0000" : "#001A0A", border: `1px solid ${morningResults.killedPlayerName ? "#D32F2F" : "#33691E"}` }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0"
                style={{ backgroundColor: morningResults.killedPlayerName ? "#D32F2F" : "#4CAF50" }} />
              <p className="text-sm font-bold" style={{ color: morningResults.killedPlayerName ? "#FF6B6B" : "#8BC34A" }}>
                {morningResults.killedPlayerName
                  ? morningResults.killedPlayerName === morningResults.silencedPlayerName
                    ? `اكتشفنا جثة المقتول: ${morningResults.killedPlayerName}.. والمفارقة أنه كان ساكتاً أيضاً!`
                    : `اكتشفنا جثة المقتول: ${morningResults.killedPlayerName}`
                  : "مرت الليلة بسلام.. لم يمت أحد."}
              </p>
            </div>
            {morningResults.silencedPlayerName && morningResults.silencedPlayerName !== morningResults.killedPlayerName && (
              <p className="text-xs font-semibold" style={{ color: "#FF8F00" }}>
                والساكت: {morningResults.silencedPlayerName}
              </p>
            )}
          </div>
        )}

        {gamePhase === "day_discussion" && !morningResults && !executionInfo && (
          <div className="w-full rounded-2xl flex flex-col items-center gap-2 py-4 px-4"
            style={{ backgroundColor: "#0A1200", border: "1px solid #33691E" }}>
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#8BC34A" }} />
            <p className="text-sm font-bold" style={{ color: "#8BC34A" }}>النهار بدأ — ناقش مع القرية</p>
          </div>
        )}

        {/* ── Night Action Panel ── */}
        {isNightPhase && (
          <div className="w-full rounded-2xl overflow-hidden"
            style={{ border: `1px solid ${isMyTurn ? "#D32F2F" : "#1E1E1E"}`, backgroundColor: isMyTurn ? "#0D0000" : "#0A0A0A" }}>

            {isMyTurn ? (
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#D32F2F" }}>دورك الآن</span>
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#D32F2F" }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "#CCCCCC" }}>{actionLabel}</p>
                <div className="flex flex-col gap-2">
                  {targetList.length === 0 ? (
                    <p className="text-xs text-center py-2" style={{ color: "#555555" }}>لا يوجد أهداف متاحة</p>
                  ) : (
                    targetList.map((name) => {
                      const isAlly        = role.wolfAllies.includes(name);
                      const isKillTarget  = isMafia && mafiaSync.killTarget    === name;
                      const isSilTarget   = isMafia && mafiaSync.silenceTarget === name;
                      const isSelected    = selectedTarget === name;
                      const rowBorder     = isKillTarget ? "#FF4040" : isSilTarget ? "#FF8C42" : isSelected ? "#D32F2F" : "#222222";
                      const rowBg         = isKillTarget ? "#200000" : isSilTarget ? "#201000" : isSelected ? "#2A0000" : "#141414";
                      return (
                        <div key={name}
                          className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                          style={{ backgroundColor: rowBg, border: `1px solid ${rowBorder}` }}>
                          <button
                            onClick={() => handleSelectTarget(name)}
                            disabled={actionSubmitted}
                            className="px-3 py-1 rounded-lg text-xs font-bold transition-all duration-150 active:scale-95"
                            style={{ backgroundColor: isSelected ? "#D32F2F" : "#1A1A1A", color: isSelected ? "#ffffff" : "#888888", border: `1px solid ${isSelected ? "#D32F2F" : "#333333"}`, opacity: actionSubmitted ? 0.5 : 1 }}>
                            {isSelected ? "تم الاختيار" : "اختر"}
                          </button>
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-sm font-semibold" style={{ color: isSelected ? "#ffffff" : "#AAAAAA" }}>{name}</span>
                            {isAlly && (
                              <span className="text-xs font-bold" style={{ color: "#D32F2F" }}>(حليف 🐺)</span>
                            )}
                            {isKillTarget && (
                              <span className="text-xs font-bold" style={{ color: "#FF4040" }}>🔪 هدف الولد</span>
                            )}
                            {isSilTarget && (
                              <span className="text-xs font-bold" style={{ color: "#FF8C42" }}>🤐 هدف الإكة</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Confirm button */}
                {selectedTarget && !actionSubmitted && (
                  <button
                    onClick={handleSubmitAction}
                    className="w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 active:scale-95"
                    style={{ backgroundColor: "#D32F2F", color: "#ffffff" }}>
                    تأكيد الاختيار
                  </button>
                )}

                {/* Submitted confirmation */}
                {actionSubmitted && (
                  <div className="flex items-center justify-center gap-2 py-2 rounded-xl"
                    style={{ backgroundColor: "#0D2000", border: "1px solid #33691E" }}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#4CAF50" }} />
                    <p className="text-xs font-bold" style={{ color: "#4CAF50" }}>تم تأكيد اختيارك</p>
                  </div>
                )}

                {/* Investigator private result */}
                {isInvestigator && investigateResult && (
                  <div className="flex flex-col gap-1 px-3 py-3 rounded-xl"
                    style={{ backgroundColor: "#1A1000", border: `1px solid ${investigateResult.roleColor}` }}>
                    <span className="text-xs font-semibold" style={{ color: "#888888" }}>نتيجة التحقيق</span>
                    <span className="text-sm font-bold" style={{ color: investigateResult.roleColor }}>
                      {investigateResult.roleLabel}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-6 px-4">
                <Lock size={28} color="#2A2A2A" />
                <p className="text-sm font-semibold text-center" style={{ color: "#555555" }}>
                  {({
                    night_sleep:  "القرية نائمة... الكل يغمض عيونه",
                    night_wolf:   "الولد يتحرك الآن...",
                    night_shadow: "الإكة تتحرك الآن...",
                    night_seer:   "الشايب يحقق الآن...",
                    night_guard:  "البنت تحمي الآن...",
                  } as Record<string, string>)[gamePhase] ?? "انتظر..."}
                </p>
              </div>
            )}

            {/* ── Mafia Synergy Tactical Banner (wolf/shadow only) ── */}
            {isMafia && (mafiaSync.killTarget || mafiaSync.silenceTarget) && (
              <div className="flex flex-col gap-2 px-4 pb-4">
                <div className="h-px w-full" style={{ backgroundColor: "#2A0000" }} />
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#8B0000" }}>تنسيق الفريق</span>
                {mafiaSync.killTarget && (
                  <div className="flex flex-row-reverse items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ backgroundColor: "#1A0000", border: "1px solid #5C1010" }}>
                    <span className="text-sm font-bold" style={{ color: "#FF4040" }}>🔪 الولد يخطط لقتل: {mafiaSync.killTarget}</span>
                  </div>
                )}
                {mafiaSync.silenceTarget && (
                  <div className="flex flex-row-reverse items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ backgroundColor: "#1A0A00", border: "1px solid #5C2A00" }}>
                    <span className="text-sm font-bold" style={{ color: "#FF8C42" }}>🤐 الإكة ستُسكت: {mafiaSync.silenceTarget}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Voting Panel ── */}
        {gamePhase === "voting" && (
          <div className="w-full rounded-2xl overflow-hidden"
            style={{ border: "1px solid #FF8F00", backgroundColor: "#100A00" }}>
            {votedFor ? (
              <div className="flex flex-col items-center gap-3 py-6 px-4">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#FF8F00" }} />
                <p className="text-sm font-bold" style={{ color: "#FF8F00" }}>
                  {votedFor === "SKIP_VOTE"
                    ? "اخترت تخطي التصويت"
                    : <> صوّتت ضد: <span style={{ color: "#FFFFFF" }}>{votedFor}</span></>}
                </p>
                <p className="text-xs text-center" style={{ color: "#555555" }}>في انتظار باقي اللاعبين...</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#FF8F00" }}>التصويت</span>
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#FF8F00" }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "#CCCCCC" }}>
                  {trialState === "revoting" && accusedPlayer
                    ? `إعادة التصويت على: ${accusedPlayer}`
                    : "من تعتقد أنه المجرم؟"}
                </p>
                <div className="flex flex-col gap-2">
                  {(trialState === "revoting" && accusedPlayer
                    ? [accusedPlayer]
                    : alivePlayerNames.filter((n) => n !== role.myName)
                  ).map((name) => {
                      const isAlly = role.wolfAllies.includes(name);
                      return (
                        <button
                          key={name}
                          onClick={() => {
                            setVotedFor(name);
                            getSocket().emit("submitVote", { targetName: name, roomCode: role.code });
                          }}
                          className="w-full flex flex-row-reverse items-center justify-between px-4 py-3 rounded-xl font-semibold text-sm transition-all duration-150 active:scale-95"
                          style={{ backgroundColor: "#1A1A1A", border: `1px solid ${isAlly ? "#5C1010" : "#2A2A2A"}`, color: "#CCCCCC" }}>
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{name}</span>
                            {isAlly && (
                              <span className="text-xs font-bold" style={{ color: "#D32F2F" }}>(حليف 🐺)</span>
                            )}
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-lg"
                            style={{ backgroundColor: "#2A1800", color: "#FF8F00", border: "1px solid #FF8F00" }}>
                            تصويت
                          </span>
                        </button>
                      );
                    })}
                  {/* Skip vote — no one is executed if this wins majority */}
                  <button
                    onClick={() => {
                      setVotedFor("SKIP_VOTE");
                      getSocket().emit("submitVote", { targetName: "SKIP_VOTE", roomCode: role.code });
                    }}
                    className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 active:scale-95 mt-1"
                    style={{ backgroundColor: "transparent", border: "1px dashed #444444", color: "#666666" }}>
                    تخطي التصويت
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Live Vote Tally (visible to all during voting) ── */}
        {gamePhase === "voting" && voteUpdate && (
          <div className="w-full flex flex-col gap-3 rounded-2xl p-4"
            style={{ backgroundColor: "#0A0A00", border: "1px solid #3A2A00" }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>التصويت الكلي</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "#1A1A1A", color: "#FF8F00", border: "1px solid #FF8F00" }}>
                {Object.keys(voteUpdate.votes).length} / {voteUpdate.totalAlive ?? "..."} صوت
              </span>
            </div>
            {Object.keys(voteUpdate.votes).length > 0 ? (
              <div className="rounded-xl flex flex-col overflow-hidden"
                style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A" }}>
                {Object.entries(
                  Object.values(voteUpdate.votes).reduce<Record<string, number>>((acc, t) => {
                    acc[t] = (acc[t] ?? 0) + 1; return acc;
                  }, {})
                ).sort((a, b) => b[1] - a[1]).map(([name, count], i, arr) => (
                  <div key={name}
                    className="flex flex-row-reverse items-center justify-between px-3 py-2.5"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid #1E1E1E" : "none" }}>
                    <span className="text-sm font-semibold" style={{ color: name === "SKIP_VOTE" ? "#666666" : "#FFFFFF" }}>
                      {name === "SKIP_VOTE" ? "تخطي التصويت" : name}
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "#2A0000", color: "#D32F2F" }}>{count} أصوات</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-center py-2" style={{ color: "#555555" }}>لا توجد أصوات بعد...</p>
            )}
          </div>
        )}

        {/* ── Execution Reveal Banner (day_discussion after a vote) ── */}
        {gamePhase === "day_discussion" && executionInfo && (
          <div className="w-full flex flex-col items-center gap-3 rounded-2xl p-5"
            style={{ backgroundColor: "#0D0000", border: "2px solid #D32F2F" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#2A0000", border: "1px solid #D32F2F" }}>
              <span className="text-xl">⚖️</span>
            </div>
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: "#8B0000" }}>قرار القرية</p>
            <p className="text-base font-bold text-center text-white">
              تم إعدام{" "}
              <span style={{ color: "#D32F2F" }}>{executionInfo.name}</span>
            </p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ backgroundColor: "#1A0000", border: "1px solid #3A0000" }}>
              <span className="text-sm font-semibold" style={{ color: "#AAAAAA" }}>دوره كان:</span>
              <span className="text-sm font-black" style={{ color: executionInfo.roleColor }}>
                {executionInfo.roleLabel}
              </span>
            </div>
          </div>
        )}

        <LeaveButton onLeave={onLeave} />
        <Footer />
      </div>
    </div>
  );
}

// ─── Pre-Distribution "Everyone Sleep" Gate ───────────────────────────────────
function PreDistributionScreen({
  onStart,
  playGameAudio,
}: {
  onStart: () => void;
  playGameAudio: (fileName: string) => void;
}) {
  useEffect(() => {
    playGameAudio("start.m4a");
    const timer = setTimeout(onStart, 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-full w-full flex flex-col items-center justify-center gap-10 px-8" style={ROOT_STYLE}>
      <Moon size={56} color="#3A3A6A" strokeWidth={1} style={{ opacity: 0.85 }} />
      <p className="text-2xl font-black text-center leading-relaxed"
        style={{ color: "#2A2A4A" }}>
        الجميع ينام.. الكل يغمض عينه
      </p>
    </div>
  );
}

// ─── Game Over Screen ─────────────────────────────────────────────────────────

// ── AutoAdvanceDiscussion — fires onExpire() once when timerEndsAt passes ─────
function AutoAdvanceDiscussion({
  timerEndsAt, onExpire, children,
}: { timerEndsAt: number | null; onExpire: () => void; children: ReactNode }) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (!timerEndsAt) { firedRef.current = false; return; }
    firedRef.current = false;
    const id = setInterval(() => {
      if (!firedRef.current && Date.now() >= timerEndsAt) {
        firedRef.current = true;
        onExpire();
      }
    }, 500);
    return () => clearInterval(id);
  }, [timerEndsAt, onExpire]);
  return <>{children}</>;
}

// ── DayTimerBar — animated progress bar + countdown for day phases ────────────
function DayTimerBar({ endsAt, maxSeconds, urgentAt = 10, heartbeat = false }: { endsAt: number | null; maxSeconds: number; urgentAt?: number; heartbeat?: boolean }) {
  const [secs, setSecs] = useState<number | null>(null);

  useEffect(() => {
    if (!endsAt) { setSecs(null); return; }
    const tick = () => setSecs(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [endsAt]);

  // Tension heartbeat — loops through the final 10s, clears at 0 / phase change.
  useEffect(() => {
    if (!heartbeat) return;
    if (secs !== null && secs > 0 && secs <= 10) startHeartbeat();
    else stopHeartbeat();
  }, [heartbeat, secs]);
  useEffect(() => () => stopHeartbeat(), []);

  if (secs === null) return null;

  const pct       = Math.max(0, Math.min(100, (secs / maxSeconds) * 100));
  const isUrgent  = secs <= urgentAt;
  const mm        = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss        = String(secs % 60).padStart(2, "0");

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      {/* Countdown digits */}
      <div className="flex items-center gap-1.5">
        <Timer size={13} style={{ color: isUrgent ? "#D32F2F" : "#555" }} />
        <motion.span
          className="text-base font-black tabular-nums"
          animate={isUrgent ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
          transition={isUrgent ? { repeat: Infinity, duration: 0.75, ease: "easeInOut" } : {}}
          style={{ color: isUrgent ? "#D32F2F" : "#AAAAAA" }}
        >
          {mm}:{ss}
        </motion.span>
      </div>
      {/* Progress bar track */}
      <div className="w-full rounded-full overflow-hidden" style={{ height: 5, backgroundColor: "#1A1A1A" }}>
        <motion.div
          animate={{
            width: `${pct}%`,
            backgroundColor: isUrgent ? "#D32F2F" : "#FFFFFF",
            opacity: isUrgent ? [1, 0.35, 1] : 1,
          }}
          transition={{
            width: { duration: 0.45, ease: "linear" },
            backgroundColor: { duration: 0.3 },
            opacity: isUrgent
              ? { repeat: Infinity, duration: 0.75, ease: "easeInOut" }
              : { duration: 0.3 },
          }}
          style={{ height: "100%", borderRadius: 9999 }}
        />
      </div>
    </div>
  );
}

// ── Countdown component ───────────────────────────────────────────────────────
function Countdown({ endsAt, heartbeat = false }: { endsAt: number | null; heartbeat?: boolean }) {
  const [secs, setSecs] = useState<number | null>(null);

  useEffect(() => {
    if (!endsAt) { setSecs(null); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setSecs(remaining);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [endsAt]);

  // Tension heartbeat — loops through the final 10s, clears at 0 / phase change.
  // Gated to the active voting/discussion timer only (callers pass heartbeat).
  useEffect(() => {
    if (heartbeat && secs !== null && secs > 0 && secs <= 10) startHeartbeat();
    else stopHeartbeat();
  }, [heartbeat, secs]);
  useEffect(() => () => stopHeartbeat(), []);

  if (secs === null || secs <= 0) return null;
  const urgent = secs <= 5;
  return (
    <div className={`flex items-center justify-center gap-1.5${urgent ? " animate-pulse" : ""}`}>
      <Timer size={12} style={{ color: urgent ? "#D32F2F" : "#555555" }} />
      <span className="text-xs font-bold tabular-nums" style={{ color: urgent ? "#D32F2F" : "#555555" }}>
        {String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
      </span>
    </div>
  );
}

// ── DeadScreen (shown to eliminated players) ───────────────────────────────
function DeadScreen({ myName, deathReason }: { myName: string; deathReason: "assassinated" | "executed" | null }) {
  const reasonText =
    deathReason === "assassinated" ? "تم اغتيالك من قبل الولد 🔪" :
    deathReason === "executed"     ? "تم إعدامك بناءً على تصويت القرية ⚖️" :
                                     "لقد خرجت من اللعبة";

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 py-8">
      <div className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ backgroundColor: "#1A0000", border: "2px solid #D32F2F" }}>
        <Skull size={32} color="#D32F2F" />
      </div>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-xl font-black" style={{ color: "#D32F2F" }}>لقد قُتلت</p>
        <p className="text-sm font-semibold" style={{ color: "#888888" }}>{myName}</p>
        <p className="text-base font-bold leading-snug mt-1" style={{ color: "#CC4444" }}>
          {reasonText}
        </p>
      </div>
      <p className="text-xs text-center mt-4 px-2" style={{ color: "#333333" }}>
        أنت الآن في طور المشاهدة.. انتظر نهاية الجولة
      </p>
    </div>
  );
}

function GameOverScreen({ result, isHost, onEnd }: {
  result: GameOverPayload;
  isHost: boolean;
  onEnd: () => void;
}) {
  const wolvesWon = result.winner === "wolves";
  return (
    <div className="min-h-full w-full flex flex-col items-center justify-center px-6 gap-8" style={ROOT_STYLE}>
      {/* Executed player banner */}
      {result.executedPlayerName && (
        <div className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl rounded-2xl flex flex-col items-center gap-1 py-3 px-4"
          style={{ backgroundColor: "#0D0000", border: "1px solid #D32F2F" }}>
          <span className="text-xs font-semibold tracking-widest" style={{ color: "#666666" }}>تم إعدام</span>
          <span className="text-lg font-black" style={{ color: "#FF6B6B" }}>{result.executedPlayerName}</span>
        </div>
      )}

      {/* Main result card */}
      <div className="w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl flex flex-col items-center gap-6">
        <div style={{ filter: `drop-shadow(0 0 36px ${wolvesWon ? "#D32F2F" : "#4CAF50"})` }}>
          <VenetianMask
            size={100}
            color={wolvesWon ? "#D32F2F" : "#4CAF50"}
            strokeWidth={0.9}
          />
        </div>

        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className="text-5xl font-black leading-tight"
            style={{ color: wolvesWon ? "#D32F2F" : "#4CAF50" }}>
            {wolvesWon ? "انتصرت المافيا" : "انتصر الشعب"}
          </span>
          <p className="text-base font-semibold" style={{ color: wolvesWon ? "#FF6B6B" : "#8BC34A" }}>
            {wolvesWon ? "سقطت القرية!" : "تم القضاء على المافيا!"}
          </p>
        </div>

        <div className="w-16 h-0.5 rounded-full" style={{ backgroundColor: wolvesWon ? "#D32F2F" : "#4CAF50" }} />

        <button
          onClick={onEnd}
          className="w-full py-4 rounded-2xl font-bold text-lg transition-all duration-200 active:scale-95"
          style={{
            backgroundColor: wolvesWon ? "#D32F2F" : "#1B5E20",
            color: "#ffffff",
          }}>
          {isHost ? "إنهاء اللعبة وحل الغرفة" : "العودة للقائمة"}
        </button>
      </div>

      <p className="text-xs" style={{ color: "#333333" }}>القرية تنام.. والقاتل يصحو</p>
    </div>
  );
}

// ─── Host Dashboard ───────────────────────────────────────────────────────────

function HostDashboard({ game, activeGamePhase, morningResults, voteUpdate, alivePlayerNames, phaseEndsAt, executionInfo, accusedPlayer, trialState, onStartTrialVote, onLeave }: {
  game: GameState;
  activeGamePhase: string;
  morningResults: MorningResultsPayload | null;
  voteUpdate: VoteUpdatePayload | null;
  alivePlayerNames: string[];
  phaseEndsAt: number | null;
  executionInfo: { name: string; roleLabel: string; roleColor: string } | null;
  accusedPlayer: string | null;
  trialState: "none" | "accused" | "revoting";
  onStartTrialVote: () => void;
  onLeave: () => void;
}) {
  const [myRoleRevealed, setMyRoleRevealed] = useState(false);

  // ── Host as active player: night action state ─────────────────────────
  const [selectedTarget, setSelected]     = useState<string | null>(null);
  const [actionSubmitted, setSubmitted]   = useState(false);
  const [investigateResult, setInvResult] = useState<InvestigateResultPayload | null>(null);
  const [votedFor, setVotedFor]           = useState<string | null>(null);
  const [mafiaSync, setMafiaSync]         = useState<{ killTarget: string | null; silenceTarget: string | null }>({ killTarget: null, silenceTarget: null });

  const myEntry = game.players.find((p) => p.name === game.myName);

  // Derive host's own role flags
  const myRoleLabel    = myEntry?.roleLabel ?? "";
  const myRoleColor    = myEntry?.roleColor ?? "#555555";
  const hostIsWolf         = myRoleLabel === "الولد";
  const hostIsShadow       = myRoleLabel === "الإكة";
  const hostIsMafia        = hostIsWolf || hostIsShadow;
  const hostIsInvestigator = myRoleLabel === "الشايب";
  const hostIsProtector    = myRoleLabel === "البنت";

  const hostIsMyTurn =
    (activeGamePhase === "night_wolf"   && hostIsWolf)         ||
    (activeGamePhase === "night_shadow" && hostIsShadow)       ||
    (activeGamePhase === "night_seer"   && hostIsInvestigator) ||
    (activeGamePhase === "night_guard"  && hostIsProtector);

  const isNightPhase = activeGamePhase.startsWith("night_");

  const hostActionLabel = hostIsWolf
    ? "تذبح مين هذي الليلة يا ولد؟"
    : hostIsShadow
      ? "تسكتين مين يا إكة الليلة؟"
      : hostIsInvestigator
        ? "تسأل عن مين يا شايب؟"
        : "تحمين مين يا بنت؟";

  const getHostActionType = (): string => {
    if (hostIsWolf)         return "kill";
    if (hostIsShadow)       return "silence";
    if (hostIsInvestigator) return "investigate";
    return "protect";
  };

  // Build host's targeting list from the authoritative alive list.
  // Mirrors PlayerScreen rules exactly (guard self-targeting included).
  const aliveOthers = alivePlayerNames.filter((n) => n !== game.myName);
  const hostTargetList: string[] = hostIsWolf
    ? aliveOthers.filter((n) => !game.wolfAllies.includes(n))
    : hostIsShadow
      ? alivePlayerNames      // shadow can target any alive player incl. self
      : hostIsProtector
        ? alivePlayerNames    // guard can self-protect
        : aliveOthers;        // seer excludes self

  // Reset night action state when phase changes
  useEffect(() => {
    setSelected(null);
    setSubmitted(false);
    setInvResult(null);
    setVotedFor(null);
    if (activeGamePhase === "night_sleep" || activeGamePhase === "day_discussion") {
      setMafiaSync({ killTarget: null, silenceTarget: null });
    }
  }, [activeGamePhase]);

  // Listen for private investigator result (host may be seer)
  useEffect(() => {
    const socket = getSocket();
    const onResult = (payload: InvestigateResultPayload) => setInvResult(payload);
    socket.on("investigateResult", onResult);
    return () => { socket.off("investigateResult", onResult); };
  }, []);

  // Listen for mafia team synergy updates (only relevant if host is wolf/shadow)
  useEffect(() => {
    if (!hostIsMafia) return;
    const socket = getSocket();
    const onSync = (payload: MafiaActionSyncPayload) => {
      setMafiaSync((prev) => ({
        killTarget:    payload.actionType === "kill"    ? payload.targetName : prev.killTarget,
        silenceTarget: payload.actionType === "silence" ? payload.targetName : prev.silenceTarget,
      }));
    };
    socket.on("mafiaActionSync", onSync);
    return () => { socket.off("mafiaActionSync", onSync); };
  }, [hostIsMafia]);

  // ── Auto-advance: trigger voting when day_discussion timer expires ────────
  // Fires at most once per phaseEndsAt window; skips post-execution rounds.
  const autoVoteFiredRef = useRef<number | null>(null);
  useEffect(() => {
    if (activeGamePhase !== "day_discussion") return;
    if (!phaseEndsAt)  return;
    if (executionInfo) return; // post-execution — let host decide manually
    if (trialState !== "none") return; // accused/revoting — host drives next action

    const fire = () => {
      if (autoVoteFiredRef.current === phaseEndsAt) return; // guard: fire once
      autoVoteFiredRef.current = phaseEndsAt;
      getSocket().emit("startVoting", { code: game.code });
    };

    const msLeft = phaseEndsAt - Date.now();
    if (msLeft <= 0) { fire(); return; }

    const timer = setTimeout(fire, msLeft);
    return () => clearTimeout(timer);
  }, [activeGamePhase, phaseEndsAt, executionInfo, trialState, game.code]);

  const handleSubmitHostAction = () => {
    if (!selectedTarget) return;
    getSocket().emit("submitNightAction", {
      actionType: getHostActionType(),
      targetName: selectedTarget,
      roomCode:   game.code,
    });
    setSubmitted(true);
  };

  // Phase labels for host status display
  const NIGHT_PHASE_LABELS: Record<string, string> = {
    night_sleep:  "القرية نائمة — الكل يغمض عيونه",
    night_wolf:   "الولد — يتحرك الآن",
    night_shadow: "الإكة — تُسكت الآن",
    night_seer:   "الشايب — يحقق الآن",
    night_guard:  "البنت — تحمي الآن",
  };

  const isPreNight   = activeGamePhase === "role_reveal";
  const isInNightSeq = activeGamePhase.startsWith("night_");

  const handleStartVoting     = () => getSocket().emit("startVoting",          { code: game.code });
  const handleStartNightPhase = () => getSocket().emit("startNightPhase",      { code: game.code });
  const handleTallyAndExecute = () => getSocket().emit("tallyVotesAndExecute", { code: game.code });

  return (
    <div className="min-h-full w-full flex flex-col" style={ROOT_STYLE}>
      <NightRoleSleepingOverlay phase={activeGamePhase} />
      <div className="flex flex-col flex-1 w-full max-w-md sm:max-w-xl md:max-w-2xl lg:max-w-3xl mx-auto px-4 py-6 gap-5">

        <TopBar />

        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic size={16} color="#D32F2F" />
            <span className="font-bold text-white text-base">{game.myName}</span>
            <span className="text-xs px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "#3A0000", color: "#FF6B6B", fontSize: "0.65rem" }}>مضيف + لاعب</span>
          </div>
        </div>

        {/* Countdown bar */}
        <Countdown endsAt={phaseEndsAt} heartbeat={activeGamePhase === "day_discussion" || activeGamePhase === "voting"} />

        {/* ── My Role Card: big centered card only during role_reveal phase ── */}
        {myEntry && activeGamePhase === "role_reveal" && (
          <div className="flex flex-col gap-3">
            <motion.div
              onPointerDown={() => setMyRoleRevealed(true)}
              onPointerUp={() => setMyRoleRevealed(false)}
              onPointerLeave={() => setMyRoleRevealed(false)}
              onPointerCancel={() => setMyRoleRevealed(false)}
              whileTap={{ scale: 0.98 }}
              className="w-full rounded-2xl border-2 flex flex-col items-center justify-center gap-5 py-12 px-6 select-none transition-all duration-300"
              style={{
                backgroundColor: myRoleRevealed ? "#0A0000" : "#111111",
                borderColor:     myRoleRevealed ? myRoleColor : "#2A2A2A",
                boxShadow:       myRoleRevealed ? `0 0 40px ${myRoleColor}33` : "none",
                cursor: "pointer", touchAction: "none",
                userSelect: "none", WebkitUserSelect: "none",
              }}>
              {myRoleRevealed ? (
                <>
                  <VenetianMask size={64} color={myRoleColor} strokeWidth={1.2} />
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-xs tracking-widest font-semibold" style={{ color: "#666666" }}>قناعك</span>
                    <span className="text-3xl font-black text-center leading-tight"
                      style={{ color: myRoleColor, direction: "rtl" }}>
                      {myRoleLabel}
                    </span>
                    <span className="text-xs text-center px-2 leading-relaxed" style={{ color: "#888888" }}>
                      {myRoleLabel === "الولد"   && "أنت القاتل. اختر ضحيتك كل ليلة."}
                      {myRoleLabel === "الإكة"   && "أنت الكاتم. امنع لاعب من الكلام غداً."}
                      {myRoleLabel === "الشايب"  && "أنت العرّاف. اكشف حقيقة لاعب كل ليلة."}
                      {myRoleLabel === "البنت"   && "أنت الحارس. احمِ لاعباً من القتل."}
                      {myRoleLabel === "المواطن" && "أنت من الشعب. ابحث عن المافيا وصوّت ضدهم."}
                    </span>
                    {hostIsMafia && game.wolfAllies.length > 0 && (
                      <span className="text-xs mt-1" style={{ color: "#D32F2F" }}>زميلك: {game.wolfAllies.join("، ")}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2" style={{ color: "#444444" }}>
                    <Unlock size={14} /><span className="text-xs">أنت ترى قناعك</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative">
                    <VenetianMask size={64} color="#2A2A2A" strokeWidth={1.2} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Lock size={22} color="#555555" />
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-xl font-bold" style={{ color: "#444444" }}>قناعك مخفي</span>
                    <span className="text-sm text-center" style={{ color: "#333333" }}>اضغط وامسك للكشف عن قناعك</span>
                  </div>
                  <div className="flex items-center gap-2" style={{ color: "#333333" }}>
                    <Lock size={14} /><span className="text-xs">مخفي عن الجميع</span>
                  </div>
                </>
              )}
            </motion.div>
            <p className="text-xs text-center px-4" style={{ color: "#333333" }}>
              {myRoleRevealed ? "ارفع إصبعك لإخفاء القناع مجدداً" : "اضغط مطولاً على البطاقة للكشف — سيختفي عند الرفع"}
            </p>
          </div>
        )}

        {/* ── My Role Card (compact, shown after role_reveal phase) ── */}
        {myEntry && activeGamePhase !== "role_reveal" && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>بطاقة قناعي</span>
            <motion.div
              onPointerDown={() => setMyRoleRevealed(true)}
              onPointerUp={() => setMyRoleRevealed(false)}
              onPointerLeave={() => setMyRoleRevealed(false)}
              onPointerCancel={() => setMyRoleRevealed(false)}
              whileTap={{ scale: 0.98 }}
              className="w-full rounded-xl border-2 flex items-center gap-4 px-4 py-3 select-none transition-all duration-300"
              style={{
                backgroundColor: myRoleRevealed ? "#0A0000" : "#111111",
                borderColor:     myRoleRevealed ? myRoleColor : "#2A2A2A",
                boxShadow:       myRoleRevealed ? `0 0 24px ${myRoleColor}33` : "none",
                cursor: "pointer",
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}>
              {myRoleRevealed ? (
                <>
                  <VenetianMask size={32} color={myRoleColor} strokeWidth={1.3} className="flex-shrink-0" />
                  <div className="flex flex-col items-end flex-1 min-w-0">
                    <span className="text-xs" style={{ color: "#666666" }}>قناعك</span>
                    <span className="text-base font-black leading-tight text-right" style={{ color: myRoleColor }}>
                      {myRoleLabel}
                    </span>
                    {hostIsMafia && game.wolfAllies.length > 0 && (
                      <span className="text-xs mt-0.5" style={{ color: "#D32F2F" }}>
                        زميلك: {game.wolfAllies.join("، ")}
                      </span>
                    )}
                  </div>
                  <Unlock size={14} color="#555555" className="flex-shrink-0" />
                </>
              ) : (
                <>
                  <div className="relative flex-shrink-0">
                    <VenetianMask size={32} color="#2A2A2A" strokeWidth={1.3} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Lock size={12} color="#555555" />
                    </div>
                  </div>
                  <div className="flex flex-col items-end flex-1 min-w-0">
                    <span className="text-sm font-bold" style={{ color: "#444444" }}>قناعك مخفي</span>
                    <span className="text-xs" style={{ color: "#333333" }}>اضغط وامسك للكشف</span>
                  </div>
                  <Lock size={14} color="#333333" className="flex-shrink-0" />
                </>
              )}
            </motion.div>
          </div>
        )}

        {/* ── Night Action Panel (host as player) ── */}
        {isNightPhase && (
          <div className="w-full rounded-2xl overflow-hidden"
            style={{ border: `1px solid ${hostIsMyTurn ? "#D32F2F" : "#1E1E1E"}`, backgroundColor: hostIsMyTurn ? "#0D0000" : "#0A0A0A" }}>
            {hostIsMyTurn ? (
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#D32F2F" }}>دورك الآن</span>
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#D32F2F" }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "#CCCCCC" }}>{hostActionLabel}</p>
                <div className="flex flex-col gap-2">
                  {hostTargetList.length === 0 ? (
                    <p className="text-xs text-center py-2" style={{ color: "#555555" }}>لا يوجد أهداف متاحة</p>
                  ) : (
                    hostTargetList.map((name) => (
                      <div key={name} className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                        style={{ backgroundColor: selectedTarget === name ? "#2A0000" : "#141414", border: `1px solid ${selectedTarget === name ? "#D32F2F" : "#222222"}` }}>
                        <button
                          onClick={() => { setSelected(name); setSubmitted(false); }}
                          disabled={actionSubmitted}
                          className="px-3 py-1 rounded-lg text-xs font-bold transition-all duration-150 active:scale-95"
                          style={{ backgroundColor: selectedTarget === name ? "#D32F2F" : "#1A1A1A", color: selectedTarget === name ? "#fff" : "#888", border: `1px solid ${selectedTarget === name ? "#D32F2F" : "#333"}`, opacity: actionSubmitted ? 0.5 : 1 }}>
                          {selectedTarget === name ? "تم الاختيار" : "اختر"}
                        </button>
                        <span className="text-sm font-semibold" style={{ color: selectedTarget === name ? "#fff" : "#AAA" }}>
                          {name}{name === game.myName ? " (أنت)" : ""}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                {selectedTarget && !actionSubmitted && (
                  <button onClick={handleSubmitHostAction}
                    className="w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 active:scale-95"
                    style={{ backgroundColor: "#D32F2F", color: "#fff" }}>
                    تأكيد الاختيار
                  </button>
                )}
                {actionSubmitted && (
                  <div className="flex items-center justify-center gap-2 py-2 rounded-xl"
                    style={{ backgroundColor: "#0D2000", border: "1px solid #33691E" }}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#4CAF50" }} />
                    <p className="text-xs font-bold" style={{ color: "#4CAF50" }}>تم تأكيد اختيارك</p>
                  </div>
                )}
                {hostIsInvestigator && investigateResult && (
                  <div className="flex flex-col gap-1 px-3 py-3 rounded-xl"
                    style={{ backgroundColor: "#1A1000", border: `1px solid ${investigateResult.roleColor}` }}>
                    <span className="text-xs font-semibold" style={{ color: "#888" }}>نتيجة التحقيق</span>
                    <span className="text-sm font-bold" style={{ color: investigateResult.roleColor }}>
                      {investigateResult.roleLabel}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-4 px-4">
                <Lock size={22} color="#2A2A2A" />
                <p className="text-sm font-semibold text-center" style={{ color: "#333333" }}>انتظر دورك الليلي...</p>
              </div>
            )}

            {/* ── Mafia Synergy Tactical Banner (host as wolf/shadow only) ── */}
            {hostIsMafia && (mafiaSync.killTarget || mafiaSync.silenceTarget) && (
              <div className="flex flex-col gap-2 px-4 pb-4">
                <div className="h-px w-full" style={{ backgroundColor: "#2A0000" }} />
                <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#8B0000" }}>تنسيق الفريق</span>
                {mafiaSync.killTarget && (
                  <div className="flex flex-row-reverse items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ backgroundColor: "#1A0000", border: "1px solid #5C1010" }}>
                    <span className="text-sm font-bold" style={{ color: "#FF4040" }}>🔪 الولد يخطط لقتل: {mafiaSync.killTarget}</span>
                  </div>
                )}
                {mafiaSync.silenceTarget && (
                  <div className="flex flex-row-reverse items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ backgroundColor: "#1A0A00", border: "1px solid #5C2A00" }}>
                    <span className="text-sm font-bold" style={{ color: "#FF8C42" }}>🤐 الإكة ستُسكت: {mafiaSync.silenceTarget}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Morning Results Banner — hidden once execution info is available ── */}
        {activeGamePhase === "day_discussion" && morningResults && !executionInfo && (
          <div className="rounded-2xl flex flex-col gap-2 p-4"
            style={{ backgroundColor: morningResults.killedPlayerName ? "#1A0000" : "#001A0A", border: `1px solid ${morningResults.killedPlayerName ? "#D32F2F" : "#33691E"}` }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0"
                style={{ backgroundColor: morningResults.killedPlayerName ? "#D32F2F" : "#4CAF50" }} />
              <p className="text-sm font-bold" style={{ color: morningResults.killedPlayerName ? "#FF6B6B" : "#8BC34A" }}>
                {morningResults.killedPlayerName
                  ? morningResults.killedPlayerName === morningResults.silencedPlayerName
                    ? `اكتشفنا جثة المقتول: ${morningResults.killedPlayerName}.. والمفارقة أنه كان ساكتاً أيضاً!`
                    : `اكتشفنا جثة المقتول: ${morningResults.killedPlayerName}`
                  : "مرت الليلة بسلام.. لم يمت أحد."}
              </p>
            </div>
            {morningResults.silencedPlayerName && morningResults.silencedPlayerName !== morningResults.killedPlayerName && (
              <p className="text-xs font-semibold" style={{ color: "#FF8F00" }}>
                والساكت: {morningResults.silencedPlayerName}
              </p>
            )}
          </div>
        )}

        {/* ── Execution Reveal Banner (post-execution day_discussion) ── */}
        {activeGamePhase === "day_discussion" && executionInfo && (
          <div className="w-full flex flex-col items-center gap-3 rounded-2xl p-5"
            style={{ backgroundColor: "#0D0000", border: "2px solid #D32F2F" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#2A0000", border: "1px solid #D32F2F" }}>
              <span className="text-xl">⚖️</span>
            </div>
            <p className="text-xs font-black uppercase tracking-widest" style={{ color: "#8B0000" }}>قرار القرية</p>
            <p className="text-base font-bold text-center text-white">
              تم إعدام{" "}
              <span style={{ color: "#D32F2F" }}>{executionInfo.name}</span>
            </p>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ backgroundColor: "#1A0000", border: "1px solid #3A0000" }}>
              <span className="text-sm font-semibold" style={{ color: "#AAAAAA" }}>دوره كان:</span>
              <span className="text-sm font-black" style={{ color: executionInfo.roleColor }}>
                {executionInfo.roleLabel}
              </span>
            </div>
          </div>
        )}

        {/* ── Post-execution final tally (day_discussion, after vote) ── */}
        {activeGamePhase === "day_discussion" && executionInfo && voteUpdate && Object.keys(voteUpdate.votes).length > 0 && (
          <div className="w-full flex flex-col gap-3 rounded-2xl p-4"
            style={{ backgroundColor: "#0A0A00", border: "1px solid #3A2A00" }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>نتيجة التصويت النهائية</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "#1A1A1A", color: "#FF8F00", border: "1px solid #FF8F00" }}>
                {Object.keys(voteUpdate.votes).length} / {voteUpdate.totalAlive ?? "..."} صوت
              </span>
            </div>
            <div className="rounded-xl flex flex-col overflow-hidden"
              style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A" }}>
              {Object.entries(
                Object.values(voteUpdate.votes).reduce<Record<string, number>>((acc, t) => {
                  acc[t] = (acc[t] ?? 0) + 1; return acc;
                }, {})
              ).sort((a, b) => b[1] - a[1]).map(([name, count], i, arr) => (
                <div key={name}
                  className="flex flex-row-reverse items-center justify-between px-3 py-2.5"
                  style={{ borderBottom: i < arr.length - 1 ? "1px solid #1E1E1E" : "none" }}>
                  <span className="text-sm font-semibold" style={{ color: name === executionInfo.name ? "#FF6B6B" : "#fff" }}>{name}</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: "#2A0000", color: "#D32F2F" }}>{count} أصوات</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Voting: host casts their own vote + tally + execute ── */}
        {activeGamePhase === "voting" && (
          <div className="flex flex-col gap-3">
            {/* Host's own vote */}
            <div className="w-full rounded-2xl overflow-hidden"
              style={{ border: "1px solid #FF8F00", backgroundColor: "#100A00" }}>
              {votedFor ? (
                <div className="flex flex-col items-center gap-2 py-4 px-4">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#FF8F00" }} />
                  <p className="text-sm font-bold" style={{ color: "#FF8F00" }}>
                    {votedFor === "SKIP_VOTE"
                      ? "اخترت تخطي التصويت"
                      : <> صوّتت ضد: <span style={{ color: "#fff" }}>{votedFor}</span></>}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#FF8F00" }}>صوّت أنت</span>
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#FF8F00" }} />
                  </div>
                  <div className="flex flex-col gap-2">
                    {(voteUpdate?.alivePlayerNames ?? game.players.map((p) => p.name))
                      .filter((n) => n !== game.myName)
                      .map((name) => (
                        <button key={name}
                          onClick={() => {
                            setVotedFor(name);
                            getSocket().emit("submitVote", { targetName: name, roomCode: game.code });
                          }}
                          className="w-full flex flex-row-reverse items-center justify-between px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 active:scale-95"
                          style={{ backgroundColor: "#1A1A1A", border: "1px solid #2A2A2A", color: "#CCC" }}>
                          <span>{name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-lg"
                            style={{ backgroundColor: "#2A1800", color: "#FF8F00", border: "1px solid #FF8F00" }}>
                            تصويت
                          </span>
                        </button>
                      ))}
                    {/* Skip vote — no one is executed if this wins majority */}
                    <button
                      onClick={() => {
                        setVotedFor("SKIP_VOTE");
                        getSocket().emit("submitVote", { targetName: "SKIP_VOTE", roomCode: game.code });
                      }}
                      className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-150 active:scale-95 mt-1"
                      style={{ backgroundColor: "transparent", border: "1px dashed #444444", color: "#666666" }}>
                      تخطي التصويت
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Live tally */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>التصويت الكلي</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "#1A1A1A", color: "#FF8F00", border: "1px solid #FF8F00" }}>
                {voteUpdate ? Object.keys(voteUpdate.votes).length : 0} / {voteUpdate?.totalAlive ?? "..."} صوت
              </span>
            </div>
            {voteUpdate && Object.keys(voteUpdate.votes).length > 0 && (
              <div className="rounded-xl flex flex-col overflow-hidden"
                style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A" }}>
                {Object.entries(
                  Object.values(voteUpdate.votes).reduce<Record<string, number>>((acc, t) => {
                    acc[t] = (acc[t] ?? 0) + 1; return acc;
                  }, {})
                ).sort((a, b) => b[1] - a[1]).map(([name, count], i, arr) => (
                  <div key={name} className="flex flex-row-reverse items-center justify-between px-3 py-2.5"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid #1E1E1E" : "none" }}>
                    <span className="text-sm font-semibold" style={{ color: name === "SKIP_VOTE" ? "#666666" : "#FFFFFF" }}>
                      {name === "SKIP_VOTE" ? "تخطي التصويت" : name}
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "#2A0000", color: "#D32F2F" }}>{count} أصوات</span>
                  </div>
                ))}
              </div>
            )}

            {/* Execute button — label adapts to trial context */}
            <button onClick={handleTallyAndExecute}
              className="flex flex-row-reverse items-center justify-center gap-3 w-full px-5 py-4 rounded-xl font-bold text-base transition-all duration-200 active:scale-95"
              style={{ backgroundColor: "#D32F2F", color: "#fff", border: "1px solid #FF6B6B" }}>
              <Skull size={20} strokeWidth={2} />
              <span>
                {trialState === "revoting" && accusedPlayer
                  ? `إعدام ${accusedPlayer} أو إبراءه`
                  : "إنهاء التصويت وإعدام المتهم"}
              </span>
            </button>
          </div>
        )}

        {/* ── HOST CONTROLS: pre-night → start first night ── */}
        {isPreNight && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col items-center gap-3 px-4 py-4 rounded-2xl"
              style={{ backgroundColor: "#0A0A1A", border: "1px solid #1A1A4A" }}>
              <Moon size={28} color="#8888CC" />
              <p className="text-sm font-bold text-center" style={{ color: "#AAAACC" }}>
                الأقنعة وُزِّعت — اللعبة جاهزة للبدء
              </p>
            </div>
            <button
              onClick={handleStartNightPhase}
              className="flex flex-row-reverse items-center justify-center gap-3 w-full px-5 py-5 rounded-2xl font-black text-lg transition-all duration-200 active:scale-95"
              style={{ backgroundColor: "#1A1A4A", borderColor: "#4444CC", border: "2px solid #4444CC", color: "#CCCCFF" }}>
              <Moon size={22} strokeWidth={2.5} />
              <span>بدء الليلة الأولى</span>
            </button>
          </div>
        )}

        {/* ── HOST CONTROLS: during night — auto-timer phase indicator ── */}
        {isInNightSeq && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
            style={{ backgroundColor: "#0D0D1A", border: "1px solid #2A2A5A" }}>
            <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: "#6666FF" }} />
            <span className="text-xs font-bold" style={{ color: "#8888CC" }}>
              {NIGHT_PHASE_LABELS[activeGamePhase] ?? activeGamePhase}
            </span>
          </div>
        )}

        {/* ── HOST CONTROLS: day — varies by trial state ── */}
        {activeGamePhase === "day_discussion" && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>تحكم المضيف</span>
            {trialState === "none" && (
              <>
                {/* PRIMARY: start next night */}
                <button onClick={handleStartNightPhase}
                  className="flex flex-row-reverse items-center justify-center gap-3 w-full px-5 py-4 rounded-xl font-bold text-base transition-all duration-200 active:scale-95 shadow-lg"
                  style={{ backgroundColor: "#D32F2F", color: "#FFFFFF", border: "none" }}>
                  <Moon size={20} strokeWidth={2.5} />
                  <span>بدء الليلة التالية</span>
                </button>
                {/* SECONDARY: open voting */}
                <button onClick={handleStartVoting}
                  className="flex flex-row-reverse items-center justify-center gap-3 w-full px-5 py-4 rounded-xl border font-bold text-base transition-all duration-200 active:scale-95"
                  style={{ backgroundColor: "#1A1A1A", borderColor: "#555555", color: "#999999" }}>
                  <Sun size={20} strokeWidth={2} />
                  <span>بدء التصويت</span>
                </button>
              </>
            )}
            {trialState === "accused" && accusedPlayer && (
              <>
                {/* Accused banner */}
                <div className="flex flex-col items-center gap-1 p-3 rounded-xl"
                  style={{ backgroundColor: "#1A0505", border: "1px solid #7A1A1A" }}>
                  <span className="text-xs font-semibold" style={{ color: "#AA4444" }}>المتهم الرئيسي</span>
                  <span className="text-lg font-black text-white">{accusedPlayer}</span>
                  <span className="text-xs" style={{ color: "#666666" }}>لم تثبت أغلبية — تصويت إعادة النظر</span>
                </div>
                {/* ONLY action: start revote */}
                <button onClick={onStartTrialVote}
                  className="flex flex-row-reverse items-center justify-center gap-3 w-full px-5 py-4 rounded-xl font-bold text-base transition-all duration-200 active:scale-95 shadow-lg"
                  style={{ backgroundColor: "#D32F2F", color: "#FFFFFF", border: "none" }}>
                  <Sun size={20} strokeWidth={2.5} />
                  <span>إعادة التصويت على {accusedPlayer}</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Roster */}
        <div className="rounded-xl border flex flex-col overflow-hidden" style={{ backgroundColor: "#1A1A1A", borderColor: "#333333" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#2A2A2A" }}>
            <div className="flex items-center gap-2">
              <Users size={15} color="#D32F2F" />
              <span className="font-bold text-sm text-white">قائمة اللاعبين</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: "#1B5E20", color: "#4CAF50" }}>
              {game.players.length} لاعب
            </span>
          </div>
          <div className="flex flex-col max-h-48 overflow-y-auto">
            {game.players.map((player, idx) => (
              <div key={player.socketId} className="flex flex-row-reverse items-center gap-3 px-4 py-2.5"
                style={{ borderBottom: idx < game.players.length - 1 ? "1px solid #1E1E1E" : "none" }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: "#2A2A2A", color: "#9E9E9E" }}>{idx + 1}</div>
                <div className="flex-1 min-w-0 flex flex-row-reverse items-center gap-2">
                  <span className="text-white text-sm font-semibold">{player.name}</span>
                  {player.name === game.myName && (
                    <span className="text-xs" style={{ color: "#555" }}>(أنت)</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Emergency Abort — only shown during role_reveal phase ── */}
        {activeGamePhase === "role_reveal" && (
          <button
            onClick={() => {
              if (confirm("إلغاء التوزيع والعودة للوبي؟ سيعود جميع اللاعبين للغرفة من جديد.")) {
                getSocket().emit("abortGame", { code: game.code });
              }
            }}
            className="w-full py-3 rounded-2xl font-bold text-sm transition-all duration-200 active:scale-95"
            style={{ backgroundColor: "transparent", border: "1px solid #D32F2F", color: "#D32F2F" }}>
            إلغاء التوزيع والعودة للوبي
          </button>
        )}

        <LeaveButton onLeave={onLeave} label="إنهاء الجلسة والخروج" />
        <Footer />
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  // ── Top-level mode gate — null = mode selector, "online" / "narrator" = game mode
  // Hydrated from localStorage so a mid-game refresh keeps the user inside their mode.
  const { user, loading: authLoading } = useAuth();
  const [selectedMode, setSelectedMode] = useState<"online" | "narrator" | null>(() => loadSelectedMode());
  useEffect(() => {
    if (selectedMode) localStorage.setItem(STORAGE_MODE, selectedMode);
    else localStorage.removeItem(STORAGE_MODE);
  }, [selectedMode]);

  // Deferred-auth safety: once auth has resolved, a signed-out user must never
  // sit inside a game mode (stale persisted mode, storage tampering, or a fresh
  // sign-out). Drop the mode + narrator state so they return to the public
  // dashboard. Guarded on !authLoading so a legit user's persisted mode survives
  // the initial auth check.
  useEffect(() => {
    if (!authLoading && !user && selectedMode !== null) {
      clearNarratorState();
      setSelectedMode(null);
    }
  }, [authLoading, user, selectedMode]);

  const [needsResume, setNeedsResume] = useState(false);

  useEffect(() => {
    onAudioSuspendedChangeRef.current = (suspended) => setNeedsResume(suspended);
    return () => {
      onAudioSuspendedChangeRef.current = null;
    };
  }, []);

  // Re-check only when the tab becomes visible AND a context exists in suspended state.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const ctx = gameAudioContextRef.current;
      setNeedsResume(!!ctx && ctx.state === "suspended");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const [screen, setScreen]         = useState<Screen>("rejoining");
  const [lobby, setLobby]           = useState<LobbyState | null>(null);
  const [game, setGame]             = useState<GameState | null>(null);
  const [playerRole, setPlayerRole] = useState<MyRole | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [gamePhase, setGamePhase]   = useState<string>("lobby");
  const [initialJoinCode, setInitialJoinCode] = useState("");
  const [myDeathReason, setMyDeathReason]   = useState<"assassinated" | "executed" | null>(null);
  const [executionInfo, setExecutionInfo]   = useState<{ name: string; roleLabel: string; roleColor: string } | null>(null);
  const [morningResults, setMorningResults] = useState<MorningResultsPayload | null>(null);
  const [voteUpdate, setVoteUpdate]         = useState<VoteUpdatePayload | null>(null);
  const [gameOver, setGameOver]             = useState<GameOverPayload | null>(null);
  // ── Trial state — purely frontend, no backend changes ────────────────────
  const [accusedPlayer, setAccusedPlayer]   = useState<string | null>(null);
  const [trialState, setTrialState]         = useState<"none" | "accused" | "revoting">("none");
  // Refs so socket handlers (closed-over) always see current values
  const accusedPlayerRef = useRef<string | null>(null);
  const trialStateRef    = useRef<"none" | "accused" | "revoting">("none");
  accusedPlayerRef.current = accusedPlayer;
  trialStateRef.current    = trialState;
  const voteUpdateRef    = useRef<VoteUpdatePayload | null>(null);
  // Authoritative alive player list — updated from server events, used by both host/player
  const [alivePlayerNames, setAlivePlayerNames] = useState<string[]>([]);
  const [phaseEndsAt, setPhaseEndsAt]           = useState<number | null>(null);

  // Always-fresh ref so async callbacks never read stale lobby
  const lobbyRef = useRef<LobbyState | null>(null);
  lobbyRef.current = lobby;

  // ── Audio + Wake Lock system (auto-initialized on join/create) ──────────
  const isHostRef           = useRef(false);
  const currentAudioRef     = useRef<HTMLAudioElement | null>(null);
  const activeAudioRef      = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef         = useRef<WakeLockSentinel | null>(null);
  const ambientRef          = useRef<HTMLAudioElement | null>(null); // night/day background tone
  const alertRef            = useRef<HTMLAudioElement | null>(null); // wake/sleep role alert
  const audioRefsMap        = useRef<Record<string, HTMLAudioElement>>({}); // pre-loaded audio pool
  const gamePhaseRef        = useRef("lobby");                       // sync ref — always current phase
  const [isAudioEnabled, setIsAudioEnabled] = useState(true); // always ON — no manual toggle
  const isAudioEnabledRef   = useRef(true);
  isAudioEnabledRef.current = isAudioEnabled;

  // Online Mode: Silent Night UI — only morning/global cues play. All night
  // role audio (sleep/mafia/investigator/protector) is intentionally stripped
  // so the per-role on-screen UI (active = action panel, others = suspense)
  // is the only signal during night phases.
  const PHASE_AUDIO: Record<string, string> = {
    day_discussion: "/sounds/day.mp3",
  };

  const stopCurrentAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
  }, []);

  const playPhaseAudio = useCallback((_phase: string) => {}, []);

  // ── Helper: stop a single audio ref in-place ────────────────────────────
  const stopRef = useCallback((ref: React.MutableRefObject<HTMLAudioElement | null>) => {
    if (ref.current) {
      ref.current.pause();
      ref.current.currentTime = 0;
    }
  }, []);

  // ── Ambient layer — night.mp3 / day.mp3 (background mood) ───────────────
  const playAmbient = useCallback((_src: string) => {}, []);

  // ── Alert layer — wake.mp3 / sleep.mp3 (role cues, higher priority) ─────
  const playAlert = useCallback((_src: string) => {}, []);

  // ── Audio + WakeLock initializer — must be called from a user-gesture ───
  const initAudioSystem = useCallback(() => {
    const ctx = getOrCreateGameAudioContext();
    if (ctx?.state === "suspended") {
      void ctx.resume();
    }
    // Request screen wake lock so the device stays awake during the game
    if ("wakeLock" in navigator && !wakeLockRef.current) {
      (navigator as unknown as { wakeLock: { request(t: string): Promise<WakeLockSentinel> } })
        .wakeLock.request("screen")
        .then((s) => { wakeLockRef.current = s; })
        .catch(() => {});
    }
    setIsAudioEnabled(true);
  }, []); // only uses stable refs + setState setter

  // ── Warm-up: play each cinematic sound at volume=0 for 100ms to unlock ──
  // Must be called from a real user gesture (Join / Create click)
  const warmUpAudio = useCallback(() => {
    const CINEMA_SRCS = [
      "/sounds/night.mp3",
      "/sounds/day.mp3",
      "/sounds/wake.mp3",
      "/sounds/sleep.mp3",
    ];
    for (const src of CINEMA_SRCS) {
      const audio = audioRefsMap.current[src];
      if (!audio) continue;
      audio.volume = 0;
      audio.currentTime = 0;
      const p = audio.play();
      if (p !== undefined) {
        p.then(() => {
          setTimeout(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 1;
          }, 100);
        }).catch(() => {});
      }
    }
  }, []); // uses only stable ref

  // ── Pre-load all 4 cinematic Audio objects once on mount ─────────────────
  useEffect(() => {
    const CINEMA_SRCS = [
      "/sounds/night.mp3",
      "/sounds/day.mp3",
      "/sounds/wake.mp3",
      "/sounds/sleep.mp3",
    ];
    for (const src of CINEMA_SRCS) {
      const audio = new Audio(src);
      audio.preload = "auto";
      audioRefsMap.current[src] = audio;
    }
  }, []);

  // ── Task 3: Persistence — re-init on first interaction after page refresh ─
  useEffect(() => {
    const reinit = () => initAudioSystem();
    document.addEventListener("click",      reinit, { once: true });
    document.addEventListener("touchstart", reinit, { once: true, passive: true });
    return () => {
      document.removeEventListener("click",      reinit);
      document.removeEventListener("touchstart", reinit);
    };
  }, [initAudioSystem]);

  // ── On mount: restore session from localStorage ──────────────────────────
  useEffect(() => {
    // Check URL for ?code= param (from QR scan) — takes priority when no session
    const urlParams  = new URLSearchParams(window.location.search);
    const codeFromUrl = urlParams.get("code");
    if (codeFromUrl) {
      window.history.replaceState({}, "", window.location.pathname); // clean URL immediately
    }

    const session = loadSession();
    if (!session) {
      if (codeFromUrl) {
        setInitialJoinCode(codeFromUrl);
        setScreen("join");
      } else {
        setScreen("menu");
      }
      return;
    }

    const uid = getOrCreateUserId();
    const socket = getSocket();

    // Wait until socket is connected before emitting
    const doRejoin = () => {
      socket.emit(
        "rejoinRoom",
        { code: session.code, userId: uid, name: session.myName },
        (res: any) => {
          if (res.error) {
            clearSession();
            setScreen("menu");
            return;
          }

          if (!res.started) {
            setLobby({ code: res.code, isHost: session.isHost, myName: session.myName, players: res.players });
            setScreen("lobby");
            return;
          }

          if (res.isHost) {
            setLobby({ code: res.code, isHost: true, myName: session.myName, players: [] });
            setGame({ code: res.code, players: res.players, myName: session.myName, wolfAllies: [] });
            setScreen("dashboard");
          } else {
            setLobby({ code: res.code, isHost: false, myName: session.myName, players: [] });
            setPlayerRole({ label: res.myRole.label, color: res.myRole.color, code: res.code, myName: session.myName, players: [], wolfAllies: [] });
            // Restore game phase and death state from server sync
            setGamePhase(res.activeGamePhase ?? "role_reveal");
            if (!res.isAlive || res.deathReason) {
              setMyDeathReason(res.deathReason ?? "executed");
            }
            setScreen("player-screen");
          }
        },
      );
    };

    if (socket.connected) {
      doRejoin();
    } else {
      socket.once("connect", doRejoin);
    }

    return () => { socket.off("connect", doRejoin); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Connection tracking + socket-level auto-reconnect ────────────────────
  useEffect(() => {
    const socket = getSocket();
    const uid    = getOrCreateUserId();

    const onConnect    = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    const onReconnect = () => {
      setIsConnected(true);
      const current = lobbyRef.current;
      if (!current) return;

      socket.emit(
        "rejoinRoom",
        { code: current.code, userId: uid, name: current.myName },
        (res:
          | { code: string; players: { socketId: string; name: string }[]; started: false }
          | { code: string; started: true; isHost: true;  players: AssignedPlayer[] }
          | { code: string; started: true; isHost: false; myRole: { label: string; color: string };
              activeGamePhase: string; myVote: string | null; isAlive: boolean;
              deathReason: "assassinated" | "executed" | null }
          | { error: string }
        ) => {
          if ("error" in res) { clearSession(); setLobby(null); setGame(null); setPlayerRole(null); setScreen("menu"); return; }
          if (!res.started) {
            setLobby((prev) => prev ? { ...prev, players: res.players } : prev);
            return;
          }
          if (res.isHost) {
            setGame({ code: res.code, players: res.players, myName: current.myName, wolfAllies: [] });
            setAlivePlayerNames(res.players.filter((p) => p.isAlive).map((p) => p.name));
            setScreen("dashboard");
          } else {
            setPlayerRole({ label: res.myRole.label, color: res.myRole.color, code: res.code, myName: current.myName, players: [], wolfAllies: [] });
            // Restore game phase and death state from server sync
            setGamePhase(res.activeGamePhase ?? "role_reveal");
            if (!res.isAlive || res.deathReason) {
              setMyDeathReason(res.deathReason ?? "executed");
            }
            setScreen("player-screen");
          }
        },
      );
    };

    const onPhaseUpdate = (phase: string) => {
      gamePhaseRef.current = phase; // sync immediately so onPlayTone can read it
      setGamePhase(phase);
      playPhaseAudio(phase);
      // At the start of a new night, clear stale day-phase state + trial state (Task 4)
      if (phase === "night_sleep") {
        setMorningResults(null);
        setVoteUpdate(null);
        setExecutionInfo(null);
        voteUpdateRef.current = null;
        setAccusedPlayer(null);
        setTrialState("none");
        accusedPlayerRef.current = null;
        trialStateRef.current    = "none";
      }
    };

    const onMorningResults = (payload: MorningResultsPayload) => {
      setMorningResults(payload);
      // Remove killed player from alive list immediately
      if (payload.killedPlayerName) {
        setAlivePlayerNames((prev) => prev.filter((n) => n !== payload.killedPlayerName));
        // If I was the one killed, record the death reason
        setPlayerRole((role) => {
          if (role && role.myName === payload.killedPlayerName) {
            setMyDeathReason("assassinated");
          }
          return role;
        });
      }
    };

    const onVoteUpdate = (payload: VoteUpdatePayload) => {
      setVoteUpdate(payload);
      voteUpdateRef.current = payload; // keep ref in sync for use in onExecutionResult
      // Sync alive list with server's authoritative list
      setAlivePlayerNames(payload.alivePlayerNames);
    };

    const onGameOver = (payload: GameOverPayload) => {
      setGameOver(payload);
    };

    const onAlivePlayersSync = ({ alivePlayerNames: names }: { alivePlayerNames: string[] }) => {
      setAlivePlayerNames(names);
    };

    const onPhaseTimer = ({ endsAt }: { endsAt: number }) => {
      setPhaseEndsAt(endsAt);
    };

    const onExecutionResult = ({ executedPlayerName, roleLabel, roleColor }: {
      executedPlayerName: string | null;
      roleLabel: string | null;
      roleColor: string | null;
    }) => {
      if (executedPlayerName) {
        setAlivePlayerNames((prev) => prev.filter((n) => n !== executedPlayerName));
        // Store for execution banner display (shown in day_discussion)
        setExecutionInfo({
          name:      executedPlayerName,
          roleLabel: roleLabel ?? "مجهول",
          roleColor: roleColor ?? "#555555",
        });
        // If I was the one executed, record the death reason
        setPlayerRole((role) => {
          if (role && role.myName === executedPlayerName) {
            setMyDeathReason("executed");
          }
          return role;
        });
        // Execution happened — clear trial state entirely
        setAccusedPlayer(null);
        setTrialState("none");
        accusedPlayerRef.current = null;
        trialStateRef.current    = "none";
      } else {
        // No execution — determine trial state based on vote results
        if (trialStateRef.current === "none") {
          // First round: find the top vote-getter (no tie) to set as accused
          const votes = voteUpdateRef.current?.votes ?? {};
          const tally: Record<string, number> = {};
          for (const t of Object.values(votes)) {
            if (t !== "SKIP_VOTE") tally[t] = (tally[t] ?? 0) + 1;
          }
          const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
          // Only accuse if there's a clear unique leader (no tie for first place)
          if (entries.length > 0 && (entries.length < 2 || entries[0][1] > entries[1][1])) {
            const accused = entries[0][0];
            setAccusedPlayer(accused);
            setTrialState("accused");
            accusedPlayerRef.current = accused;
            trialStateRef.current    = "accused";
          }
        } else if (trialStateRef.current === "revoting") {
          // Revote ended with no execution — player is pardoned, clear trial
          setAccusedPlayer(null);
          setTrialState("none");
          accusedPlayerRef.current = null;
          trialStateRef.current    = "none";
        }
      }
    };

    const onPlayTone = ({ type }: { type: string }) => {
      // Silent Night UI: night phase audio is fully stripped on every client.
      // Only the synchronized morning chime (day_discussion) is allowed —
      // it acts as the unified "wake up" alarm across all devices.
      // role_wake / role_sleep / global_phase(night) are intentional no-ops.
      if (type === "global_phase" && gamePhaseRef.current === "day_discussion") {
        stopRef(ambientRef); // ensure no leftover night ambient
        playAmbient("/sounds/day.mp3");
      }
    };

    const onGameAborted = ({ players: updatedPlayers }: { players: SocketPlayer[] }) => {
      // Reset all game state
      setGame(null);
      setPlayerRole(null);
      setGameOver(null);
      setMorningResults(null);
      setVoteUpdate(null);
      setAlivePlayerNames([]);
      setMyDeathReason(null);
      setExecutionInfo(null);
      setGamePhase("lobby");
      setPhaseEndsAt(null);
      // Reconstruct lobby state from current session so UI returns to lobby screen
      const session = loadSession();
      if (session) {
        setLobby({
          code:     session.code,
          isHost:   session.isHost,
          myName:   session.myName,
          players:  updatedPlayers,
        });
      }
      setScreen("lobby");
    };

    socket.on("connect",          onConnect);
    socket.on("disconnect",       onDisconnect);
    socket.on("reconnect",        onReconnect);
    socket.on("phaseUpdate",      onPhaseUpdate);
    socket.on("morningResults",   onMorningResults);
    socket.on("voteUpdate",       onVoteUpdate);
    socket.on("gameOver",         onGameOver);
    socket.on("alivePlayersSync", onAlivePlayersSync);
    socket.on("phaseTimer",       onPhaseTimer);
    socket.on("executionResult",  onExecutionResult);
    socket.on("gameAborted",      onGameAborted);
    socket.on("play_tone",        onPlayTone);
    return () => {
      socket.off("connect",          onConnect);
      socket.off("disconnect",       onDisconnect);
      socket.off("reconnect",        onReconnect);
      socket.off("phaseUpdate",      onPhaseUpdate);
      socket.off("morningResults",   onMorningResults);
      socket.off("voteUpdate",       onVoteUpdate);
      socket.off("gameOver",         onGameOver);
      socket.off("alivePlayersSync", onAlivePlayersSync);
      socket.off("phaseTimer",       onPhaseTimer);
      socket.off("executionResult",  onExecutionResult);
      socket.off("gameAborted",      onGameAborted);
      socket.off("play_tone",        onPlayTone);
    };
  }, [playPhaseAudio, playAmbient, playAlert, stopRef]);

  // ── Shared game-started handler ─────────────────────────────────────────
  const handleGameStarted = useCallback((payload: GameStartedPayload) => {
    isHostRef.current = payload.isHost;
    stopCurrentAudio();
    setGamePhase("role_reveal");
    if (payload.isHost) {
      setGame({
        code: payload.code,
        players: payload.players,
        myName: lobbyRef.current?.myName ?? "",
        wolfAllies: payload.wolfAllies ?? [],
      });
      // Seed alive list with ALL player names at game start
      setAlivePlayerNames(payload.players.map((p) => p.name));
      setScreen("dashboard");
    } else {
      const myName  = lobbyRef.current?.myName ?? "";
      const players = (lobbyRef.current?.players ?? [])
        .map((p) => p.name)
        .filter((n) => n !== myName);
      // Seed alive list with ALL player names at game start (include self)
      setAlivePlayerNames((lobbyRef.current?.players ?? []).map((p) => p.name));
      setPlayerRole({
        label:      payload.myRole.label,
        color:      payload.myRole.color,
        code:       payload.code,
        myName,
        players,
        wolfAllies: payload.wolfAllies ?? [],
      });
      setScreen("player-screen");
    }
  }, [stopCurrentAudio]);

  // ── Start trial (revote) for accused player ──────────────────────────────
  const handleStartTrialVote = useCallback(() => {
    if (!accusedPlayerRef.current || !game) return;
    setTrialState("revoting");
    trialStateRef.current = "revoting";
    getSocket().emit("startVoting", { code: game.code });
  }, [game]);

  // ── Explicit leave — emits to server + clears localStorage ──────────────
  const handleLeaveRoom = useCallback(() => {
    isHostRef.current = false;
    stopCurrentAudio();
    setGamePhase("lobby");
    const current = lobbyRef.current;
    const uid     = getOrCreateUserId();
    if (current) {
      getSocket().emit("leaveRoom", { code: current.code, userId: uid });
    }
    clearSession();
    setLobby(null); setGame(null); setPlayerRole(null);
    setMorningResults(null); setVoteUpdate(null); setGameOver(null);
    setAlivePlayerNames([]); setMyDeathReason(null); setExecutionInfo(null);
    setScreen("menu");
  }, [stopCurrentAudio]);

  // ── Create room ──────────────────────────────────────────────────────────
  const handleCreateName = useCallback((name: string) => {
    initAudioSystem(); // user-gesture: init AudioContext + wake lock
    warmUpAudio();     // pre-warm all 4 cinematic sounds at volume=0
    const uid    = getOrCreateUserId();
    const socket = getSocket();
    socket.emit("createRoom", { name, userId: uid }, (res: { code: string; players: { socketId: string; name: string }[] } | { error: string }) => {
      if ("error" in res) { setScreen("create-name"); return; }
      const newLobby: LobbyState = { code: res.code, isHost: true, myName: name, players: res.players };
      setLobby(newLobby);
      saveSession({ code: res.code, isHost: true, myName: name });
      setScreen("lobby");
    });
  }, []);

  // ── Join room ────────────────────────────────────────────────────────────
  const handleJoinRoom = useCallback((name: string, code: string, onError: (msg: string) => void) => {
    initAudioSystem(); // user-gesture: init AudioContext + wake lock
    warmUpAudio();     // pre-warm all 4 cinematic sounds at volume=0
    const uid    = getOrCreateUserId();
    const socket = getSocket();
    socket.emit(
      "joinRoom",
      { name, code, userId: uid },
      (res: any) => {
        if (res.error) { onError(res.error); return; }
        setInitialJoinCode("");
        saveSession({ code: res.code, isHost: false, myName: name });

        if (res.started) {
          // Mid-game rejoin: restore state and go straight to game screen
          setLobby({ code: res.code, isHost: res.isHost, myName: name, players: [] });
          if (res.isHost && res.players) {
            isHostRef.current = true;
            setGame({ code: res.code, players: res.players, myName: name, wolfAllies: [] });
            setAlivePlayerNames(res.players.filter((p: any) => p.isAlive).map((p: any) => p.name));
            setScreen("dashboard");
          } else if (!res.isHost && res.myRole) {
            isHostRef.current = false;
            setPlayerRole({ label: res.myRole.label, color: res.myRole.color, code: res.code, myName: name, players: [], wolfAllies: [] });
            setScreen("player-screen");
          }
          return;
        }

        // Normal pre-game join
        const newLobby: LobbyState = { code: res.code, isHost: false, myName: name, players: res.players };
        setLobby(newLobby);
        setScreen("lobby");
      },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const audioResumeOverlay = needsResume ? (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center cursor-pointer"
      style={{
        backgroundColor: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={() => {
        resumeGameAudioContext();
        const unlockCache = (cache: Record<string, HTMLAudioElement>) => {
          Object.values(cache).forEach((audio) => {
            if (audio instanceof HTMLAudioElement) {
              audio.muted = true;
              audio.play().then(() => {
                audio.pause();
                audio.muted = false;
              }).catch(() => {
                audio.muted = false;
              });
            }
          });
        };
        unlockCache(narratorAudioCacheRef.current);
        if (narratorActiveAudioRef.current) {
          narratorActiveAudioRef.current.play().catch(() => {});
        }
        const ctx = gameAudioContextRef.current;
        setNeedsResume(!!ctx && ctx.state === "suspended");
      }}
      role="button"
      aria-label="استئناف اللعب والصوت"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center gap-5 px-10 py-8 text-center max-w-sm"
      >
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 88,
            height: 88,
            backgroundColor: "rgba(211,47,47,0.15)",
            border: "1.5px solid rgba(211,47,47,0.35)",
            boxShadow: "0 0 40px rgba(211,47,47,0.2)",
          }}
        >
          <Volume2 size={40} color="#D32F2F" strokeWidth={1.6} />
        </div>
        <h2 className="text-2xl font-black text-white">اللعبة متوقفة مؤقتًا</h2>
        <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
          اضغط هنا لاستئناف اللعب والصوت
        </p>
      </motion.div>
    </div>
  ) : null;

  const wrapWithResumeOverlay = (node: ReactNode) => (
    <>
      {audioResumeOverlay}
      {node}
    </>
  );

  // ── Auth gate — no game screen is reachable until signed in ──────────────
  if (authLoading) {
    return wrapWithResumeOverlay(
      <div className="min-h-full w-full flex items-center justify-center" style={{ backgroundColor: "#000000" }}>
        <Loader2 size={32} className="animate-spin" style={{ color: "#D32F2F" }} />
      </div>
    );
  }
  // ── Top-level mode gate — shown before any game screen ───────────────────
  // Deferred auth: the dashboard (GameModeSelector) is public for everyone, and
  // gated actions (Council Mode, Shop) intercept guests into the AuthModal from
  // within GameModeSelector. A guest can never be inside a game mode — the
  // `!user` check also covers a stale "narrator" persisted from a prior session
  // or localStorage tampering.
  if (selectedMode === null || !user) {
    return wrapWithResumeOverlay(<GameModeSelector onSelect={setSelectedMode} />);
  }
  if (selectedMode === "narrator") {
    return wrapWithResumeOverlay(
      <NarratorMode onBack={() => { clearNarratorState(); setSelectedMode(null); }} />
    );
  }

  // ── Online Mode: all existing screen rendering below (untouched) ──────────
  const banner = <ConnectionBanner connected={isConnected} />;

  if (screen === "rejoining") {
    return wrapWithResumeOverlay(
      <RejoiningScreen onGiveUp={() => { clearSession(); setScreen("menu"); }} />
    );
  }

  // Game Over — shown on top of everything for both host and players
  if (gameOver && (screen === "dashboard" || screen === "player-screen")) {
    return wrapWithResumeOverlay(
      <GameOverScreen result={gameOver} isHost={screen === "dashboard"} onEnd={handleLeaveRoom} />
    );
  }

  if (screen === "dashboard" && game) {
    return wrapWithResumeOverlay(
      <>{banner}<HostDashboard game={game} activeGamePhase={gamePhase} morningResults={morningResults} voteUpdate={voteUpdate} alivePlayerNames={alivePlayerNames} phaseEndsAt={phaseEndsAt} executionInfo={executionInfo} accusedPlayer={accusedPlayer} trialState={trialState} onStartTrialVote={handleStartTrialVote} onLeave={handleLeaveRoom} /></>
    );
  }

  if (screen === "player-screen" && playerRole) {
    return wrapWithResumeOverlay(
      <>{banner}<PlayerScreen role={playerRole} gamePhase={gamePhase} morningResults={morningResults} voteUpdate={voteUpdate} alivePlayerNames={alivePlayerNames} phaseEndsAt={phaseEndsAt} myDeathReason={myDeathReason} executionInfo={executionInfo} trialState={trialState} accusedPlayer={accusedPlayer} onLeave={handleLeaveRoom} /></>
    );
  }

  if (screen === "lobby" && lobby) {
    return wrapWithResumeOverlay(
      <>{banner}<LobbyScreen lobby={lobby} onLeave={handleLeaveRoom} onGameStarted={handleGameStarted} /></>
    );
  }

  if (screen === "create-name") {
    return wrapWithResumeOverlay(
      <CreateNameScreen onBack={() => setScreen("menu")} onSubmit={handleCreateName} />
    );
  }

  if (screen === "join") {
    return wrapWithResumeOverlay(
      <JoinRoomScreen
        initialCode={initialJoinCode}
        onBack={() => { setInitialJoinCode(""); setScreen("menu"); }}
        onSubmit={handleJoinRoom}
      />
    );
  }

  return wrapWithResumeOverlay(
    <MainMenu onCreateRoom={() => setScreen("create-name")} onJoinRoom={() => setScreen("join")} onBack={() => setSelectedMode(null)} />
  );
}