import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, Legend } from "recharts";
import { BarChart3, Heart, MessageCircle, Repeat2, Trophy } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/i18n";

const PERIODS = [
  { value: "day" as const, label: "日間" },
  { value: "week" as const, label: "週間" },
  { value: "month" as const, label: "月間" },
];

const RANK_COLORS = ["#ff9800", "#5b7fa4", "#b08d57", "#335B82", "#335B82"];
const RANK_BADGES = [
  "bg-[var(--brand-accent)] text-white",
  "bg-[#5b7fa4] text-white",
  "bg-[#b08d57] text-white",
  "bg-muted text-muted-foreground",
  "bg-muted text-muted-foreground",
];

export default function Analytics() {
  const { t, locale } = useI18n();
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const { data: summary } = trpc.analytics.summary.useQuery({ period });
  const { data: topPosts = [] } = trpc.analytics.topPostsByPeriod.useQuery({ period, limit: 5 });

  const summaryCards = [
    { label: "投稿数", value: summary?.totalPosts ?? 0, color: "text-primary", icon: BarChart3, bg: "bg-primary/10" },
    { label: "いいね", value: summary?.totalLikes ?? 0, color: "text-[var(--brand-accent-deep)]", icon: Heart, bg: "bg-[var(--brand-accent)]/12" },
    { label: "返信", value: summary?.totalReplies ?? 0, color: "text-[#5b7fa4]", icon: MessageCircle, bg: "bg-[#5b7fa4]/12" },
    { label: "リポスト", value: summary?.totalReposts ?? 0, color: "text-emerald-700", icon: Repeat2, bg: "bg-emerald-600/10" },
  ];

  const barData = summary ? [
    { name: t("いいね"), value: summary.totalLikes },
    { name: t("返信"), value: summary.totalReplies },
    { name: t("リポスト"), value: summary.totalReposts },
    { name: t("投稿数"), value: summary.totalPosts },
  ] : [];

  const rankChartData = topPosts.map((p, i) => ({
    name: `#${i + 1}`,
    likes: p.likes ?? 0,
    replies: p.replies ?? 0,
    reposts: p.reposts ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title={t("分析")}
        description={t("投稿パフォーマンスの確認")}
        actions={
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${period === p.value ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t(p.label)}
              </button>
            ))}
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {summaryCards.map(card => (
          <Card key={card.label} className="border shadow-none">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <span className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${card.bg}`}>
                  <card.icon className={`h-5 w-5 ${card.color}`} strokeWidth={1.8} />
                </span>
                <div>
                  <p className="text-xs text-muted-foreground">{t(card.label)}</p>
                  <p className="text-2xl font-bold tabular-nums">{card.value.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Engagement Overview Chart */}
      <Card className="border shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base font-semibold">{t("エンゲージメント概要")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {barData.map((_, i) => (
                  <Cell key={i} fill={["#ff9800", "#335B82", "#5b7fa4", "#1d3450"][i] ?? "#335B82"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ===== RANKING BOARD ===== */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <span className="h-7 w-7 rounded-lg bg-[var(--brand-accent)]/12 flex items-center justify-center">
              <Trophy className="h-4 w-4 text-[var(--brand-accent-deep)]" strokeWidth={1.8} />
            </span>
            {t(`${PERIODS.find(p => p.value === period)?.label}トップ5ランキング`)}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-5">
          {topPosts.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Trophy className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
              {t("この期間のデータがありません")}
            </div>
          ) : (
            <>
              {/* Ranking Bar Chart */}
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">{t("エンゲージメント比較（横棒グラフ）")}</p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={rankChartData} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fontWeight: 600 }} width={28} />
                    <Tooltip
                      formatter={(value, name) => [value, name === "likes" ? t("いいね") : name === "replies" ? t("返信") : t("リポスト")]}
                    />
                    <Legend
                      formatter={v => v === "likes" ? t("いいね") : v === "replies" ? t("返信") : t("リポスト")}
                      iconSize={10}
                    />
                    <Bar dataKey="likes" name="likes" stackId="a" radius={[0, 0, 0, 0]}>
                      {rankChartData.map((_, i) => <Cell key={i} fill={RANK_COLORS[i] ?? "#335B82"} />)}
                    </Bar>
                    <Bar dataKey="replies" name="replies" fill="#335B82" stackId="a" fillOpacity={0.7} />
                    <Bar dataKey="reposts" name="reposts" fill="#5b7fa4" stackId="a" fillOpacity={0.6} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Ranking List */}
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium">{t("ランキング詳細")}</p>
                <div className="divide-y rounded-lg border overflow-hidden">
                  {topPosts.map((p, i) => (
                    <div key={p.id} className={`flex items-start gap-3 p-3 ${i === 0 ? "bg-[var(--brand-accent)]/6" : ""}`}>
                      {/* Rank badge */}
                      <div className="shrink-0 w-8 pt-0.5">
                        <span className={`h-7 w-7 rounded-full flex items-center justify-center text-sm font-bold tabular-nums ${RANK_BADGES[i] ?? "bg-muted text-muted-foreground"}`}>
                          {i + 1}
                        </span>
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm line-clamp-2 text-foreground leading-snug">{p.content}</p>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--brand-accent)] font-medium">
                            <Heart className="h-3 w-3" fill="currentColor" />{p.likes ?? 0}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs text-blue-500">
                            <MessageCircle className="h-3 w-3" />{p.replies ?? 0}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs text-green-600">
                            <Repeat2 className="h-3 w-3" />{p.reposts ?? 0}
                          </span>
                          {p.postedAt && (
                            <span className="text-xs text-muted-foreground ml-auto">
                              {new Date(p.postedAt).toLocaleDateString(locale)}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Score bar */}
                      <div className="shrink-0 flex flex-col items-end gap-1 w-12">
                        <span className="text-xs font-bold text-[var(--brand-accent)]">
                          {(p.likes ?? 0) + (p.replies ?? 0) + (p.reposts ?? 0)}
                        </span>
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--brand-accent)] transition-all"
                            style={{
                              width: `${Math.min(100, ((p.likes ?? 0) / Math.max(1, topPosts[0]?.likes ?? 1)) * 100)}%`
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
