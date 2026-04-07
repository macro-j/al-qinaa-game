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
} from "lucide-react";

type Screen = "menu" | "lobby";

interface Player {
  id: number;
  name: string;
}

interface RoleSet {
  killer: Player;
  silencer: Player;
  investigator: Player;
  protector: Player;
  citizens: Player[];
}

const ROLES = [
  { key: "killer",      label: "قناع الولد",   sublabel: "الجلاد",   color: "#D32F2F" },
  { key: "silencer",    label: "قناع الأكة",   sublabel: "الكاتم",   color: "#B71C1C" },
  { key: "investigator",label: "قناع الشايب",  sublabel: "الكاشف",   color: "#FF8F00" },
  { key: "protector",   label: "قناع البنت",   sublabel: "الدرع",    color: "#1565C0" },
  { key: "citizens",    label: "قناع الشعب",   sublabel: "المواطنين",color: "#424242" },
];

function generateRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function distributeRoles(players: Player[]): RoleSet | null {
  if (players.length < 5) return null;
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  return {
    killer:       shuffled[0],
    silencer:     shuffled[1],
    investigator: shuffled[2],
    protector:    shuffled[3],
    citizens:     shuffled.slice(4),
  };
}

const DUMMY_PLAYERS: Player[] = [
  { id: 1, name: "لاعب 1" },
  { id: 2, name: "لاعب 2" },
  { id: 3, name: "لاعب 3" },
];

const BASE_BUTTON =
  "flex flex-row-reverse items-center gap-4 w-full px-6 py-4 rounded-xl border font-bold text-white text-lg transition-all duration-200 hover:brightness-125 active:scale-95";

function MainMenu({ onCreateRoom }: { onCreateRoom: () => void }) {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-6"
      style={{ backgroundColor: "#000000", direction: "rtl" }}
    >
      <div className="flex flex-col items-center gap-8 w-full max-w-sm">
        <div className="flex flex-col items-center gap-3">
          <VenetianMask size={80} color="#D32F2F" strokeWidth={1.5} />
          <h1
            className="text-6xl font-black tracking-widest"
            style={{ color: "#D32F2F", fontFamily: "serif" }}
          >
            قناع
          </h1>
          <p className="text-sm text-center" style={{ color: "#9E9E9E" }}>
            المدينة تنام.. والقاتل يصحو
          </p>
        </div>

        <div className="flex flex-col gap-5 w-full">
          <button
            onClick={onCreateRoom}
            className={BASE_BUTTON}
            style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}
          >
            <Plus size={22} color="#D32F2F" strokeWidth={2.5} />
            <span>إنشاء غرفة</span>
          </button>

          <button
            className={BASE_BUTTON}
            style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}
          >
            <LogIn size={22} color="#D32F2F" strokeWidth={2.5} />
            <span>دخول لعبة</span>
          </button>

          <button
            className={BASE_BUTTON}
            style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}
          >
            <Settings size={22} color="#D32F2F" strokeWidth={2.5} />
            <span>إعدادات</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function LobbyScreen({
  roomCode,
  onBack,
}: {
  roomCode: string;
  onBack: () => void;
}) {
  const [players, setPlayers] = useState<Player[]>(DUMMY_PLAYERS);
  const [copied, setCopied] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [rolesDistributed, setRolesDistributed] = useState<RoleSet | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const canStart = players.length >= 5;

  const addDummyPlayer = useCallback(() => {
    setPlayers((prev) => [
      ...prev,
      { id: prev.length + 1, name: `لاعب ${prev.length + 1}` },
    ]);
  }, []);

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [roomCode]);

  const toggleAudio = useCallback(async () => {
    if (!audioEnabled) {
      try {
        audioCtxRef.current = new AudioContext();
        await audioCtxRef.current.resume();
      } catch {
      }
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {
      }
      setAudioEnabled(true);
    } else {
      try {
        await audioCtxRef.current?.close();
        audioCtxRef.current = null;
      } catch {
      }
      try {
        await wakeLockRef.current?.release();
        wakeLockRef.current = null;
      } catch {
      }
      setAudioEnabled(false);
    }
  }, [audioEnabled]);

  useEffect(() => {
    return () => {
      wakeLockRef.current?.release().catch(() => {});
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const handleDistribute = useCallback(() => {
    const result = distributeRoles(players);
    if (result) setRolesDistributed(result);
  }, [players]);

  return (
    <div
      className="min-h-screen w-full flex flex-col"
      style={{ backgroundColor: "#000000", direction: "rtl" }}
    >
      <div className="flex flex-col flex-1 w-full max-w-sm mx-auto px-4 py-6 gap-5">

        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
            style={{ color: "#9E9E9E" }}
          >
            <ArrowRight size={16} />
            <span>رجوع</span>
          </button>
          <div className="flex items-center gap-2">
            <VenetianMask size={20} color="#D32F2F" strokeWidth={1.5} />
            <span className="font-black text-lg" style={{ color: "#D32F2F", fontFamily: "serif" }}>
              قناع
            </span>
          </div>
        </div>

        <div
          className="rounded-xl border p-5 flex flex-col gap-4"
          style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#9E9E9E" }}>
              كود الغرفة
            </span>
            <button
              onClick={copyCode}
              className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
              style={{ color: copied ? "#4CAF50" : "#9E9E9E" }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "تم النسخ" : "نسخ"}</span>
            </button>
          </div>

          <div className="flex items-center justify-center gap-3">
            {roomCode.split("").map((digit, i) => (
              <div
                key={i}
                className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl font-black border"
                style={{
                  backgroundColor: "#0D0D0D",
                  borderColor: "#D32F2F",
                  color: "#D32F2F",
                  fontFamily: "monospace",
                }}
              >
                {digit}
              </div>
            ))}
          </div>

          <div
            className="w-full aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 max-h-44"
            style={{ borderColor: "#333333" }}
          >
            <QrCode size={48} color="#333333" />
            <span className="text-xs" style={{ color: "#555555" }}>
              QR للانضمام
            </span>
          </div>

          <div
            className="flex items-center justify-center gap-2 py-2 rounded-lg"
            style={{ backgroundColor: "#0D0D0D" }}
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: "#4CAF50" }}
            />
            <span className="text-xs" style={{ color: "#9E9E9E" }}>
              في انتظار اللاعبين...
            </span>
          </div>
        </div>

        <div
          className="rounded-xl border p-4 flex flex-col gap-3"
          style={{ backgroundColor: "#1A1A1A", borderColor: "#333333" }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={16} color="#D32F2F" />
              <span className="font-bold text-sm text-white">اللاعبون</span>
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-bold"
              style={{
                backgroundColor: players.length >= 5 ? "#1B5E20" : "#4A0000",
                color: players.length >= 5 ? "#4CAF50" : "#D32F2F",
              }}
            >
              {players.length} / 5+
            </span>
          </div>

          <div className="flex flex-col gap-2 max-h-36 overflow-y-auto">
            {players.map((player, idx) => (
              <div
                key={player.id}
                className="flex flex-row-reverse items-center gap-3 px-3 py-2 rounded-lg"
                style={{ backgroundColor: "#0D0D0D" }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: "#D32F2F", color: "#fff" }}
                >
                  {idx + 1}
                </div>
                <span className="text-white text-sm font-medium">{player.name}</span>
              </div>
            ))}
          </div>

          <button
            onClick={addDummyPlayer}
            className="text-xs py-1.5 rounded-lg transition-opacity hover:opacity-70"
            style={{ color: "#555555", backgroundColor: "#111111" }}
          >
            + إضافة لاعب تجريبي
          </button>
        </div>

        {rolesDistributed && (
          <div
            className="rounded-xl border p-4 flex flex-col gap-3"
            style={{ backgroundColor: "#1A1A1A", borderColor: "#D32F2F" }}
          >
            <span className="font-bold text-sm" style={{ color: "#D32F2F" }}>
              توزيع الأقنعة
            </span>
            {ROLES.map((role) => {
              const val = rolesDistributed[role.key as keyof RoleSet];
              const assignees = Array.isArray(val) ? val : [val];
              return (
                <div key={role.key} className="flex flex-row-reverse items-start gap-3">
                  <div
                    className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ backgroundColor: role.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-row-reverse">
                      <span className="text-white text-sm font-bold">{role.label}</span>
                      <span className="text-xs" style={{ color: role.color }}>
                        ({role.sublabel})
                      </span>
                    </div>
                    <span className="text-xs" style={{ color: "#9E9E9E" }}>
                      {assignees.map((p) => (p as Player).name).join("، ")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button
          onClick={handleDistribute}
          disabled={!canStart}
          className="flex flex-row-reverse items-center justify-center gap-3 w-full px-6 py-4 rounded-xl border font-bold text-lg transition-all duration-200"
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
            يلزم {5 - players.length} لاعب{players.length < 4 ? "ين" : ""} إضافي{players.length < 4 ? "ين" : ""} للبدء
          </p>
        )}

        <button
          onClick={toggleAudio}
          className="flex flex-row-reverse items-center gap-3 w-full px-4 py-3 rounded-xl border text-sm font-medium transition-all duration-200 hover:brightness-125"
          style={{
            backgroundColor: audioEnabled ? "#0D1F0D" : "#1A1A1A",
            borderColor: audioEnabled ? "#4CAF50" : "#333333",
            color: audioEnabled ? "#4CAF50" : "#9E9E9E",
          }}
        >
          {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span>
            {audioEnabled ? "الراوي الصوتي مفعّل — الشاشة ستبقى مضاءة" : "تفعيل الراوي الصوتي"}
          </span>
        </button>

        <p className="text-center text-xs pb-2" style={{ color: "#333333" }}>
          المدينة تنام.. والقاتل يصحو
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [roomCode, setRoomCode] = useState("");

  const handleCreateRoom = useCallback(() => {
    setRoomCode(generateRoomCode());
    setScreen("lobby");
  }, []);

  const handleBack = useCallback(() => {
    setScreen("menu");
    setRoomCode("");
  }, []);

  if (screen === "lobby") {
    return <LobbyScreen roomCode={roomCode} onBack={handleBack} />;
  }

  return <MainMenu onCreateRoom={handleCreateRoom} />;
}
