import { useState, useEffect, useRef, useCallback } from "react";
import {
  VenetianMask,
  Plus,
  LogIn,
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
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Screen = "menu" | "lobby" | "dashboard";

type PhaseKey = "night" | "mafia" | "investigator" | "protector" | "day";

interface Player {
  id: number;
  name: string;
}

interface AssignedPlayer extends Player {
  roleLabel: string;
  roleColor: string;
}

interface GameState {
  players: AssignedPlayer[];
  roomCode: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLE_DEFS = [
  { key: "killer",       label: "قناع الولد",  sublabel: "الجلاد",    color: "#D32F2F" },
  { key: "silencer",     label: "قناع الأكة",  sublabel: "الكاتم",    color: "#B71C1C" },
  { key: "investigator", label: "قناع الشايب", sublabel: "الكاشف",    color: "#FF8F00" },
  { key: "protector",    label: "قناع البنت",  sublabel: "الدرع",     color: "#1565C0" },
  { key: "citizen",      label: "قناع الشعب",  sublabel: "المواطن",   color: "#424242" },
];

const PHASE_ACTIONS: { key: PhaseKey; label: string; sub: string; icon: React.ReactNode; accent: string }[] = [
  {
    key: "night",
    label: "بدء الليل",
    sub: "أطفئ الأنوار",
    icon: <Moon size={20} strokeWidth={1.8} />,
    accent: "#1A1A4A",
  },
  {
    key: "mafia",
    label: "استيقاظ المافيا",
    sub: "الولد والأكة",
    icon: <Skull size={20} strokeWidth={1.8} />,
    accent: "#4A0000",
  },
  {
    key: "investigator",
    label: "استيقاظ الشايب",
    sub: "الكاشف يحقق",
    icon: <Search size={20} strokeWidth={1.8} />,
    accent: "#4A3000",
  },
  {
    key: "protector",
    label: "استيقاظ البنت",
    sub: "الدرع تحمي",
    icon: <Shield size={20} strokeWidth={1.8} />,
    accent: "#003366",
  },
  {
    key: "day",
    label: "بدء النهار",
    sub: "المداولة تبدأ",
    icon: <Sun size={20} strokeWidth={1.8} />,
    accent: "#3A2000",
  },
];

const BASE_BUTTON =
  "flex flex-row-reverse items-center gap-4 w-full px-6 py-4 rounded-xl border font-bold text-white text-lg transition-all duration-200 hover:brightness-125 active:scale-95";

// ─── Role Distribution ────────────────────────────────────────────────────────

function distributeRoles(players: Player[]): AssignedPlayer[] | null {
  if (players.length < 5) return null;
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  return shuffled.map((p, i) => {
    const def =
      i === 0 ? ROLE_DEFS[0]
      : i === 1 ? ROLE_DEFS[1]
      : i === 2 ? ROLE_DEFS[2]
      : i === 3 ? ROLE_DEFS[3]
      : ROLE_DEFS[4];
    return { ...p, roleLabel: `${def.label} (${def.sublabel})`, roleColor: def.color };
  });
}

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const DUMMY_PLAYERS: Player[] = [
  { id: 1, name: "لاعب 1" },
  { id: 2, name: "لاعب 2" },
  { id: 3, name: "لاعب 3" },
];

// ─── Main Menu ────────────────────────────────────────────────────────────────

function MainMenu({ onCreateRoom }: { onCreateRoom: () => void }) {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-6"
      style={{ backgroundColor: "#000000", direction: "rtl" }}
    >
      <div className="flex flex-col items-center gap-8 w-full max-w-sm">
        <div className="flex flex-col items-center gap-3">
          <VenetianMask size={80} color="#D32F2F" strokeWidth={1.5} />
          <h1 className="text-6xl font-black tracking-widest" style={{ color: "#D32F2F", fontFamily: "serif" }}>
            قناع
          </h1>
          <p className="text-sm text-center" style={{ color: "#9E9E9E" }}>
            المدينة تنام.. والقاتل يصحو
          </p>
        </div>
        <div className="flex flex-col gap-5 w-full">
          <button onClick={onCreateRoom} className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <Plus size={22} color="#D32F2F" strokeWidth={2.5} />
            <span>إنشاء غرفة</span>
          </button>
          <button className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <LogIn size={22} color="#D32F2F" strokeWidth={2.5} />
            <span>دخول لعبة</span>
          </button>
          <button className={BASE_BUTTON} style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
            <Settings size={22} color="#D32F2F" strokeWidth={2.5} />
            <span>إعدادات</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Lobby Screen ─────────────────────────────────────────────────────────────

function LobbyScreen({
  roomCode,
  onBack,
  onStartGame,
}: {
  roomCode: string;
  onBack: () => void;
  onStartGame: (players: Player[]) => void;
}) {
  const [players, setPlayers] = useState<Player[]>(DUMMY_PLAYERS);
  const [copied, setCopied] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const canStart = players.length >= 5;

  const addDummyPlayer = useCallback(() => {
    setPlayers((prev) => [...prev, { id: prev.length + 1, name: `لاعب ${prev.length + 1}` }]);
  }, []);

  const copyCode = useCallback(async () => {
    try { await navigator.clipboard.writeText(roomCode); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomCode]);

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

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: "#000000", direction: "rtl" }}>
      <div className="flex flex-col flex-1 w-full max-w-sm mx-auto px-4 py-6 gap-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm transition-opacity hover:opacity-70" style={{ color: "#9E9E9E" }}>
            <ArrowRight size={16} /><span>رجوع</span>
          </button>
          <div className="flex items-center gap-2">
            <VenetianMask size={20} color="#D32F2F" strokeWidth={1.5} />
            <span className="font-black text-lg" style={{ color: "#D32F2F", fontFamily: "serif" }}>قناع</span>
          </div>
        </div>

        {/* Room Code Card */}
        <div className="rounded-xl border p-5 flex flex-col gap-4" style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#9E9E9E" }}>كود الغرفة</span>
            <button onClick={copyCode} className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70" style={{ color: copied ? "#4CAF50" : "#9E9E9E" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "تم النسخ" : "نسخ"}</span>
            </button>
          </div>
          <div className="flex items-center justify-center gap-3">
            {roomCode.split("").map((digit, i) => (
              <div key={i} className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl font-black border"
                style={{ backgroundColor: "#0D0D0D", borderColor: "#D32F2F", color: "#D32F2F", fontFamily: "monospace" }}>
                {digit}
              </div>
            ))}
          </div>
          <div className="w-full aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 max-h-44" style={{ borderColor: "#333333" }}>
            <QrCode size={48} color="#333333" />
            <span className="text-xs" style={{ color: "#555555" }}>QR للانضمام</span>
          </div>
          <div className="flex items-center justify-center gap-2 py-2 rounded-lg" style={{ backgroundColor: "#0D0D0D" }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: "#4CAF50" }} />
            <span className="text-xs" style={{ color: "#9E9E9E" }}>في انتظار اللاعبين...</span>
          </div>
        </div>

        {/* Players */}
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
          <div className="flex flex-col gap-2 max-h-36 overflow-y-auto">
            {players.map((player, idx) => (
              <div key={player.id} className="flex flex-row-reverse items-center gap-3 px-3 py-2 rounded-lg" style={{ backgroundColor: "#0D0D0D" }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: "#D32F2F", color: "#fff" }}>{idx + 1}</div>
                <span className="text-white text-sm font-medium">{player.name}</span>
              </div>
            ))}
          </div>
          <button onClick={addDummyPlayer} className="text-xs py-1.5 rounded-lg transition-opacity hover:opacity-70"
            style={{ color: "#555555", backgroundColor: "#111111" }}>
            + إضافة لاعب تجريبي
          </button>
        </div>

        {/* Start Button */}
        <button
          onClick={() => onStartGame(players)}
          disabled={!canStart}
          className="flex flex-row-reverse items-center justify-center gap-3 w-full px-6 py-4 rounded-xl border font-bold text-lg transition-all duration-200 active:scale-95"
          style={{
            backgroundColor: canStart ? "#D32F2F" : "#1A1A1A",
            borderColor: canStart ? "#D32F2F" : "#333333",
            color: canStart ? "#ffffff" : "#555555",
            cursor: canStart ? "pointer" : "not-allowed",
            opacity: canStart ? 1 : 0.6,
          }}
        >
          <Shuffle size={22} strokeWidth={2.5} />
          <span>ابدأ توزيع الأقنعة</span>
        </button>

        {!canStart && (
          <p className="text-center text-xs" style={{ color: "#555555" }}>
            يلزم {5 - players.length} لاعب{5 - players.length > 1 ? "ين" : ""} إضافي{5 - players.length > 1 ? "ين" : ""} للبدء
          </p>
        )}

        {/* Audio Toggle */}
        <button onClick={toggleAudio}
          className="flex flex-row-reverse items-center gap-3 w-full px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-200 hover:brightness-125"
          style={{
            backgroundColor: audioEnabled ? "#0D1F0D" : "#1A1A1A",
            borderColor: audioEnabled ? "#4CAF50" : "#333333",
            color: audioEnabled ? "#4CAF50" : "#9E9E9E",
          }}>
          {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span>{audioEnabled ? "الراوي الصوتي مفعّل — الشاشة ستبقى مضاءة" : "تفعيل الراوي الصوتي"}</span>
        </button>

        <p className="text-center text-xs pb-2" style={{ color: "#333333" }}>المدينة تنام.. والقاتل يصحو</p>
      </div>
    </div>
  );
}

// ─── Host Dashboard ───────────────────────────────────────────────────────────

function HostDashboard({
  game,
  onBack,
}: {
  game: GameState;
  onBack: () => void;
}) {
  const [rolesVisible, setRolesVisible] = useState(false);
  const [activePhase, setActivePhase] = useState<PhaseKey | null>(null);

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ backgroundColor: "#000000", direction: "rtl" }}>
      <div className="flex flex-col flex-1 w-full max-w-sm mx-auto px-4 py-6 gap-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 text-sm transition-opacity hover:opacity-70" style={{ color: "#9E9E9E" }}>
            <ArrowRight size={16} /><span>رجوع</span>
          </button>
          <div className="flex items-center gap-2">
            <VenetianMask size={20} color="#D32F2F" strokeWidth={1.5} />
            <span className="font-black text-lg" style={{ color: "#D32F2F", fontFamily: "serif" }}>قناع</span>
          </div>
        </div>

        {/* Dashboard Title + room code */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mic size={16} color="#D32F2F" />
              <span className="font-bold text-white text-base">لوحة تحكم الراوي</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold"
              style={{ backgroundColor: "#1A1A1A", color: "#D32F2F", border: "1px solid #D32F2F" }}>
              #{game.roomCode}
            </span>
          </div>
          <p className="text-xs" style={{ color: "#555555" }}>الغرفة جارية — {game.players.length} لاعبين</p>
        </div>

        {/* Player Roster */}
        <div className="rounded-xl border flex flex-col overflow-hidden" style={{ backgroundColor: "#1A1A1A", borderColor: "#333333" }}>
          {/* Roster header with eye toggle */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#2A2A2A" }}>
            <div className="flex items-center gap-2">
              <Users size={15} color="#D32F2F" />
              <span className="font-bold text-sm text-white">قائمة اللاعبين</span>
            </div>
            <button
              onClick={() => setRolesVisible((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all duration-200"
              style={{
                backgroundColor: rolesVisible ? "#3A0000" : "#222222",
                color: rolesVisible ? "#FF6B6B" : "#9E9E9E",
                border: `1px solid ${rolesVisible ? "#D32F2F" : "#333333"}`,
              }}
            >
              {rolesVisible ? <Eye size={13} /> : <EyeOff size={13} />}
              <span>{rolesVisible ? "إخفاء الأدوار" : "إظهار الأدوار"}</span>
            </button>
          </div>

          {/* Player rows */}
          <div className="flex flex-col divide-y" style={{ divideColor: "#1E1E1E" }}>
            {game.players.map((player, idx) => (
              <div
                key={player.id}
                className="flex flex-row-reverse items-center gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid #1E1E1E" }}
              >
                {/* Number badge */}
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: "#2A2A2A", color: "#9E9E9E" }}
                >
                  {idx + 1}
                </div>

                {/* Name + role */}
                <div className="flex-1 min-w-0">
                  <span className="text-white text-sm font-semibold">{player.name}</span>
                  <div className="flex flex-row-reverse items-center gap-1.5 mt-0.5">
                    {rolesVisible ? (
                      <>
                        <div
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: player.roleColor }}
                        />
                        <span className="text-xs font-medium" style={{ color: player.roleColor }}>
                          {player.roleLabel}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs tracking-widest font-mono" style={{ color: "#444444" }}>
                        ● ● ● ●
                      </span>
                    )}
                  </div>
                </div>

                {/* Role color bar */}
                {rolesVisible && (
                  <div
                    className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{ backgroundColor: player.roleColor }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Phase Controls */}
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest px-1" style={{ color: "#555555" }}>
            التحكم في مراحل اللعبة
          </span>

          <div className="grid grid-cols-1 gap-2">
            {PHASE_ACTIONS.map((phase) => {
              const isActive = activePhase === phase.key;
              return (
                <button
                  key={phase.key}
                  onClick={() => setActivePhase(isActive ? null : phase.key)}
                  className="flex flex-row-reverse items-center gap-4 w-full px-4 py-3.5 rounded-xl border transition-all duration-200 active:scale-95"
                  style={{
                    backgroundColor: isActive ? phase.accent : "#1A1A1A",
                    borderColor: isActive ? "#D32F2F" : "#2A2A2A",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors duration-200"
                    style={{
                      backgroundColor: isActive ? "#D32F2F" : "#242424",
                      color: isActive ? "#ffffff" : "#9E9E9E",
                    }}
                  >
                    {phase.icon}
                  </div>
                  <div className="flex flex-col items-end flex-1 min-w-0">
                    <span
                      className="text-sm font-bold leading-tight"
                      style={{ color: isActive ? "#ffffff" : "#CCCCCC" }}
                    >
                      {phase.label}
                    </span>
                    <span className="text-xs mt-0.5" style={{ color: isActive ? "#FF8A80" : "#555555" }}>
                      {phase.sub}
                    </span>
                  </div>
                  {isActive && (
                    <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: "#D32F2F" }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active phase banner */}
        {activePhase && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-3 flex-row-reverse"
            style={{ backgroundColor: "#1A0000", border: "1px solid #D32F2F" }}
          >
            <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ backgroundColor: "#D32F2F" }} />
            <span className="text-sm font-medium" style={{ color: "#FF8A80" }}>
              المرحلة النشطة: {PHASE_ACTIONS.find((p) => p.key === activePhase)?.label}
            </span>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs pb-2" style={{ color: "#333333" }}>
          المدينة تنام.. والقاتل يصحو
        </p>

      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [roomCode, setRoomCode] = useState("");
  const [game, setGame] = useState<GameState | null>(null);

  const handleCreateRoom = useCallback(() => {
    setRoomCode(generateRoomCode());
    setScreen("lobby");
  }, []);

  const handleStartGame = useCallback((players: Player[]) => {
    const assigned = distributeRoles(players);
    if (!assigned) return;
    setGame({ players: assigned, roomCode });
    setScreen("dashboard");
  }, [roomCode]);

  const handleBack = useCallback(() => {
    setScreen("menu");
    setRoomCode("");
    setGame(null);
  }, []);

  const handleBackToLobby = useCallback(() => {
    setScreen("lobby");
    setGame(null);
  }, []);

  if (screen === "dashboard" && game) {
    return <HostDashboard game={game} onBack={handleBackToLobby} />;
  }

  if (screen === "lobby") {
    return <LobbyScreen roomCode={roomCode} onBack={handleBack} onStartGame={handleStartGame} />;
  }

  return <MainMenu onCreateRoom={handleCreateRoom} />;
}
