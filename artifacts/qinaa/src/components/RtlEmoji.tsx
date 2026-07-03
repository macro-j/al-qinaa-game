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

/** Night banner: target name on the right, knife icon on the left (RTL). */
export function AssassinationPlanBanner({ targetName }: { targetName: string }) {
  return (
    <div
      dir="rtl"
      className="flex items-center gap-3 px-4 py-3 rounded-xl w-full"
      style={{
        backgroundColor: "#2A0000",
        border: "2px solid rgba(211,47,47,0.8)",
        boxShadow: "0 0 28px rgba(211,47,47,0.28)",
      }}>
      <div className="flex flex-col items-end flex-1 min-w-0 text-right gap-0.5">
        <span className="text-xs font-semibold" style={{ color: "#B0B0B0" }}>الولد يخطط لاغتيال:</span>
        <span className="text-lg font-black text-white truncate w-full">{targetName}</span>
      </div>
      <span
        className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-full text-lg"
        style={{ backgroundColor: "rgba(211,47,47,0.45)", border: "2px solid #D32F2F" }}
        aria-hidden>
        🔪
      </span>
    </div>
  );
}
