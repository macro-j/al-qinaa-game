import { useState } from "react";
import { VenetianMask, Lock, Unlock } from "lucide-react";
import { ROLE_META, getRoleName } from "../lib/roles";
import { playSfx } from "../lib/sfx";

/**
 * Catalog clone of the in-game "Introductory Night" (الليلة التعريفية) reveal
 * card. Front = hidden mask mystery, back = the revealed role + its ability.
 * The CSS, structure, slots, and copy mirror the in-game card in App.tsx
 * exactly (de-personalized — no player name) so the Shop and Guide share one
 * visual identity with the game. All role text comes from ROLE_META (single
 * source of truth); nothing is authored here.
 */
export function RoleRevealCard({ roleKey, height = 320 }: { roleKey: string; height?: number }) {
  const [flipped, setFlipped] = useState(false);
  const meta = ROLE_META[roleKey];
  if (!meta) return null;
  const name = getRoleName(roleKey);

  return (
    <div
      onClick={() => { setFlipped((f) => !f); playSfx("card_flip.mp3"); }}
      style={{ perspective: "900px", height, cursor: "pointer" }}
      className="w-full select-none">
      <div
        style={{
          width: "100%",
          height: "100%",
          transformStyle: "preserve-3d",
          position: "relative",
          transition: "transform 0.55s cubic-bezier(0.4,0,0.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
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
          <div style={{ height: 32, width: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Lock size={24} color="#666666" />
          </div>
          <div style={{ height: 112, width: 112, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <VenetianMask size={80} color="#2A2A2A" strokeWidth={1.2} />
          </div>
          <span style={{ color: "#444444", fontSize: 13, textAlign: "center" }}>اضغط لتكشف القناع</span>
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
          <span style={{ color: "#555555", fontSize: 18, fontWeight: 800, textAlign: "center" }}>قناعك هو</span>
          <div style={{ height: 32, width: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Unlock size={24} color="#4CAF50" />
          </div>
          <div style={{ height: 112, width: 112, display: "flex", alignItems: "center", justifyContent: "center", filter: `drop-shadow(0 0 20px ${meta.color}99)` }}>
            <VenetianMask size={80} color={meta.color} strokeWidth={1.2} />
          </div>
          <span style={{
            color: "#FFFFFF", fontSize: 28, fontWeight: 900,
            textAlign: "center", lineHeight: 1.2,
            textShadow: `0 0 24px ${meta.color}66`,
          }}>
            {name}
          </span>
          <div style={{
            width: "100%",
            backgroundColor: "rgba(0,0,0,0.45)",
            borderRadius: 10,
            padding: "10px 14px",
            border: `1px solid ${meta.color}22`,
          }}>
            <span style={{ color: "#888888", fontSize: 11, textAlign: "center", lineHeight: 1.7, display: "block", direction: "rtl" }}>
              {meta.desc}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
