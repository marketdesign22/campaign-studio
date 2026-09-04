/**
 * 話題性スコア（0〜100）。
 *
 * 前提として、Threads の keyword_search は **他人の投稿の反応数を返さない**。
 * 取れるのは投稿日時・返信の有無・本文だけで、いいね数などは自分の投稿にしか出ない。
 * だから「取れない指標は 0 ではなく null」を徹底し、取れた指標だけで正規化する。
 * どの指標が使えて、どれが使えなかったかは breakdown で必ず画面に出す。
 *
 * 絶対数より「投稿後の短時間でどれだけ反応が伸びているか」（速度）を重く見る。
 */

export type TrendSignals = {
  postedAt: Date | null;
  now: Date;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  views: number | null;
  saves: number | null;
  hasReplies: boolean | null;
  /** 同じキーワードの出現数の伸び。直近24hの件数 ÷ その前24hの件数。基準が無ければ null */
  keywordGrowth: number | null;
  /** 自社の過去投稿とのテーマ適合度 0〜1。過去投稿が無ければ null */
  themeFit: number | null;
};

export type ScoreComponent = {
  key: "recency" | "velocity" | "replies" | "keywordGrowth" | "themeFit";
  points: number;
  max: number;
  available: boolean;
  reason: string;
};

export type TrendScore = {
  score: number;
  breakdown: ScoreComponent[];
  isRising: boolean;
};

const MAX = { recency: 25, velocity: 35, replies: 10, keywordGrowth: 20, themeFit: 10 } as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function hoursSince(postedAt: Date, now: Date): number {
  return Math.max(0, (now.getTime() - postedAt.getTime()) / 3_600_000);
}

/** 新しさ: 6時間以内で満点、72時間で0 */
function recency(s: TrendSignals): ScoreComponent {
  if (!s.postedAt) {
    return { key: "recency", points: 0, max: MAX.recency, available: false, reason: "投稿日時が取得できません" };
  }
  const h = hoursSince(s.postedAt, s.now);
  const ratio = h <= 6 ? 1 : h >= 72 ? 0 : 1 - (h - 6) / 66;
  return {
    key: "recency", points: Math.round(ratio * MAX.recency), max: MAX.recency, available: true,
    reason: `投稿から${h < 1 ? "1時間未満" : `${Math.round(h)}時間`}`,
  };
}

/**
 * 反応速度: 1時間あたりのエンゲージメント。
 * いいね・返信・リポスト・保存を合算し、閲覧は1/50で加える（桁が違うため）。
 * 全て null なら「取得不可」として計算から外す。
 */
function velocity(s: TrendSignals): ScoreComponent {
  const parts = [s.likes, s.replies, s.reposts, s.saves];
  const anyMetric = parts.some((v) => v !== null) || s.views !== null;
  if (!anyMetric || !s.postedAt) {
    return {
      key: "velocity", points: 0, max: MAX.velocity, available: false,
      reason: "反応数はこの投稿では取得できません（Threads APIは自分の投稿にしか反応数を返しません）",
    };
  }
  const engagement =
    parts.reduce<number>((sum, v) => sum + (v ?? 0), 0) + (s.views ?? 0) / 50;
  const h = Math.max(0.5, hoursSince(s.postedAt, s.now));
  const perHour = engagement / h;
  // 対数スケール: 1/h→約12%、10/h→約45%、100/h→約78%、1000/h→満点
  const ratio = clamp(Math.log10(perHour + 1) / 3, 0, 1);
  return {
    key: "velocity", points: Math.round(ratio * MAX.velocity), max: MAX.velocity, available: true,
    reason: `1時間あたり約${perHour.toFixed(1)}件の反応`,
  };
}

/** 返信の有無。keyword_search でも取れる数少ない反応シグナル */
function replies(s: TrendSignals): ScoreComponent {
  if (s.hasReplies === null) {
    return { key: "replies", points: 0, max: MAX.replies, available: false, reason: "返信の有無が取得できません" };
  }
  return {
    key: "replies", points: s.hasReplies ? MAX.replies : 0, max: MAX.replies, available: true,
    reason: s.hasReplies ? "返信が付いています" : "まだ返信がありません",
  };
}

/** キーワード出現の伸び: 1.0倍で0、2倍で半分、3倍以上で満点 */
function keywordGrowth(s: TrendSignals): ScoreComponent {
  if (s.keywordGrowth === null) {
    return { key: "keywordGrowth", points: 0, max: MAX.keywordGrowth, available: false, reason: "比較できる前日のデータがありません" };
  }
  const ratio = clamp((s.keywordGrowth - 1) / 2, 0, 1);
  return {
    key: "keywordGrowth", points: Math.round(ratio * MAX.keywordGrowth), max: MAX.keywordGrowth, available: true,
    reason: `同じキーワードの投稿が前日比${s.keywordGrowth.toFixed(1)}倍`,
  };
}

function themeFit(s: TrendSignals): ScoreComponent {
  if (s.themeFit === null) {
    return { key: "themeFit", points: 0, max: MAX.themeFit, available: false, reason: "比較できる自社の過去投稿がありません" };
  }
  return {
    key: "themeFit", points: Math.round(clamp(s.themeFit, 0, 1) * MAX.themeFit), max: MAX.themeFit, available: true,
    reason: `自社の過去投稿とのテーマ一致度${Math.round(s.themeFit * 100)}%`,
  };
}

export function computeTrendScore(s: TrendSignals): TrendScore {
  const breakdown = [recency(s), velocity(s), replies(s), keywordGrowth(s), themeFit(s)];
  const available = breakdown.filter((c) => c.available);
  const maxSum = available.reduce((a, c) => a + c.max, 0);
  const pointSum = available.reduce((a, c) => a + c.points, 0);
  // 取れた指標だけで100点満点に正規化。何も取れなければ0
  const score = maxSum === 0 ? 0 : Math.round((pointSum / maxSum) * 100);

  const vel = breakdown.find((c) => c.key === "velocity")!;
  const rec = breakdown.find((c) => c.key === "recency")!;
  const kw = breakdown.find((c) => c.key === "keywordGrowth")!;
  // 急上昇: 反応速度が高い。反応数が取れない場合は「新しくてキーワードが伸びている」で代替
  const isRising = vel.available
    ? vel.points >= vel.max * 0.7
    : rec.available && rec.points >= rec.max * 0.6 && kw.available && (s.keywordGrowth ?? 0) >= 1.5;

  return { score, breakdown, isRising };
}

// ── テーマ適合度 ─────────────────────────────────────────────────────────────

/**
 * 文字2-gram の集合。日本語は分かち書きが無いので文字n-gramで近似する。
 * 英数字は単語として扱う。
 */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text.toLowerCase().replace(/https?:\/\/\S+/g, " ");
  for (const word of cleaned.match(/[a-z0-9]{2,}/g) ?? []) out.add(word);
  // tsconfig の target が古く \p{Script} が使えないため、範囲指定で日本語文字だけを残す
  const cjk = cleaned.replace(/[^\u3040-\u30ff\u4e00-\u9fff]/g, "");
  for (let i = 0; i + 1 < cjk.length; i++) out.add(cjk.slice(i, i + 2));
  return out;
}

/** 候補文と自社投稿群の最大 Jaccard 類似度（0〜1）。自社投稿が無ければ null */
export function themeFitScore(candidate: string, ownTexts: string[]): number | null {
  if (ownTexts.length === 0) return null;
  const a = tokenize(candidate);
  if (a.size === 0) return 0;
  let best = 0;
  const aTokens = Array.from(a);
  for (const own of ownTexts) {
    const b = tokenize(own);
    if (b.size === 0) continue;
    let inter = 0;
    for (const t of aTokens) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    best = Math.max(best, union === 0 ? 0 : inter / union);
  }
  // Jaccard は同一テーマでも 0.3 程度に留まるので、0.35 で満点になるよう伸ばす
  return clamp(best / 0.35, 0, 1);
}

/** 本文の要約。全文転載を避けるため先頭だけを短く残す */
export function summarize(text: string, maxChars = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length <= maxChars ? flat : chars.slice(0, maxChars).join("") + "…";
}
