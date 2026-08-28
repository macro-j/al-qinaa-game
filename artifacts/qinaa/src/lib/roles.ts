// ─── Single source of truth for role identity + copy ───────────────────────
// The in-game "Introductory Night" reveal, the Shop, and the Guide all read
// from here so role names, colors, and descriptions can never drift apart.

export const ROLE_META: Record<string, { color: string; glow: string; desc: string }> = {
  "الولد":   { color: "#D32F2F", glow: "#D32F2F33", desc: "القاتل — يختار ضحية كل ليلة ويحاول البقاء مجهولاً." },
  "الإكة":   { color: "#B71C1C", glow: "#B71C1C33", desc: "الكاتم — يسكت لاعباً ويمنعه من الكلام صباحاً." },
  "الشايب":  { color: "#FF8F00", glow: "#FF8F0033", desc: "العرّاف — يكشف هوية لاعب كل ليلة (مافيا أم بريء)." },
  "البنت":   { color: "#1565C0", glow: "#1565C033", desc: "الحارس — يحمي لاعباً من القتل تلك الليلة." },
  "المواطن": { color: "#555555", glow: "#55555522", desc: "من الشعب — ابحث عن المافيا وصوّت ضدهم." },
  // ── Expansion Pack roles (Phase 1 — engine-level identity, behavior wired in later phases) ──
  "madman":   { color: "#E879F9", glow: "#E879F933", desc: "المجنون — يفوز فوراً وتخسر القرية إذا تم إعدامه بالتصويت في النهار." },
  "twin":     { color: "#22D3EE", glow: "#22D3EE33", desc: "التوأم — قرويان يعرفان بعضهما، إذا مات أحدهما يموت الآخر فوراً." },
  "avenger":  { color: "#A0522D", glow: "#A0522D33", desc: "المنتقم — إذا قُتل أو أُعدم، يختار شخصاً ليقتله ويأخذه معه للقبر." },
  "magician": { color: "#A3E635", glow: "#A3E63533", desc: "الساحر — يملك جرعة حياة وجرعة سم؛ وعند تفعيل القناص تصبح قدرته جرعة الحياة فقط." },
  "sniper":   { color: "#94A3B8", glow: "#94A3B833", desc: "القناص — مافيا مستقل لا يعرف حلفاءه، يملك طلقة واحدة ابتداءً من الليلة الثانية." },
};

// Maps English logic keys → Arabic display names for the expansion roles.
// Base roles use their Arabic name as the key itself, so they fall through to key.
export const ROLE_DISPLAY_NAME: Record<string, string> = {
  madman:   "المجنون",
  twin:     "التوأم",
  avenger:  "المنتقم",
  magician: "الساحر",
  sniper:   "القناص",
};

export const getRoleName = (role: string): string => ROLE_DISPLAY_NAME[role] ?? role;

// Display order for the catalog surfaces (Shop / Guide). Keys match ROLE_META.
export const MAIN_ROLE_KEYS: readonly string[] = ["الولد", "الإكة", "الشايب", "البنت", "المواطن"];
export const EXPANSION_ROLE_KEYS: readonly string[] = ["madman", "twin", "avenger", "magician", "sniper"];
