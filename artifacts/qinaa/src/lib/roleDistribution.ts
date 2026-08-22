export type RoleCard = { role: string; color: string };
export type RoleAssignment = RoleCard & { name: string };

type DistributionHistoryEntry = {
  rosterKey: string;
  deckKey: string;
  assignments: Record<string, string>;
  signature: string;
  createdAt: number;
};

const STORAGE_KEY = "qinaa_role_distribution_history_v1";
const HISTORY_PER_ROSTER = 10;
const HISTORY_TOTAL_LIMIT = 80;
const CANDIDATE_ATTEMPTS = 256;

function normalizeName(name: string): string {
  return name.trim().normalize("NFKC").toLocaleLowerCase("ar");
}

function getRosterKey(playerNames: string[]): string {
  return playerNames.map(normalizeName).sort().join("\u001f");
}

function getDeckKey(cards: RoleCard[]): string {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.role, (counts.get(card.role) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "ar"))
    .map(([role, count]) => `${role}:${count}`)
    .join("\u001f");
}

function getSignature(assignments: RoleAssignment[]): string {
  return assignments
    .map(({ name, role }) => [normalizeName(name), role] as const)
    .sort(([a], [b]) => a.localeCompare(b, "ar"))
    .map(([name, role]) => `${name}:${role}`)
    .join("\u001f");
}

function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const range = 0x1_0000_0000;
    const limit = range - (range % maxExclusive);
    const value = new Uint32Array(1);
    do cryptoApi.getRandomValues(value); while (value[0] >= limit);
    return value[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

export function secureShuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isHistoryEntry(value: unknown): value is DistributionHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<DistributionHistoryEntry>;
  return typeof entry.rosterKey === "string"
    && typeof entry.deckKey === "string"
    && typeof entry.signature === "string"
    && typeof entry.createdAt === "number"
    && !!entry.assignments
    && typeof entry.assignments === "object";
}

export function loadDistributionHistory(): DistributionHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; entries?: unknown[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(isHistoryEntry).slice(0, HISTORY_TOTAL_LIMIT);
  } catch {
    return [];
  }
}

export function rememberDistribution(assignments: RoleAssignment[]): void {
  if (assignments.length === 0) return;
  try {
    const rosterKey = getRosterKey(assignments.map(({ name }) => name));
    const entry: DistributionHistoryEntry = {
      rosterKey,
      deckKey: getDeckKey(assignments),
      assignments: Object.fromEntries(assignments.map(({ name, role }) => [normalizeName(name), role])),
      signature: getSignature(assignments),
      createdAt: Date.now(),
    };
    const existing = loadDistributionHistory()
      .filter(old => !(old.rosterKey === rosterKey && old.signature === entry.signature));
    const sameRoster = existing.filter(old => old.rosterKey === rosterKey).slice(0, HISTORY_PER_ROSTER - 1);
    const otherRosters = existing.filter(old => old.rosterKey !== rosterKey);
    const entries = [entry, ...sameRoster, ...otherRosters].slice(0, HISTORY_TOTAL_LIMIT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries }));
  } catch {
    // Distribution must still work if storage is unavailable or full.
  }
}

function buildNoImmediateRepeatCandidate(
  playerNames: string[],
  cards: RoleCard[],
  previousAssignments: Record<string, string> | null,
): RoleAssignment[] | null {
  const randomizedPlayers = secureShuffle(playerNames.map((name, index) => ({ name, index })));
  const cardOwner = Array<number>(cards.length).fill(-1);

  const canAssign = (playerIndex: number, cardIndex: number): boolean => {
    if (!previousAssignments) return true;
    const previousRole = previousAssignments[normalizeName(playerNames[playerIndex])];
    return previousRole !== cards[cardIndex].role;
  };

  const findCard = (playerIndex: number, seenCards: boolean[]): boolean => {
    for (const cardIndex of secureShuffle(cards.map((_, index) => index))) {
      if (seenCards[cardIndex] || !canAssign(playerIndex, cardIndex)) continue;
      seenCards[cardIndex] = true;
      if (cardOwner[cardIndex] === -1 || findCard(cardOwner[cardIndex], seenCards)) {
        cardOwner[cardIndex] = playerIndex;
        return true;
      }
    }
    return false;
  };

  for (const player of randomizedPlayers) {
    if (!findCard(player.index, Array(cards.length).fill(false))) return null;
  }

  const assignedByPlayer: Array<RoleAssignment | undefined> = Array(playerNames.length);
  cardOwner.forEach((playerIndex, cardIndex) => {
    if (playerIndex >= 0) assignedByPlayer[playerIndex] = { name: playerNames[playerIndex], ...cards[cardIndex] };
  });
  return assignedByPlayer.every(Boolean) ? assignedByPlayer as RoleAssignment[] : null;
}

function scoreCandidate(candidate: RoleAssignment[], recent: DistributionHistoryEntry[]): number {
  const signature = getSignature(candidate);
  let score = recent.some(entry => entry.signature === signature) ? 10_000_000 : 0;

  for (const { name, role } of candidate) {
    const key = normalizeName(name);
    recent.forEach((entry, index) => {
      if (entry.assignments[key] !== role) return;
      // The previous game is a hard priority; older repetitions fade gradually.
      score += index === 0 ? 1_000_000 : Math.max(1, 256 >> Math.min(index - 1, 7));
    });
  }
  return score;
}

export function generateSmartDistribution(
  playerNames: string[],
  cards: RoleCard[],
  history: DistributionHistoryEntry[] = loadDistributionHistory(),
): RoleAssignment[] {
  if (playerNames.length !== cards.length) {
    throw new Error("Role deck size must match player count");
  }

  const rosterKey = getRosterKey(playerNames);
  const recent = history
    .filter(entry => entry.rosterKey === rosterKey)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, HISTORY_PER_ROSTER);
  const previousAssignments = recent[0]?.assignments ?? null;
  const candidates = new Map<string, RoleAssignment[]>();

  for (let attempt = 0; attempt < CANDIDATE_ATTEMPTS; attempt++) {
    const candidate = buildNoImmediateRepeatCandidate(playerNames, cards, previousAssignments);
    if (!candidate) break;
    candidates.set(getSignature(candidate), candidate);
  }

  // A perfect no-repeat assignment can be mathematically impossible after a
  // deck change. In that case, sample broadly and choose the least repetitive.
  if (candidates.size === 0) {
    for (let attempt = 0; attempt < CANDIDATE_ATTEMPTS * 2; attempt++) {
      const shuffledCards = secureShuffle(cards);
      const candidate = playerNames.map((name, index) => ({ name, ...shuffledCards[index] }));
      candidates.set(getSignature(candidate), candidate);
    }
  }

  const scored = [...candidates.values()].map(candidate => ({
    candidate,
    score: scoreCandidate(candidate, recent),
  }));
  const bestScore = Math.min(...scored.map(({ score }) => score));
  const best = scored.filter(({ score }) => score === bestScore);
  const chosen = best[secureRandomInt(best.length)]?.candidate
    ?? playerNames.map((name, index) => ({ name, ...cards[index] }));

  // Reveal order must stay unpredictable independently of role assignment.
  return secureShuffle(chosen);
}
