import type { CSSProperties, ReactNode } from "react";

type RtlEmojiProps = {
  text: ReactNode;
  emoji: string;
  className?: string;
  textClassName?: string;
  emojiClassName?: string;
  style?: CSSProperties;
  textStyle?: CSSProperties;
  emojiStyle?: CSSProperties;
  justify?: "start" | "center" | "end";
};

/** Arabic text + trailing emoji — flex isolation avoids Unicode Bidi flipping emoji position. */
export function RtlEmoji({
  text,
  emoji,
  className = "",
  textClassName = "",
  emojiClassName = "",
  style,
  textStyle,
  emojiStyle,
  justify = "center",
}: RtlEmojiProps) {
  const justifyClass =
    justify === "start" ? "justify-start" :
    justify === "end" ? "justify-end" :
    "justify-center";

  return (
    <span
      dir="rtl"
      className={`inline-flex items-center gap-1 ${justifyClass} ${className}`.trim()}
      style={style}>
      <span className={textClassName} style={textStyle}>{text}</span>
      <span className={emojiClassName} style={emojiStyle} aria-hidden>{emoji}</span>
    </span>
  );
}

/** Unified night notification — label, player name, and icon grouped tightly in the center (RTL). */
export function UnifiedNightBanner({
  label,
  playerName,
  icon,
}: {
  label: string;
  playerName: string;
  icon: string;
}) {
  return (
    <div
      dir="rtl"
      className="flex items-center justify-center gap-3 p-4 rounded-lg border w-full"
      style={{
        backgroundColor: "#2A0000",
        border: "2px solid rgba(211,47,47,0.8)",
        boxShadow: "0 0 28px rgba(211,47,47,0.28)",
      }}>
      <span className="text-sm font-semibold whitespace-nowrap" style={{ color: "#B0B0B0" }}>
        {label}
      </span>
      <span className="text-lg font-black text-white whitespace-nowrap">{playerName}</span>
      <span
        className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full text-lg"
        style={{ backgroundColor: "rgba(211,47,47,0.45)", border: "2px solid #D32F2F" }}
        aria-hidden>
        {icon}
      </span>
    </div>
  );
}
