import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  BarChart3, Eye, Heart, MessageCircle, Percent, RefreshCw, Repeat2, Trophy, Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/i18n";
import { formatDelta } from "@shared/followerStats";

const PERIODS = [
  { value: "day" as const, label: "日間" },
  { value: "week" as const, label: "週間" },
  { value: "month" as const, label: "月間" },
];

const RANK_OPTIONS = [
  { value: "engagement" as const, label: "総エンゲージメント" },
  { value: "views" as const, label: "インプレッション" },
  { value: "rate" as const, label: "エンゲージメント率" },
];

const RANK_BADGES = [
  "bg-[var(--brand-accent)] text-white",
  "bg-[#5b7fa4] text-white",
  "bg-[#b08d57] text-white",
  "bg-muted text-muted-foreground",
  "bg-muted text-muted-foreground",
];

/**
 * フォロワー増減の色。
 * 明所サーフェス上で検証済み（deutan ΔE 8.4）。ただし色だけに意味を持たせず、
 * 数値には必ず +/− の符号を付ける。
 */
const UP = "#047857";
const DOWN = "#b91c1c";
/** 総フォロワー数の線。単系列なので凡例は出さない */
const TOTAL_LINE = "#335B82";

/** 増減の表示。符号つきテキストなので色が見えなくても増減が分かる */
function Delta({ value }: { value: number | null }) {
  const text = formatDelta(value);
  const color =
    value === null || value === 0 ? "text-muted-foreground"
    : value > 0 ? "text-[#047857]" : "text-[#b91c1c]";
  return <span className={`tabular-nums font-semibold ${color}`}>{text}</span>;
}

export default function Analytics() {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [rankBy, setRankBy] = useState<"views" | "engagement" | "rate">("engagement");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const utils = trpc.useUtils();
  const { data: summary } = trpc.analytics.summary.useQuery({ period });
  const { data: followers } = trpc.analytics.followerSummary.useQuery();
  const { data: history } = trpc.analytics.followerHistory.useQuery({ period });
  const { data: topPosts = [] } = trpc.analytics.topPostsByPeriod.useQuery({ period, limit: 5, rankBy });

  const refresh = trpc.analytics.refreshNow.useMutation({
    onSuccess: (d) => {
      setLastRefreshed(d.refreshedAt);
      utils.analytics.invalidate();
      const note: Record<string, string> = {
        unavailable: "フォロワー指標が利用できません",
        token_expired: "トークンの期限が切れています",
        permission: "Insights権限が不足しています",
        rate_limited: "API利用制限に達しました",
        network: "一時的な通信障害が発生しました",
        unknown: "フォロワー数を取得できませんでした",
        skipped: "Threadsアカウントが接続されていません",
      };
      if (d.followerStatus === "ok") toast.success(t("最新データを取得しました"));
      else toast.warning(`${t("投稿データは更新しました")} — ${t(note[d.followerStatus] ?? note.unknown)}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const points = history?.points ?? [];
  const hasFollowerData = (followers?.hasHistory ?? false) && points.length > 0;
  const hasPostData = (summary?.totalPosts ?? 0) > 0;

  const summaryCards = [
    { label: "投稿数", value: summary?.totalPosts ?? 0, icon: BarChart3, bg: "bg-primary/10", color: "text-primary" },
    { label: "インプレッション（表示回数）", value: summary?.totalViews ?? 0, icon: Eye, bg: "bg-[#5b7fa4]/12", color: "text-[#5b7fa4]" },
    { label: "いいね", value: summary?.totalLikes ?? 0, icon: Heart, bg: "bg-[var(--brand-accent)]/12", color: "text-[var(--brand-accent-deep)]" },
    { label: "返信", value: summary?.totalReplies ?? 0, icon: MessageCircle, bg: "bg-primary/10", color: "text-primary" },
    { label: "リポスト", value: summary?.totalReposts ?? 0, icon: Repeat2, bg: "bg-emerald-600/10", color: "text-emerald-700" },
  ];

  const barData = summary ? [
    { name: t("いいね"), value: summary.totalLikes },
    { name: t("返信"), value: summary.totalReplies },
    { name: t("リポスト"), value: summary.totalReposts },
  ] : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title={t("分析")}
        description={
          summary
            ? `${summary.range.from} 〜 ${summary.range.to}`
            : t("投稿パフォーマンスの確認")
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 p-1 bg-muted rounded-lg">
              {PERIODS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  aria-pressed={period === p.value}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${period === p.value ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t(p.label)}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" disabled={refresh.isPending}
              onClick={() => refresh.mutate()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refresh.isPending ? "animate-spin" : ""}`} />
              {refresh.isPending ? t("Threadsから分析データを取得中…") : t("最新データを取得")}
            </Button>
          </div>
        }
      />

      <p className="sr-only" role="status" aria-live="polite">
        {refresh.isPending ? t("Threadsから分析データを取得中…") : ""}
      </p>
      {lastRefreshed && (
        <p className="text-xs text-muted-foreground -mt-3">
          {t("最終更新")}: {lastRefreshed.toLocaleString(locale)}
        </p>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {summaryCards.map(card => (
          <Card key={card.label} className="border shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <span className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${card.bg}`}>
                  <card.icon className={`h-5 w-5 ${card.color}`} strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{t(card.label)}</p>
                  <p className="text-2xl font-bold tabular-nums">{card.value.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Engagement rate + follower summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="border shadow-none">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="h-9 w-9 rounded-lg bg-[var(--brand-accent)]/12 flex items-center justify-center shrink-0">
              <Percent className="h-5 w-5 text-[var(--brand-accent-deep)]" strokeWidth={1.8} />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{t("エンゲージメント率")}</p>
              <p className="text-2xl font-bold tabular-nums">
                {(summary?.engagementRate ?? 0).toFixed(2)}%
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Users className="h-5 w-5 text-primary" strokeWidth={1.8} />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{t("現在のフォロワー")}</p>
              <p className="text-2xl font-bold tabular-nums">
                {followers?.current === null || followers?.current === undefined
                  ? "—" : followers.current.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Follower trend */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />{t("フォロワー推移")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><dt className="text-xs text-muted-foreground">{t("現在のフォロワー")}</dt>
              <dd className="text-lg font-bold tabular-nums">
                {followers?.current == null ? "—" : followers.current.toLocaleString()}
              </dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("今日の増減")}</dt>
              <dd className="text-lg"><Delta value={followers?.today ?? null} /></dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("直近7日の増減")}</dt>
              <dd className="text-lg"><Delta value={followers?.last7 ?? null} /></dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("直近30日の増減")}</dt>
              <dd className="text-lg"><Delta value={followers?.last30 ?? null} /></dd></div>
          </dl>

          {!hasFollowerData ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
              <p>{t("フォロワー推移は、データ取得を開始した日から表示されます")}</p>
              <p className="mt-1">{t("「最新データを取得」を押すと記録が始まります")}</p>
            </div>
          ) : points.length === 1 ? (
            <p className="text-sm text-muted-foreground">
              {t("履歴が1件のため増減は計算できません。現在値のみ表示しています。")}
            </p>
          ) : (
            <>
              {/* 総数と増減は尺度が違うので二軸にせず、グラフを分ける */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5 font-medium">{t("総フォロワー数")}</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={points} margin={{ top: 4, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={["dataMin - 5", "dataMax + 5"]} />
                    <Tooltip content={<FollowerTooltip t={t} />} />
                    <Line
                      type="monotone" dataKey="followers" stroke={TOTAL_LINE} strokeWidth={2}
                      dot={{ r: 4, strokeWidth: 0, fill: TOTAL_LINE }} activeDot={{ r: 6 }}
                      name={t("フォロワー数")}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-1.5 font-medium">{t("前日比")}</p>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={points} margin={{ top: 4, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip content={<FollowerTooltip t={t} />} />
                    <Bar dataKey="dailyChange" radius={[4, 4, 0, 0]} name={t("前日比")}>
                      {points.map((p, i) => (
                        <Cell key={i} fill={(p.dailyChange ?? 0) >= 0 ? UP : DOWN} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* グラフを読めない場合のために同じ内容を表でも出す */}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  {t("数値で見る")}
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <caption className="sr-only">{t("フォロワー推移")}</caption>
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="py-1.5 pr-3 font-medium">{t("日付")}</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium tabular-nums">{t("フォロワー数")}</th>
                        <th scope="col" className="py-1.5 pr-3 font-medium tabular-nums">{t("前日比")}</th>
                        <th scope="col" className="py-1.5 font-medium tabular-nums">{t("期間開始比")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {points.map(p => (
                        <tr key={p.date} className="border-b last:border-0">
                          <td className="py-1.5 pr-3">{p.date}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{p.followers.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{formatDelta(p.dailyChange)}</td>
                          <td className="py-1.5 tabular-nums">{formatDelta(p.sinceStart)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              {history && !history.hasBaseline && (
                <p className="text-xs text-muted-foreground">
                  {t("期間開始前のデータが無いため、増減は参考値です。")}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Engagement overview */}
      <Card className="border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base font-semibold">{t("エンゲージメント概要")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasPostData ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <p>{t("まだ分析データがありません")}</p>
              <p className="mt-1">{t("Threadsへ投稿した後、「最新データを取得」を押してください")}</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="value" name={t("件数")} radius={[4, 4, 0, 0]}>
                  {barData.map((_, i) => (
                    <Cell key={i} fill={["#ff9800", "#335B82", "#5b7fa4"][i] ?? "#335B82"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Ranking */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <span className="h-7 w-7 rounded-lg bg-[var(--brand-accent)]/12 flex items-center justify-center">
                <Trophy className="h-4 w-4 text-[var(--brand-accent-deep)]" strokeWidth={1.8} />
              </span>
              {t(`${PERIODS.find(p => p.value === period)?.label}トップ5ランキング`)}
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t("ランキング基準")}</span>
              <div className="flex gap-1 p-0.5 bg-muted rounded-md">
                {RANK_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => setRankBy(o.value)}
                    aria-pressed={rankBy === o.value}
                    className={`px-2 py-1 text-xs rounded transition-all ${rankBy === o.value ? "bg-card shadow-sm text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t(o.label)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {topPosts.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Trophy className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
              <p>{t("この期間のデータがありません")}</p>
              <p className="mt-1">{t("Threads側でインサイトが利用可能になるまで時間がかかる場合があります")}</p>
            </div>
          ) : (
            <div className="divide-y rounded-lg border overflow-hidden">
              {topPosts.map((p, i) => (
                <div key={p.id} className={`flex items-start gap-3 p-3 ${i === 0 ? "bg-[var(--brand-accent)]/6" : ""}`}>
                  <div className="shrink-0 w-8 pt-0.5">
                    <span className={`h-7 w-7 rounded-full flex items-center justify-center text-sm font-bold tabular-nums ${RANK_BADGES[i] ?? "bg-muted text-muted-foreground"}`}>
                      {i + 1}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm line-clamp-2 text-foreground leading-snug">{p.content}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs">
                      <span className="inline-flex items-center gap-1 text-[#5b7fa4]">
                        <Eye className="h-3 w-3" />{t("インプレッション（表示回数）")} {p.views.toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[var(--brand-accent-deep)]">
                        <Heart className="h-3 w-3" />{p.likes.toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1 text-primary">
                        <MessageCircle className="h-3 w-3" />{p.replies.toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Repeat2 className="h-3 w-3" />{p.reposts.toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Percent className="h-3 w-3" />{p.engagementRate.toFixed(2)}%
                      </span>
                      {p.postedAt && (
                        <span className="text-muted-foreground ml-auto">
                          {new Date(p.postedAt).toLocaleDateString(locale)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** 日付・総数・前日比・期間開始比をまとめて出すツールチップ */
function FollowerTooltip({
  active, payload, label, t,
}: {
  active?: boolean;
  payload?: { payload: { followers: number; dailyChange: number | null; sinceStart: number | null } }[];
  label?: string;
  t: (s: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md text-xs space-y-0.5">
      <p className="font-semibold">{label}</p>
      <p>{t("フォロワー数")} <span className="tabular-nums font-medium">{p.followers.toLocaleString()}</span></p>
      <p>{t("前日比")} <span className="tabular-nums font-medium">{formatDelta(p.dailyChange)}</span></p>
      <p>{t("期間開始比")} <span className="tabular-nums font-medium">{formatDelta(p.sinceStart)}</span></p>
    </div>
  );
}
