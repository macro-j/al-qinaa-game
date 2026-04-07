import { useState, useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import {
  VenetianMask,
  Plus,
  LogIn,
  LogOut,
  Settings,
  Copy,
  Check,
  Volume2,
  VolumeX,
  ArrowRight,
  QrCode,
  Users,
  Shuffle,
  Eye,
  EyeOff,
  Moon,
  Sun,
  Shield,
  Search,
  Skull,
  Mic,
  Loader2,
  AlertCircle,
  Lock,
  Unlock,
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
  label: string;
  color: string;
  code: string;
  myName: string;
}

interface GameState {
  code:    string;
  players: AssignedPlayer[];
  myName:  string; // host's own display name — used to find their role card
}

type GameStartedPayload =
  | { isHost: true;  code: string; players: AssignedPlayer[] }
  | { isHost: false; code: string; myRole: { label: string; color: string } };

type PhaseKey = "night" | "mafia" | "investigator" | "protector" | "day";

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

// ─── Phase Actions ────────────────────────────────────────────────────────────

const PHASE_ACTIONS: { key: PhaseKey; label: string; sub: string; icon: React.ReactNode; accent: string }[] = [
  { key: "night",        label: "بدء الليل",         sub: "أطفئ الأنوار",   icon: <Moon   size={20} strokeWidth={1.8} />, accent: "#1A1A4A" },
  { key: "mafia",        label: "استيقاظ المافيا",   sub: "الولد والأكة",   icon: <Skull  size={20} strokeWidth={1.8} />, accent: "#4A0000" },
  { key: "investigator", label: "استيقاظ الشايب",    sub: "الكاشف يحقق",   icon: <Search size={20} strokeWidth={1.8} />, accent: "#4A3000" },
  { key: "protector",    label: "استيقاظ البنت",     sub: "الدرع تحمي",    icon: <Shield size={20} strokeWidth={1.8} />, accent: "#003366" },
  { key: "day",          label: "بدء النهار",         sub: "المداولة تبدأ", icon: <Sun    size={20} strokeWidth={1.8} />, accent: "#3A2000" },
];

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
        <VenetianMask size={20} color="#D32F2F" strokeWidth={1.5} />
        <span className="font-black text-lg" style={{ color: "#D32F2F", fontFamily: "serif" }}>
          {label ?? "قناع"}
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
      <VenetianMask size={70} color="#D32F2F" strokeWidth={1.3} />
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

function MainMenu({ onCreateRoom, onJoinRoom }: { onCreateRoom: () => void; onJoinRoom: () => void }) {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center px-6" style={ROOT_STYLE}>
      <div className="flex flex-col items-center gap-8 w-full max-w-sm">
        <div className="flex flex-col items-center gap-3">
          <VenetianMask size={80} color="#D32F2F" strokeWidth={1.5} />
          <h1 className="text-6xl font-black tracking-widest" style={{ color: "#D32F2F", fontFamily: "serif" }}>قناع</h1>
          <p className="text-sm text-center" style={{ color: "#9E9E9E" }}>المدينة تنام.. والقاتل يصحو</p>
        </div>
        <div className="flex flex-col gap-5 w-full">
          <button onClick={onCreateRoom} className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <Plus size={22} color="#D32F2F" strokeWidth={2.5} /><span>إنشاء غرفة</span>
          </button>
          <button onClick={onJoinRoom} className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <LogIn size={22} color="#D32F2F" strokeWidth={2.5} /><span>دخول لعبة</span>
          </button>
          <button className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <Settings size={22} color="#D32F2F" strokeWidth={2.5} /><span>إعدادات</span>
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
              className="w-full px-4 py-3 rounded-xl text-white text-base outline-none placeholder-neutral-600"
              style={{ backgroundColor: "#1A1A1A", border: "1px solid #333333", direction: "rtl" }}
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

function JoinRoomScreen({ onBack, onSubmit }: {
  onBack: () => void;
  onSubmit: (name: string, code: string, onError: (msg: string) => void) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
              backgroundColor: "#1A1A1A",
              borderColor: code.length > 0 ? "#D32F2F" : "#333333",
              color: "#FFFFFF",
              caretColor: "#D32F2F",
              direction: "ltr",
              letterSpacing: "1em",
              textAlign: "center",
              fontSize: "2rem",
              padding: "0.75rem 1.5rem",
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
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [closed, setClosed] = useState(false);
  const [starting, setStarting] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const canStart = lobby.isHost && players.length >= 5;

  useEffect(() => {
    const socket = getSocket();
    const onPlayersUpdated = ({ players: updated }: { players: SocketPlayer[] }) => setPlayers(updated);
    const onRoomClosed = () => setClosed(true);
    const onGameStartedEvt = (payload: GameStartedPayload) => onGameStarted(payload);

    socket.on("playersUpdated", onPlayersUpdated);
    socket.on("roomClosed", onRoomClosed);
    socket.on("gameStarted", onGameStartedEvt);
    return () => {
      socket.off("playersUpdated", onPlayersUpdated);
      socket.off("roomClosed", onRoomClosed);
      socket.off("gameStarted", onGameStartedEvt);
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

  const toggleAudio = useCallback(async () => {
    if (!audioEnabled) {
      try { audioCtxRef.current = new AudioContext(); await audioCtxRef.current.resume(); } catch {}
      try { if ("wakeLock" in navigator) wakeLockRef.current = await navigator.wakeLock.request("screen"); } catch {}
      setAudioEnabled(true);
    } else {
      try { await audioCtxRef.current?.close(); audioCtxRef.current = null; } catch {}
      try { await wakeLockRef.current?.release(); wakeLockRef.current = null; } catch {}
      setAudioEnabled(false);
    }
  }, [audioEnabled]);

  useEffect(() => () => {
    wakeLockRef.current?.release().catch(() => {});
    audioCtxRef.current?.close().catch(() => {});
  }, []);

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
          <div className="w-full aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 max-h-40"
            style={{ borderColor: "#333333" }}>
            <QrCode size={40} color="#333333" />
            <span className="text-xs" style={{ color: "#555555" }}>QR للانضمام</span>
          </div>
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
              style={{ backgroundColor: players.length >= 5 ? "#1B5E20" : "#4A0000", color: players.length >= 5 ? "#4CAF50" : "#D32F2F" }}>
              {players.length} / 5+
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
                يلزم {Math.max(0, 5 - players.length)} لاعب إضافي للبدء
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

        {/* Audio Toggle */}
        <button onClick={toggleAudio}
          className="flex flex-row-reverse items-center gap-3 w-full px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-200 hover:brightness-125"
          style={{
            backgroundColor: audioEnabled ? "#0D1F0D" : "#1A1A1A",
            borderColor:     audioEnabled ? "#4CAF50" : "#333333",
            color:           audioEnabled ? "#4CAF50" : "#9E9E9E",
          }}>
          {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span>{audioEnabled ? "الراوي الصوتي مفعّل — الشاشة ستبقى مضاءة" : "تفعيل الراوي الصوتي"}</span>
        </button>

        <LeaveButton onLeave={onLeave} />
        <Footer />
      </div>
    </div>
  );
}

// ─── Player Screen (Role Reveal) ──────────────────────────────────────────────

function PlayerScreen({ role, onLeave }: { role: MyRole; onLeave: () => void }) {
  const [revealed, setRevealed] = useState(false);

  const reveal  = useCallback(() => setRevealed(true),  []);
  const conceal = useCallback(() => setRevealed(false), []);

  return (
    <div className="min-h-screen w-full flex flex-col" style={ROOT_STYLE}>
      <div className="flex flex-col flex-1 w-full max-w-sm mx-auto px-4 py-6 gap-6">

        <TopBar />

        <div className="flex items-center justify-between px-1">
          <span className="text-sm font-semibold" style={{ color: "#9E9E9E" }}>{role.myName}</span>
          <span dir="ltr" className="text-xs px-2 py-0.5 rounded-full font-mono font-bold"
            style={{ backgroundColor: "#1A1A1A", color: "#D32F2F", border: "1px solid #D32F2F", direction: "ltr", unicodeBidi: "isolate" }}>
            #{role.code}
          </span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-6">
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

        <LeaveButton onLeave={onLeave} />
        <Footer />
      </div>
    </div>
  );
}

// ─── Host Dashboard ───────────────────────────────────────────────────────────

function HostDashboard({ game, onLeave }: { game: GameState; onLeave: () => void }) {
  const [rolesVisible, setRolesVisible] = useState(false);
  const [activePhase, setActivePhase] = useState<PhaseKey | null>(null);
  const [myRoleRevealed, setMyRoleRevealed] = useState(false);

  const myEntry = game.players.find((p) => p.name === game.myName);

  return (
    <div className="min-h-screen w-full flex flex-col" style={ROOT_STYLE}>
      <div className="flex flex-col flex-1 w-full max-w-sm mx-auto px-4 py-6 gap-5">

        <TopBar />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic size={16} color="#D32F2F" />
            <span className="font-bold text-white text-base">لوحة تحكم الراوي</span>
          </div>
          <span dir="ltr" className="text-xs px-2 py-0.5 rounded-full font-mono font-bold"
            style={{ backgroundColor: "#1A1A1A", color: "#D32F2F", border: "1px solid #D32F2F", direction: "ltr", unicodeBidi: "isolate" }}>
            #{game.code}
          </span>
        </div>

        {/* ── My Role Card (host's personal role, hidden by default) ── */}
        {myEntry && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>
              بطاقة قناعي
            </span>
            <div
              onPointerDown={() => setMyRoleRevealed(true)}
              onPointerUp={() => setMyRoleRevealed(false)}
              onPointerLeave={() => setMyRoleRevealed(false)}
              onPointerCancel={() => setMyRoleRevealed(false)}
              className="w-full rounded-xl border-2 flex items-center gap-4 px-4 py-4 select-none transition-all duration-300"
              style={{
                backgroundColor: myRoleRevealed ? "#0A0000" : "#111111",
                borderColor:     myRoleRevealed ? myEntry.roleColor : "#2A2A2A",
                boxShadow:       myRoleRevealed ? `0 0 24px ${myEntry.roleColor}33` : "none",
                cursor: "pointer",
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              {myRoleRevealed ? (
                <>
                  <VenetianMask size={36} color={myEntry.roleColor} strokeWidth={1.3} className="flex-shrink-0" />
                  <div className="flex flex-col items-end flex-1 min-w-0">
                    <span className="text-xs" style={{ color: "#666666" }}>قناعك</span>
                    <span className="text-lg font-black leading-tight text-right"
                      style={{ color: myEntry.roleColor, fontFamily: "serif" }}>
                      {myEntry.roleLabel}
                    </span>
                  </div>
                  <Unlock size={16} color="#555555" className="flex-shrink-0" />
                </>
              ) : (
                <>
                  <div className="relative flex-shrink-0">
                    <VenetianMask size={36} color="#2A2A2A" strokeWidth={1.3} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Lock size={14} color="#555555" />
                    </div>
                  </div>
                  <div className="flex flex-col items-end flex-1 min-w-0">
                    <span className="text-sm font-bold" style={{ color: "#444444" }}>قناعك مخفي</span>
                    <span className="text-xs" style={{ color: "#333333" }}>اضغط وامسك للكشف</span>
                  </div>
                  <Lock size={16} color="#333333" className="flex-shrink-0" />
                </>
              )}
            </div>
          </div>
        )}

        {/* Roster with eye toggle */}
        <div className="rounded-xl border flex flex-col overflow-hidden" style={{ backgroundColor: "#1A1A1A", borderColor: "#333333" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#2A2A2A" }}>
            <div className="flex items-center gap-2">
              <Users size={15} color="#D32F2F" />
              <span className="font-bold text-sm text-white">قائمة اللاعبين</span>
            </div>
            <button onClick={() => setRolesVisible((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                backgroundColor: rolesVisible ? "#3A0000" : "#222222",
                color:           rolesVisible ? "#FF6B6B" : "#9E9E9E",
                border: `1px solid ${rolesVisible ? "#D32F2F" : "#333333"}`,
              }}>
              {rolesVisible ? <Eye size={13} /> : <EyeOff size={13} />}
              <span>{rolesVisible ? "إخفاء الأدوار" : "إظهار الأدوار"}</span>
            </button>
          </div>

          <div className="flex flex-col max-h-64 overflow-y-auto">
            {game.players.map((player, idx) => (
              <div key={player.socketId} className="flex flex-row-reverse items-center gap-3 px-4 py-3"
                style={{ borderBottom: idx < game.players.length - 1 ? "1px solid #1E1E1E" : "none" }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: "#2A2A2A", color: "#9E9E9E" }}>{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-white text-sm font-semibold">{player.name}</span>
                  <div className="flex flex-row-reverse items-center gap-1.5 mt-0.5">
                    {rolesVisible ? (
                      <>
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: player.roleColor }} />
                        <span className="text-xs font-medium" style={{ color: player.roleColor }}>{player.roleLabel}</span>
                      </>
                    ) : (
                      <span className="text-xs tracking-widest font-mono" style={{ color: "#444444" }}>● ● ● ●</span>
                    )}
                  </div>
                </div>
                {rolesVisible && <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: player.roleColor }} />}
              </div>
            ))}
          </div>
        </div>

        {/* Phase Controls */}
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>التحكم في مراحل اللعبة</span>
          <div className="grid grid-cols-1 gap-2">
            {PHASE_ACTIONS.map((phase) => {
              const isActive = activePhase === phase.key;
              return (
                <button key={phase.key} onClick={() => setActivePhase(isActive ? null : phase.key)}
                  className="flex flex-row-reverse items-center gap-4 w-full px-4 py-3.5 rounded-xl border transition-all duration-200 active:scale-95"
                  style={{ backgroundColor: isActive ? phase.accent : "#1A1A1A", borderColor: isActive ? "#D32F2F" : "#2A2A2A" }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors duration-200"
                    style={{ backgroundColor: isActive ? "#D32F2F" : "#242424", color: isActive ? "#ffffff" : "#9E9E9E" }}>
                    {phase.icon}
                  </div>
                  <div className="flex flex-col items-end flex-1 min-w-0">
                    <span className="text-sm font-bold leading-tight" style={{ color: isActive ? "#ffffff" : "#CCCCCC" }}>{phase.label}</span>
                    <span className="text-xs mt-0.5" style={{ color: isActive ? "#FF8A80" : "#555555" }}>{phase.sub}</span>
                  </div>
                  {isActive && <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: "#D32F2F" }} />}
                </button>
              );
            })}
          </div>
        </div>

        {activePhase && (
          <div className="rounded-xl px-4 py-3 flex items-center gap-3 flex-row-reverse"
            style={{ backgroundColor: "#1A0000", border: "1px solid #D32F2F" }}>
            <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: "#D32F2F" }} />
            <span className="text-sm font-medium" style={{ color: "#FF8A80" }}>
              المرحلة النشطة: {PHASE_ACTIONS.find((p) => p.key === activePhase)?.label}
            </span>
          </div>
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

  // Always-fresh ref so async callbacks never read stale lobby
  const lobbyRef = useRef<LobbyState | null>(null);
  lobbyRef.current = lobby;

  // ── On mount: restore session from localStorage ──────────────────────────
  useEffect(() => {
    const session = loadSession();
    if (!session) { setScreen("menu"); return; }

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
          | { code: string; started: true; isHost: false; myRole: { label: string; color: string } }
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
            setGame({ code: res.code, players: res.players, myName: session.myName });
            setScreen("dashboard");
          } else {
            setLobby({ code: res.code, isHost: false, myName: session.myName, players: [] });
            setPlayerRole({ label: res.myRole.label, color: res.myRole.color, code: res.code, myName: session.myName });
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
          | { code: string; started: true; isHost: false; myRole: { label: string; color: string } }
          | { error: string }
        ) => {
          if ("error" in res) { clearSession(); setLobby(null); setGame(null); setPlayerRole(null); setScreen("menu"); return; }
          if (!res.started) {
            setLobby((prev) => prev ? { ...prev, players: res.players } : prev);
            return;
          }
          if (res.isHost) {
            setGame({ code: res.code, players: res.players, myName: current.myName });
            setScreen("dashboard");
          } else {
            setPlayerRole({ label: res.myRole.label, color: res.myRole.color, code: res.code, myName: current.myName });
            setScreen("player-screen");
          }
        },
      );
    };

    socket.on("connect",    onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("reconnect",  onReconnect);
    return () => {
      socket.off("connect",    onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("reconnect",  onReconnect);
    };
  }, []);

  // ── Shared game-started handler ─────────────────────────────────────────
  const handleGameStarted = useCallback((payload: GameStartedPayload) => {
    if (payload.isHost) {
      setGame({ code: payload.code, players: payload.players, myName: lobbyRef.current?.myName ?? "" });
      setScreen("dashboard");
    } else {
      setPlayerRole({
        label:  payload.myRole.label,
        color:  payload.myRole.color,
        code:   payload.code,
        myName: lobbyRef.current?.myName ?? "",
      });
      setScreen("player-screen");
    }
  }, []);

  // ── Explicit leave — emits to server + clears localStorage ──────────────
  const handleLeaveRoom = useCallback(() => {
    const current = lobbyRef.current;
    const uid     = getOrCreateUserId();
    if (current) {
      getSocket().emit("leaveRoom", { code: current.code, userId: uid });
    }
    clearSession();
    setLobby(null); setGame(null); setPlayerRole(null);
    setScreen("menu");
  }, []);

  // ── Create room ──────────────────────────────────────────────────────────
  const handleCreateName = useCallback((name: string) => {
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
    const uid    = getOrCreateUserId();
    const socket = getSocket();
    socket.emit(
      "joinRoom",
      { name, code, userId: uid },
      (res: { code: string; players: { socketId: string; name: string }[]; started: boolean } | { error: string }) => {
        if ("error" in res) { onError(res.error); return; }
        const newLobby: LobbyState = { code: res.code, isHost: false, myName: name, players: res.players };
        setLobby(newLobby);
        saveSession({ code: res.code, isHost: false, myName: name });
        setScreen("lobby");
      },
    );
  }, []);

  // ── Screen rendering ─────────────────────────────────────────────────────
  const banner = <ConnectionBanner connected={isConnected} />;

  if (screen === "rejoining") {
    return <RejoiningScreen onGiveUp={() => { clearSession(); setScreen("menu"); }} />;
  }

  if (screen === "dashboard" && game) {
    return <>{banner}<HostDashboard game={game} onLeave={handleLeaveRoom} /></>;
  }

  if (screen === "player-screen" && playerRole) {
    return <>{banner}<PlayerScreen role={playerRole} onLeave={handleLeaveRoom} /></>;
  }

  if (screen === "lobby" && lobby) {
    return <>{banner}<LobbyScreen lobby={lobby} onLeave={handleLeaveRoom} onGameStarted={handleGameStarted} /></>;
  }

  if (screen === "create-name") {
    return <CreateNameScreen onBack={() => setScreen("menu")} onSubmit={handleCreateName} />;
  }

  if (screen === "join") {
    return <JoinRoomScreen onBack={() => setScreen("menu")} onSubmit={handleJoinRoom} />;
  }

  return <MainMenu onCreateRoom={() => setScreen("create-name")} onJoinRoom={() => setScreen("join")} />;
}
