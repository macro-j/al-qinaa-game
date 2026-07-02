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
