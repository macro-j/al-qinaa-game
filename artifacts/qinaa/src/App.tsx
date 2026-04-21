import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = "menu" | "create-name" | "join" | "lobby" | "player-screen" | "dashboard" | "rejoining";

interface SocketPlayer {
  socketId: string;
  name: string;
}

interface AssignedPlayer extends SocketPlayer {
  roleLabel: string;
  roleColor: string;
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

const ROOT_STYLE: React.CSSProperties = { backgroundColor: "#000000" };

function TopBar({ onBack, label }: { onBack?: () => void; label?: string }) {
  return (
    <div className="flex items-center justify-between">
      {onBack ? (
        <button onClick={onBack} className="flex items-center gap-1 text-sm transition-opacity hover:opacity-70" style={{ color: "#9E9E9E" }}>
          <ArrowRight size={16} /><span>رجوع</span>
        </button>
      ) : <div />}
      <div className="flex items-center gap-2">
        <img src="/mask-logo.png" alt="" style={{ width: 44, height: 44, objectFit: "contain" }} />
        <span className="font-black text-lg" style={{ color: "#D32F2F", fontFamily: "serif" }}>
          {label ?? "القناع"}
        </span>
      </div>
    </div>
  );
}

function Footer() {
  return <p className="text-center text-xs pb-2" style={{ color: "#333333" }}>المدينة تنام.. والقاتل يصحو</p>;
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
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-6 px-6" style={ROOT_STYLE}>
      <img src="/mask-logo.png" alt="القناع" style={{ width: 110, height: 110, objectFit: "contain" }} />
      <div className="flex flex-col items-center gap-2">
        <Loader2 size={28} color="#D32F2F" className="animate-spin" />
        <p className="text-white font-bold text-lg">جاري استئناف الجلسة...</p>
        <p className="text-xs" style={{ color: "#555555" }}>نحاول إعادتك إلى الغرفة</p>
      </div>
      <button onClick={onGiveUp} className="text-xs underline" style={{ color: "#555555" }}>
        بدء من جديد
      </button>
      <p className="text-xs" style={{ color: "#333333" }}>المدينة تنام.. والقاتل يصحو</p>
    </div>
  );
}

// ─── Main Menu ────────────────────────────────────────────────────────────────

const GUIDE_ROLES = [
  { label: "الولد",   color: "#D32F2F", desc: "القاتل — يختار ضحية كل ليلة ويحاول البقاء مجهولاً." },
  { label: "الإكة",  color: "#B71C1C", desc: "الكاتم — يسكت لاعباً ويمنعه من الكلام صباحاً." },
  { label: "الشايب", color: "#FF8F00", desc: "العرّاف — يكشف هوية لاعب كل ليلة (مافيا أم بريء)." },
  { label: "البنت",  color: "#1565C0", desc: "الحارس — يحمي لاعباً من القتل تلك الليلة." },
];

function MainMenu({ onCreateRoom, onJoinRoom }: { onCreateRoom: () => void; onJoinRoom: () => void }) {
  const [showGuide, setShowGuide] = useState(false);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center px-6" style={ROOT_STYLE}>
      <div className="flex flex-col items-center gap-8 w-full max-w-sm">
        <div className="flex flex-col items-center gap-3">
          <img src="/mask-logo.png" alt="القناع" style={{ width: 210, height: 210, objectFit: "contain" }} />
          <h1 className="text-6xl font-black tracking-widest" style={{ color: "#D32F2F", fontFamily: "serif" }}>القناع</h1>
          <p className="text-sm text-center" style={{ color: "#9E9E9E" }}>المدينة تنام.. والقاتل يصحو</p>
        </div>
        <div className="flex flex-col gap-5 w-full">
          <button onClick={onCreateRoom} className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <Plus size={22} color="#D32F2F" strokeWidth={2.5} /><span>إنشاء غرفة</span>
          </button>
          <button onClick={onJoinRoom} className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <LogIn size={22} color="#D32F2F" strokeWidth={2.5} /><span>دخول لعبة</span>
          </button>
          <button onClick={() => setShowGuide(true)} className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <BookOpen size={22} color="#D32F2F" strokeWidth={2.5} /><span>شرح اللعبة</span>
          </button>
        </div>
      </div>

      {/* ── Game Guide Modal ── */}
      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ backgroundColor: "rgba(0,0,0,0.88)" }}
          onClick={() => setShowGuide(false)}>
          <div
            className="w-full max-w-sm rounded-2xl flex flex-col gap-5 p-6 overflow-y-auto max-h-[90vh]"
            style={{ backgroundColor: "#111111", border: "1px solid #2A2A2A" }}
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between">
              <button onClick={() => setShowGuide(false)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                style={{ backgroundColor: "#1A1A1A", color: "#555555", border: "1px solid #333333" }}>
                إغلاق
              </button>
              <div className="flex items-center gap-2">
                <BookOpen size={18} color="#D32F2F" />
                <span className="font-black text-base" style={{ color: "#ffffff" }}>شرح اللعبة</span>
              </div>
            </div>

            {/* Objective */}
            <div className="rounded-xl px-4 py-4 flex flex-col gap-2"
              style={{ backgroundColor: "#0D0D0D", border: "1px solid #222222" }}>
              <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#D32F2F" }}>الهدف</span>
              <p className="text-sm leading-relaxed text-right" style={{ color: "#CCCCCC" }}>
                أنت في قرية غامضة. إذا كنت من الشعب، هدفك هو كشف المافيا والتصويت ضدهم للنجاة. إذا كنت من المافيا (الولد أو الإكة)، هدفك هو تصفية الشعب والسيطرة على القرية دون أن ينكشف أمرك.
              </p>
            </div>

            {/* Role cards */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#555555" }}>الأدوار الرئيسية</span>
              {GUIDE_ROLES.map((r) => (
                <div key={r.label} className="flex flex-row-reverse items-start gap-3 rounded-xl px-4 py-3"
                  style={{ backgroundColor: "#0D0D0D", border: `1px solid ${r.color}22` }}>
                  <VenetianMask size={20} color={r.color} strokeWidth={1.5} className="flex-shrink-0 mt-0.5" />
                  <div className="flex flex-col items-end gap-0.5 flex-1">
                    <span className="font-black text-sm" style={{ color: r.color, fontFamily: "serif" }}>{r.label}</span>
                    <span className="text-xs leading-relaxed text-right" style={{ color: "#999999" }}>{r.desc}</span>
                  </div>
                </div>
              ))}
              <div className="flex flex-row-reverse items-start gap-3 rounded-xl px-4 py-3"
                style={{ backgroundColor: "#0D0D0D", border: "1px solid #33333322" }}>
                <VenetianMask size={20} color="#555555" strokeWidth={1.5} className="flex-shrink-0 mt-0.5" />
                <div className="flex flex-col items-end gap-0.5 flex-1">
                  <span className="font-black text-sm" style={{ color: "#777777", fontFamily: "serif" }}>المواطن</span>
                  <span className="text-xs leading-relaxed text-right" style={{ color: "#555555" }}>من الشعب — لا سلطة ليلية، يعتمد على النقاش والتصويت لكشف المافيا.</span>
                </div>
              </div>
            </div>

            <p className="text-xs text-center" style={{ color: "#333333" }}>اضغط خارج النافذة للإغلاق</p>
          </div>
        </div>
      )}
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
    <div className="min-h-screen w-full flex flex-col items-center justify-center px-6" style={ROOT_STYLE}>
      <div className="flex flex-col gap-6 w-full max-w-sm">
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
            className="w-full rounded-xl font-black font-mono outline-none border-2"
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
      <div className="min-h-screen w-full flex flex-col items-center justify-center px-6 gap-4" style={ROOT_STYLE}>
        <Skull size={48} color="#D32F2F" />
        <p className="text-white font-bold text-xl">تم طردك من الغرفة</p>
        <p className="text-sm text-center" style={{ color: "#9E9E9E" }}>قرر المضيف إزالتك من هذه الجلسة</p>
        <button onClick={onLeave} className="mt-4 px-6 py-3 rounded-xl font-bold text-white" style={{ backgroundColor: "#D32F2F" }}>
          العودة للقائمة الرئيسية
        </button>
      </div>
    );
  }

  if (closed) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center px-6 gap-4" style={ROOT_STYLE}>
        <AlertCircle size={48} color="#D32F2F" />
        <p className="text-white font-bold text-lg">تم إغلاق الغرفة</p>
        <p className="text-sm" style={{ color: "#9E9E9E" }}>غادر المضيف أو انتهت الجلسة</p>
        <button onClick={onLeave} className="mt-4 px-6 py-3 rounded-xl font-bold text-white" style={{ backgroundColor: "#D32F2F" }}>
          العودة للقائمة الرئيسية
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col" style={ROOT_STYLE}>
      <div className="flex flex-col flex-1 w-full max-w-sm mx-auto px-4 py-6 gap-5">

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
            <button onClick={copyCode} className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
              style={{ color: copied ? "#4CAF50" : "#9E9E9E" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "تم النسخ" : "نسخ"}</span>
            </button>
          </div>
          <div
            dir="ltr"
            className="w-full rounded-xl border-2 font-black font-mono flex items-center justify-center"
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
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg transition-colors active:opacity-70"
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
                    className="flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0 transition-opacity active:opacity-60"
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

function PlayerScreen({ role, gamePhase, morningResults, voteUpdate, alivePlayerNames, phaseEndsAt, myDeathReason, executionInfo, onLeave }: {
  role: MyRole;
  gamePhase: string;
  morningResults: MorningResultsPayload | null;
  voteUpdate: VoteUpdatePayload | null;
  alivePlayerNames: string[];
  phaseEndsAt: number | null;
  myDeathReason: "assassinated" | "executed" | null;
  executionInfo: { name: string; roleLabel: string; roleColor: string } | null;
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
    <div className="min-h-screen w-full flex flex-col" style={ROOT_STYLE}>
      <div className="flex flex-col flex-1 w-full max-w-sm mx-auto px-4 py-6 gap-6">

        <TopBar />

        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold" style={{ color: "#9E9E9E" }}>{role.myName}</span>
          <Countdown endsAt={phaseEndsAt} />
        </div>

        {/* Dead player screen — overlays content when eliminated */}
        {alivePlayerNames.length > 0 && !alivePlayerNames.includes(role.myName) && (
          <DeadScreen myName={role.myName} deathReason={myDeathReason} />
        )}

        <div className="flex-1 flex flex-col items-center justify-center gap-6"
          style={{ display: alivePlayerNames.length > 0 && !alivePlayerNames.includes(role.myName) ? "none" : "flex" }}>
          <div
            onPointerDown={reveal}
            onPointerUp={conceal}
            onPointerLeave={conceal}
            onPointerCancel={conceal}
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
                    style={{ color: role.color, fontFamily: "serif", direction: "rtl" }}>
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
          </div>

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
            <p className="text-sm font-bold" style={{ color: "#8BC34A" }}>النهار بدأ — ناقش مع المدينة</p>
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
                    night_sleep:  "المدينة نائمة... الكل يغمض عيونه",
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
                  صوّتت ضد: <span style={{ color: "#FFFFFF" }}>{votedFor}</span>
                </p>
                <p className="text-xs text-center" style={{ color: "#555555" }}>في انتظار باقي اللاعبين...</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold tracking-widest uppercase" style={{ color: "#FF8F00" }}>التصويت</span>
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#FF8F00" }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "#CCCCCC" }}>من تعتقد أنه المجرم؟</p>
                <div className="flex flex-col gap-2">
                  {alivePlayerNames
                    .filter((n) => n !== role.myName)
                    .map((name) => {
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
                    <span className="text-sm font-semibold text-white">{name}</span>
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

// ─── Game Over Screen ─────────────────────────────────────────────────────────

// ── Countdown component ───────────────────────────────────────────────────────
function Countdown({ endsAt }: { endsAt: number | null }) {
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

  if (secs === null || secs <= 0) return null;
  return (
    <div className="flex items-center justify-center gap-1.5">
      <Timer size={12} style={{ color: "#555555" }} />
      <span className="text-xs font-mono font-bold tabular-nums" style={{ color: secs <= 5 ? "#D32F2F" : "#555555" }}>
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
    <div className="min-h-screen w-full flex flex-col items-center justify-center px-6 gap-8" style={ROOT_STYLE}>
      {/* Executed player banner */}
      {result.executedPlayerName && (
        <div className="w-full max-w-sm rounded-2xl flex flex-col items-center gap-1 py-3 px-4"
          style={{ backgroundColor: "#0D0000", border: "1px solid #D32F2F" }}>
          <span className="text-xs font-semibold tracking-widest" style={{ color: "#666666" }}>تم إعدام</span>
          <span className="text-lg font-black" style={{ color: "#FF6B6B" }}>{result.executedPlayerName}</span>
        </div>
      )}

      {/* Main result card */}
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <img
          src="/mask-logo.png"
          alt="القناع"
          style={{
            width: 160, height: 160,
            objectFit: "contain",
            filter: wolvesWon
              ? "drop-shadow(0 0 30px #D32F2F)"
              : "drop-shadow(0 0 30px #4CAF50)",
          }}
        />

        <div className="flex flex-col items-center gap-3 text-center">
          <span
            className="text-5xl font-black leading-tight"
            style={{ color: wolvesWon ? "#D32F2F" : "#4CAF50", fontFamily: "serif" }}>
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

      <p className="text-xs" style={{ color: "#333333" }}>المدينة تنام.. والقاتل يصحو</p>
    </div>
  );
}

// ─── Host Dashboard ───────────────────────────────────────────────────────────

function HostDashboard({ game, activeGamePhase, morningResults, voteUpdate, alivePlayerNames, phaseEndsAt, executionInfo, onLeave }: {
  game: GameState;
  activeGamePhase: string;
  morningResults: MorningResultsPayload | null;
  voteUpdate: VoteUpdatePayload | null;
  alivePlayerNames: string[];
  phaseEndsAt: number | null;
  executionInfo: { name: string; roleLabel: string; roleColor: string } | null;
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
    night_sleep:  "المدينة نائمة — الكل يغمض عيونه",
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
    <div className="min-h-screen w-full flex flex-col" style={ROOT_STYLE}>
      <div className="flex flex-col flex-1 w-full max-w-sm mx-auto px-4 py-6 gap-5">

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
        <Countdown endsAt={phaseEndsAt} />

        {/* ── My Role Card: big centered card only during role_reveal phase ── */}
        {myEntry && activeGamePhase === "role_reveal" && (
          <div className="flex flex-col gap-3">
            <div
              onPointerDown={() => setMyRoleRevealed(true)}
              onPointerUp={() => setMyRoleRevealed(false)}
              onPointerLeave={() => setMyRoleRevealed(false)}
              onPointerCancel={() => setMyRoleRevealed(false)}
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
                      style={{ color: myRoleColor, fontFamily: "serif", direction: "rtl" }}>
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
            </div>
            <p className="text-xs text-center px-4" style={{ color: "#333333" }}>
              {myRoleRevealed ? "ارفع إصبعك لإخفاء القناع مجدداً" : "اضغط مطولاً على البطاقة للكشف — سيختفي عند الرفع"}
            </p>
          </div>
        )}

        {/* ── My Role Card (compact, shown after role_reveal phase) ── */}
        {myEntry && activeGamePhase !== "role_reveal" && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>بطاقة قناعي</span>
            <div
              onPointerDown={() => setMyRoleRevealed(true)}
              onPointerUp={() => setMyRoleRevealed(false)}
              onPointerLeave={() => setMyRoleRevealed(false)}
              onPointerCancel={() => setMyRoleRevealed(false)}
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
                    <span className="text-base font-black leading-tight text-right" style={{ color: myRoleColor, fontFamily: "serif" }}>
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
            </div>
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
                    صوّتت ضد: <span style={{ color: "#fff" }}>{votedFor}</span>
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
                    <span className="text-sm font-semibold text-white">{name}</span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "#2A0000", color: "#D32F2F" }}>{count} أصوات</span>
                  </div>
                ))}
              </div>
            )}

            {/* Execute button */}
            <button onClick={handleTallyAndExecute}
              className="flex flex-row-reverse items-center justify-center gap-3 w-full px-5 py-4 rounded-xl font-bold text-base transition-all duration-200 active:scale-95"
              style={{ backgroundColor: "#D32F2F", color: "#fff", border: "1px solid #FF6B6B" }}>
              <Skull size={20} strokeWidth={2} />
              <span>إنهاء التصويت وإعدام المتهم</span>
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

        {/* ── HOST CONTROLS: day — next night (primary) + voting (secondary) ── */}
        {activeGamePhase === "day_discussion" && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>تحكم المضيف</span>
            {/* PRIMARY: start next night — host must tap this to advance */}
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
  // Authoritative alive player list — updated from server events, used by both host/player
  const [alivePlayerNames, setAlivePlayerNames] = useState<string[]>([]);
  const [phaseEndsAt, setPhaseEndsAt]           = useState<number | null>(null);

  // Always-fresh ref so async callbacks never read stale lobby
  const lobbyRef = useRef<LobbyState | null>(null);
  lobbyRef.current = lobby;

  // ── Audio + Wake Lock system (auto-initialized on join/create) ──────────
  const isHostRef           = useRef(false);
  const currentAudioRef     = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef         = useRef<AudioContext | null>(null);
  const wakeLockRef         = useRef<WakeLockSentinel | null>(null);
  const cinemaAudioRef      = useRef<HTMLAudioElement | null>(null); // currently-playing cinematic tone
  const audioRefsMap        = useRef<Record<string, HTMLAudioElement>>({}); // pre-loaded audio pool
  const gamePhaseRef        = useRef("lobby");                       // sync ref — always current phase
  const [isAudioEnabled, setIsAudioEnabled] = useState(true); // always ON — no manual toggle
  const isAudioEnabledRef   = useRef(true);
  isAudioEnabledRef.current = isAudioEnabled;

  const PHASE_AUDIO: Record<string, string> = {
    night_sleep:   "/sounds/sleep.mp3",
    night_wolf:    "/sounds/mafia.mp3",
    night_shadow:  "/sounds/mafia.mp3",
    night_seer:    "/sounds/investigator.mp3",
    night_guard:   "/sounds/protector.mp3",
    day_discussion: "/sounds/day.mp3",
  };

  const stopCurrentAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
  }, []);

  const playPhaseAudio = useCallback((phase: string) => {
    if (!isHostRef.current)           return;
    if (!isAudioEnabledRef.current)   return;
    const src = PHASE_AUDIO[phase];
    if (!src) return;
    stopCurrentAudio();
    const audio = new Audio(src);
    currentAudioRef.current = audio;
    audio.play().catch(() => {});
  }, [stopCurrentAudio]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cinematic MP3 playback — uses pre-loaded pool for zero-latency play ─
  const playCinemaAudio = useCallback((src: string) => {
    try {
      // Stop whatever cinematic sound is currently playing
      if (cinemaAudioRef.current) {
        cinemaAudioRef.current.pause();
        cinemaAudioRef.current.currentTime = 0;
      }
      // Look up the pre-loaded Audio object; fall back to a fresh one if missing
      const audio = audioRefsMap.current[src] ?? new Audio(src);
      audio.currentTime = 0;
      audio.volume = 1;
      cinemaAudioRef.current = audio;
      audio.play().catch(() => {});
    } catch { /* silently ignore */ }
  }, []);

  // ── Audio + WakeLock initializer — must be called from a user-gesture ───
  const initAudioSystem = useCallback(() => {
    // Create / resume Web Audio Context (required before any tone can play)
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    } catch {}
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
        (res:
          | { code: string; players: { socketId: string; name: string }[]; started: false }
          | { code: string; started: true; isHost: true;  players: AssignedPlayer[] }
          | { code: string; started: true; isHost: false; myRole: { label: string; color: string };
              activeGamePhase: string; myVote: string | null; isAlive: boolean;
              deathReason: "assassinated" | "executed" | null }
          | { error: string }
        ) => {
          if ("error" in res) {
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
      // At the start of a new night, clear stale day-phase state
      if (phase === "night_sleep") {
        setMorningResults(null);
        setVoteUpdate(null);
        setExecutionInfo(null);
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
      }
    };

    const onPlayTone = ({ type }: { type: string }) => {
      // gamePhaseRef.current is already updated by onPhaseUpdate (emitted just before play_tone)
      switch (type) {
        case "global_phase":
          // Distinguish night (village sleeps) from morning (sun rises)
          playCinemaAudio(
            gamePhaseRef.current === "day_discussion"
              ? "/sounds/day.mp3"
              : "/sounds/night.mp3"
          );
          break;
        case "role_wake":
          setTimeout(() => playCinemaAudio("/sounds/wake.mp3"),  2500);
          break;
        case "role_sleep":
          setTimeout(() => playCinemaAudio("/sounds/sleep.mp3"), 2500);
          break;
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
  }, [playPhaseAudio, playCinemaAudio]);

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
      (res:
        | { code: string; players: { socketId: string; name: string }[]; started: boolean }
        | { code: string; started: true; isHost: true;  players: AssignedPlayer[] }
        | { code: string; started: true; isHost: false; myRole: { label: string; color: string } }
        | { error: string }
      ) => {
        if ("error" in res) { onError(res.error); return; }
        setInitialJoinCode("");
        saveSession({ code: res.code, isHost: false, myName: name });

        if ("started" in res && res.started) {
          // Mid-game rejoin: restore state and go straight to game screen
          setLobby({ code: res.code, isHost: res.isHost, myName: name, players: [] });
          if (res.isHost && "players" in res) {
            isHostRef.current = true;
            setGame({ code: res.code, players: res.players, myName: name, wolfAllies: [] });
            setAlivePlayerNames(res.players.filter((p) => p.isAlive).map((p) => p.name));
            setScreen("dashboard");
          } else if (!res.isHost && "myRole" in res) {
            isHostRef.current = false;
            setPlayerRole({ label: res.myRole.label, color: res.myRole.color, code: res.code, myName: name, players: [], wolfAllies: [] });
            setScreen("player-screen");
          }
          return;
        }

        // Normal pre-game join
        const newLobby: LobbyState = { code: res.code, isHost: false, myName: name, players: (res as { players: { socketId: string; name: string }[] }).players };
        setLobby(newLobby);
        setScreen("lobby");
      },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Screen rendering ─────────────────────────────────────────────────────
  const banner = <ConnectionBanner connected={isConnected} />;

  if (screen === "rejoining") {
    return <RejoiningScreen onGiveUp={() => { clearSession(); setScreen("menu"); }} />;
  }

  // Game Over — shown on top of everything for both host and players
  if (gameOver && (screen === "dashboard" || screen === "player-screen")) {
    return <GameOverScreen result={gameOver} isHost={screen === "dashboard"} onEnd={handleLeaveRoom} />;
  }

  if (screen === "dashboard" && game) {
    return <>{banner}<HostDashboard game={game} activeGamePhase={gamePhase} morningResults={morningResults} voteUpdate={voteUpdate} alivePlayerNames={alivePlayerNames} phaseEndsAt={phaseEndsAt} executionInfo={executionInfo} onLeave={handleLeaveRoom} /></>;
  }

  if (screen === "player-screen" && playerRole) {
    return <>{banner}<PlayerScreen role={playerRole} gamePhase={gamePhase} morningResults={morningResults} voteUpdate={voteUpdate} alivePlayerNames={alivePlayerNames} phaseEndsAt={phaseEndsAt} myDeathReason={myDeathReason} executionInfo={executionInfo} onLeave={handleLeaveRoom} /></>;
  }

  if (screen === "lobby" && lobby) {
    return <>{banner}<LobbyScreen lobby={lobby} onLeave={handleLeaveRoom} onGameStarted={handleGameStarted} /></>;
  }

  if (screen === "create-name") {
    return <CreateNameScreen onBack={() => setScreen("menu")} onSubmit={handleCreateName} />;
  }

  if (screen === "join") {
    return <JoinRoomScreen
      initialCode={initialJoinCode}
      onBack={() => { setInitialJoinCode(""); setScreen("menu"); }}
      onSubmit={handleJoinRoom}
    />;
  }

  return <MainMenu onCreateRoom={() => setScreen("create-name")} onJoinRoom={() => setScreen("join")} />;
}
