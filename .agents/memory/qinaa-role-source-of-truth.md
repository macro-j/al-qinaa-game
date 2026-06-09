---
name: qinaa role data single source of truth
description: Where role identity/copy and the canonical role-card design live, and why Shop/Guide must reuse them.
---

# Qinaa role data & card — single source of truth

Role identity (name, color, glow, ability `desc`) and the name mapping live in `artifacts/qinaa/src/lib/roles.ts` (`ROLE_META`, `ROLE_DISPLAY_NAME`, `getRoleName`, plus `MAIN_ROLE_KEYS` / `EXPANSION_ROLE_KEYS` for catalog order). App.tsx imports from here — do NOT redefine role metadata locally anywhere.

The canonical role-card visual is the in-game "Introductory Night" (الليلة التعريفية) reveal card in App.tsx (flip card: front mystery mask, back reveal + desc). `src/components/RoleRevealCard.tsx` is a de-personalized clone of it (no player name) and is the ONLY card any catalog surface (Shop, Guide) should use to show a role.

**Why:** The user repeatedly rejected drifted/duplicated role copy and inconsistent card styling ("hallucinated text", "inconsistent UI") and demanded one source. Shop add-ons and Guide previously each had their own divergent role descriptions/cards.

**How to apply:** Any new surface that shows a role must import keys + `RoleRevealCard` from these two files. Never author new Arabic role descriptions — pull `ROLE_META[key].desc`. When de-personalizing in-game strings, keep the exact in-game vocabulary minus the player-name token (e.g. "قناعك يا {name} هو" → "قناعك هو"). Role keys: base roles use their Arabic name as the key (الولد/الإكة/الشايب/البنت/المواطن); expansion roles use English keys (madman/twin/avenger/magician) mapped to Arabic via getRoleName. Shop add-on id→roleKey: role_wizard→magician, role_madman→madman, role_avenger→avenger, role_twins→twin.
