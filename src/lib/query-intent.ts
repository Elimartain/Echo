export type QueryIntent = "summary" | "tasks" | "decisions" | "commitments" | "general";

export type ParsedQuery = {
  people: string[];
  intent: QueryIntent;
  startAt: string | null;
  endAt: string | null;
};

function normalizeToken(token: string) {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseQueryIntent(input: string): ParsedQuery {
  const text = input.toLowerCase();
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  let startAt: string | null = null;
  let endAt: string | null = null;

  if (text.includes("today")) {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    startAt = start.toISOString();
    endAt = end.toISOString();
  } else if (text.includes("yesterday")) {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    startAt = start.toISOString();
    endAt = end.toISOString();
  } else if (text.includes("last week")) {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    startAt = start.toISOString();
    endAt = end.toISOString();
  }

  let intent: QueryIntent = "general";
  if (/summari|discuss|conversation|recap/.test(text)) intent = "summary";
  if (/task|todo|pending|follow[- ]?up|build/.test(text)) intent = "tasks";
  if (/decision|decide|agreed/.test(text)) intent = "decisions";
  if (/promise|commit|said i would|i will|i'll/.test(text)) intent = "commitments";

  const personCandidates = input.match(
    /\b([A-Z][a-z]+|cofounder|founder|investors?|client|rahul)\b/g,
  );
  const people = Array.from(
    new Set((personCandidates ?? []).map((value) => normalizeToken(value)).filter(Boolean)),
  );

  return { people, intent, startAt, endAt };
}

export function fuzzyIncludes(haystack: string, token: string) {
  const normalizedHaystack = normalizeToken(haystack);
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) return false;
  if (normalizedHaystack.includes(normalizedToken)) return true;
  if (normalizedToken.length < 5) return false;
  return normalizedHaystack.includes(normalizedToken.slice(0, 4));
}
