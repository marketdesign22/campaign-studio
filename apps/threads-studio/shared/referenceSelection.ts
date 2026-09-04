export type ReferenceCandidate = { id: number; content: string; postedAt: Date; views: number | null; likes: number | null; replies: number | null; reposts: number | null; clicks: number; conversions: number };
export type SelectedReference = ReferenceCandidate & { reason: "style" | "performance" | "theme" };

function themeScore(content: string, topic: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const a = normalize(content), b = normalize(topic); if (!a || !b) return 0;
  const tokens = new Set(Array.from({ length: Math.max(0, b.length - 1) }, (_, i) => b.slice(i, i + 2)));
  return Array.from(tokens).filter((t) => a.includes(t)).length;
}
function outcomeScore(x: ReferenceCandidate, now: number): number {
  const engagement = (x.likes ?? 0) + (x.replies ?? 0) * 2 + (x.reposts ?? 0) * 2;
  const rate = x.views && x.views > 0 ? engagement / x.views : 0;
  const ageDays = Math.max(0, (now - x.postedAt.getTime()) / 86_400_000);
  return rate * 100 + Math.log1p(engagement) + x.clicks * 2 + x.conversions * 5 - ageDays / 365;
}
export function selectReferencePosts(candidates: ReferenceCandidate[], topic: string, now = Date.now()): SelectedReference[] {
  const valid = candidates.filter((x) => x.content.trim() && x.postedAt.getTime() >= now - 365 * 86_400_000);
  const selected: SelectedReference[] = [], used = new Set<number>();
  const take = (rows: ReferenceCandidate[], count: number, reason: SelectedReference["reason"]) => { for (const row of rows) { if (selected.length >= 8 || count <= 0) break; if (used.has(row.id)) continue; used.add(row.id); selected.push({ ...row, reason }); count--; } };
  take([...valid].sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime()), 3, "style");
  take([...valid].sort((a, b) => outcomeScore(b, now) - outcomeScore(a, now)), 3, "performance");
  take([...valid].sort((a, b) => themeScore(b.content, topic) - themeScore(a.content, topic)), 2, "theme");
  take(valid, 8 - selected.length, "style");
  return selected;
}
