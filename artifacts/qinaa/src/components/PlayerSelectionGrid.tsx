/** Centered flex-wrap player pick layout — balanced rows for 5–9 players on laptop. */
export const PLAYER_SELECTION_WRAP =
  "flex flex-wrap justify-center gap-3 sm:gap-4 md:gap-2 w-full";

/** Uniform card widths: 2-up on phone, fixed tiles on tablet/desktop, centered orphans. */
export const PLAYER_SELECTION_CARD =
  "w-[47%] sm:w-[160px] md:w-[180px] flex flex-col items-center justify-center gap-2 md:gap-1.5 px-3 py-3.5 md:py-2 rounded-xl transition-colors duration-200 active:scale-95";

/** Number badge inside each player card. */
export const PLAYER_SELECTION_INDEX =
  "w-7 h-7 md:w-5 md:h-5 flex items-center justify-center rounded-full font-bold text-xs md:text-[10px] flex-shrink-0";
