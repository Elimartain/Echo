export async function generateEmbedding(text: string): Promise<number[]> {
  const dim = 384;
  const vec = new Array<number>(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += 1;
  }

  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map((value) => value / norm);
}

export function toPgVectorLiteral(values: number[]) {
  return `[${values.map((v) => Number(v).toFixed(6)).join(",")}]`;
}
