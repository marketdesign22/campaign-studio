import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ChevronLeft, ChevronRight, Printer, RefreshCw, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";

/**
 * 月次レポート — クライアント報告用。
 * 「PDFとして保存」はブラウザの印刷ダイアログを開き、印刷CSSで
 * ナビゲーションを隠した清書レイアウトを出力する。
 */
export default function Report() {
  const { t, lang, locale } = useI18n();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data: report, isLoading } = trpc.analytics.monthlyReport.useQuery({ year, month });
  const { data: settings } = trpc.settings.get.useQuery();
  const refreshMut = trpc.analytics.refreshNow.useMutation({
    onSuccess: () => { toast.success(t("最新の分析データを取得しました")); utils.analytics.monthlyReport.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const utils = trpc.useUtils();

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); }

  const totals = report?.totals ?? { posts: 0, errors: 0, likes: 0, replies: 0, reposts: 0, views: 0 };
  const engagementRate = totals.views > 0
    ? (((totals.likes + totals.replies + totals.reposts) / totals.views) * 100).toFixed(2)
    : "0.00";
  const brandTitle = settings?.brandName || "SCSU Threads";

  const postKey = t("投稿数");
  const errorKey = t("エラー");
  const chartData = (report?.byDay ?? []).map(d => ({
    date: d.date.slice(8),
    [postKey]: d.posts,
    [errorKey]: d.errors,
  }));

  const kpis = [
    { label: t("投稿数"), value: totals.posts.toLocaleString() },
    { label: t("総ビュー"), value: totals.views.toLocaleString() },
    { label: t("いいね"), value: totals.likes.toLocaleString() },
    { label: t("返信"), value: totals.replies.toLocaleString() },
    { label: t("リポスト"), value: totals.reposts.toLocaleString() },
    { label: t("エンゲージメント率"), value: `${engagementRate}%` },
  ];

  return (
    <div className="space-y-6 print-report">
      <div className="print:hidden">
        <PageHeader
          eyebrow="Report"
          title={t("月次レポート")}
          description={t("クライアント報告用のサマリー。印刷からPDF保存できます。")}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="font-display text-sm font-semibold min-w-[110px] text-center tabular-nums">{lang === "ja" ? `${year}年 ${month}月` : new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
              <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" disabled={refreshMut.isPending} onClick={() => refreshMut.mutate()}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshMut.isPending ? "animate-spin" : ""}`} />{t("最新化")}
              </Button>
              <Button size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1.5" />{t("PDFとして保存")}
              </Button>
            </div>
          }
        />
      </div>

      {/* Print-only report header */}
      <div className="hidden print:block border-b pb-4">
        <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground">Monthly Report</p>
        <h1 className="font-display text-2xl font-semibold mt-1">{brandTitle} — {t("Threads運用レポート")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("対象期間")}: {lang === "ja" ? `${year}年${month}月` : new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })} / {t("発行日")}: {new Date().toLocaleDateString(locale)}
        </p>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">{t("読み込み中...")}</div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {kpis.map(k => (
              <Card key={k.label} className="border shadow-none">
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className="text-2xl font-bold tabular-nums mt-1">{k.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Daily activity */}
          <Card className="border shadow-none">
            <CardContent className="pt-5">
              <p className="font-display text-sm font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />{t("日別投稿数")}
              </p>
              {chartData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">{t("この月の投稿はありません")}</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey={postKey} stackId="a" fill="#335B82" radius={[3, 3, 0, 0]} />
                    <Bar dataKey={errorKey} stackId="a" fill="#c0392b" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Top posts table */}
          <Card className="border shadow-none">
            <CardContent className="pt-5">
              <p className="font-display text-sm font-semibold mb-3">{t("エンゲージメント上位投稿")}</p>
              {(report?.topPosts ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">{t("データがありません")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="text-left font-medium py-2 pr-3 w-8">#</th>
                        <th className="text-left font-medium py-2 pr-3">{t("投稿内容")}</th>
                        <th className="text-right font-medium py-2 px-2">{t("いいね")}</th>
                        <th className="text-right font-medium py-2 px-2">{t("返信")}</th>
                        <th className="text-right font-medium py-2 px-2">{t("リポスト")}</th>
                        <th className="text-right font-medium py-2 pl-2">{t("ビュー")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(report?.topPosts ?? []).map((p, i) => (
                        <tr key={p.id}>
                          <td className="py-2.5 pr-3 text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="py-2.5 pr-3">
                            <p className="line-clamp-2 leading-snug">{p.content}</p>
                            {p.postedAt && (
                              <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                                {new Date(p.postedAt).toLocaleDateString(locale)}
                              </p>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-right tabular-nums">{(p.likes ?? 0).toLocaleString()}</td>
                          <td className="py-2.5 px-2 text-right tabular-nums">{(p.replies ?? 0).toLocaleString()}</td>
                          <td className="py-2.5 px-2 text-right tabular-nums">{(p.reposts ?? 0).toLocaleString()}</td>
                          <td className="py-2.5 pl-2 text-right tabular-nums">{(p.views ?? 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {totals.errors > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("※ この月に")}{totals.errors} {t("件の投稿エラーが発生しました。詳細は投稿履歴をご確認ください。")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
