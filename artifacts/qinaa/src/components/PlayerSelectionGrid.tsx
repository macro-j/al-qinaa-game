/** Centered flex-wrap player pick layout — balanced rows for 5–9 players on laptop. */
export const PLAYER_SELECTION_WRAP =
  "flex flex-wrap justify-center gap-3 sm:gap-4 w-full";

/** Uniform card widths: 2-up on phone, fixed tiles on tablet/desktop, centered orphans. */
export const PLAYER_SELECTION_CARD =
  "w-[47%] sm:w-[160px] md:w-[180px] flex flex-col items-center justify-center gap-2 px-3 py-3.5 rounded-xl transition-colors duration-200 active:scale-95";
