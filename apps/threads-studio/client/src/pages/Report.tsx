import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Check, ChevronLeft, ChevronRight, Printer, RefreshCw, Save, Send, Sparkles, Target, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import {
  KPI_KEYS, KPI_LABELS, PERCENT_KPIS, type KpiKey, type ReportData, type ReportNarrative, type ReportStatus,
} from "@shared/report";

/**
 * 月次レポート — クライアント提出用。
 *
 * 画面の順序は固定（KPIカード → グラフ → 表 → 投稿 → 成果 → [改ページ] 文章 → 付録）。
 * 「PDFとして保存」はブラウザの印刷ダイアログを開き、印刷CSS（index.css）でナビを隠した
 * A4 レイアウトを出力する。データが無い項目は 0 ではなく「—」で出す。
 */

const NAVY = "#1F4E79";
const GOLD = "#B8860B";
const GREEN = "#9BBB59";
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 数値の表示。null は「—」（0 と区別する） */
function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** 比率の表示。sign=true で +12.3% / −4.0% */
function fmtPct(v: number | null | undefined, { sign = false, digits = 1 }: { sign?: boolean; digits?: number } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (!sign) return `${v < 0 ? "−" : ""}${abs}%`;
  return v > 0 ? `+${abs}%` : v < 0 ? `−${abs}%` : `±0%`;
}
function fmtKpi(key: KpiKey, v: number | null | undefined): string {
  return PERCENT_KPIS.has(key) ? fmtPct(v, { digits: 2 }) : fmtNum(v);
}
/** recharts の Tooltip 用。null は「—」 */
const fmtTooltip = (v: unknown): string => (typeof v === "number" ? v.toLocaleString() : "—");
function fmtYen(cents: number | null): string {
  if (cents === null) return "—";
  return `¥${Math.round(cents / 100).toLocaleString()}`;
}
function monthLabel(ym: string, lang: "ja" | "en"): string {
  const [y, m] = ym.split("-").map(Number);
  return lang === "ja" ? `${y}年${m}月` : new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

const EMPTY_NARRATIVE: ReportNarrative = { summary: "", highlights: [], issues: [], actions: [] };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-base font-semibold mt-2 mb-2 flex items-center gap-2">{children}</h2>;
}

function ReportTable({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`report-table overflow-x-auto rounded-lg border bg-card ${className}`}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
const TH = ({ children, right = false, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <th className={`py-2 px-3 text-xs font-medium text-muted-foreground border-b bg-muted/40 ${right ? "text-right" : "text-left"} ${className}`}>{children}</th>
);
const TD = ({ children, right = false, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={`py-2 px-3 border-b last:border-b-0 ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>
);

export default function Report() {
  const { t, lang, locale } = useI18n();
  const utils = trpc.useUtils();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const key = { year, month };

  const reportQ = trpc.reports.get.useQuery(key);
  const targetsQ = trpc.reports.targets.useQuery(key);
  const { data: settings } = trpc.settings.get.useQuery();
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin";

  const invalidate = () => { utils.reports.get.invalidate(key); utils.reports.targets.invalidate(key); };
  const generateMut = trpc.reports.generate.useMutation({
    onSuccess: (r) => {
      toast.success(t("レポートを生成しました"));
      if (r.narrativeError) toast.warning(t("文章の下書きは作成できませんでした"), { description: r.narrativeError, duration: 10_000 });
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const narrativeMut = trpc.reports.regenerateNarrative.useMutation({
    onSuccess: () => { toast.success(t("文章を作り直しました")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const saveNarrativeMut = trpc.reports.saveNarrative.useMutation({
    onSuccess: () => { toast.success(t("文章を保存しました")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const statusMut = trpc.reports.setStatus.useMutation({
    onSuccess: () => { toast.success(t("ステータスを更新しました")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const targetsMut = trpc.reports.saveTargets.useMutation({
    onSuccess: () => { toast.success(t("目標値を保存しました")); setTargetsOpen(false); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const data: ReportData | undefined = reportQ.data?.data;
  const status: ReportStatus | null = reportQ.data?.status ?? null;
  const saved = reportQ.data?.saved ?? false;
  const locked = status === "sent";
  const aiAvailable = reportQ.data?.aiAvailable ?? false;

  // 文章は画面で編集できる。保存済みの内容が変わったら（再生成など）編集中の内容を置き換える
  const [narrative, setNarrative] = useState<ReportNarrative>(EMPTY_NARRATIVE);
  const [dirty, setDirty] = useState(false);
  const narrativeKey = `${year}-${month}-${reportQ.data?.generatedAt ?? ""}-${JSON.stringify(reportQ.data?.narrative ?? null)}`;
  useEffect(() => {
    setNarrative(reportQ.data?.narrative ?? EMPTY_NARRATIVE);
    setDirty(false);
    // narrativeKey はクエリ結果から導いた値なので、これだけを依存にすれば十分
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrativeKey]);
  const editNarrative = (patch: Partial<ReportNarrative>) => { setNarrative((n) => ({ ...n, ...patch })); setDirty(true); };
  const hasNarrative = !!reportQ.data?.narrative;

  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targetDraft, setTargetDraft] = useState<Record<KpiKey, string>>(() => Object.fromEntries(KPI_KEYS.map((k) => [k, ""])) as Record<KpiKey, string>);
  useEffect(() => {
    if (!targetsQ.data) return;
    setTargetDraft(Object.fromEntries(KPI_KEYS.map((k) => [k, targetsQ.data![k] === null ? "" : String(targetsQ.data![k])])) as Record<KpiKey, string>);
  }, [targetsQ.data]);

  function prevMonth() { if (month === 1) { setYear((y) => y - 1); setMonth(12); } else setMonth((m) => m - 1); }
  function nextMonth() { if (month === 12) { setYear((y) => y + 1); setMonth(1); } else setMonth((m) => m + 1); }

  const brandTitle = settings?.brandName || settings?.accountName || "Threads Studio";
  const periodLabel = monthLabel(`${year}-${String(month).padStart(2, "0")}`, lang);

  const kpiByKey = useMemo(() => Object.fromEntries((data?.kpis ?? []).map((k) => [k.key, k])) as Partial<Record<KpiKey, ReportData["kpis"][number]>>, [data]);
  const views = kpiByKey.views;

  const dailyChart = useMemo(() => (data?.daily ?? []).map((d) => ({
    day: d.date.slice(8), posts: d.posts, views: d.views, followers: d.followers,
  })), [data]);
  const monthlyChart = useMemo(() => (data?.monthly ?? []).map((m) => ({
    label: monthLabel(m.yearMonth, lang).replace(/^\d{4}年/, (y) => `${y.slice(2, 4)}/`), views: m.views, target: m.viewsTarget,
  })), [data, lang]);

  const weekdays = lang === "ja" ? WEEKDAYS_JA : WEEKDAYS_EN;
  const topHeatmap = useMemo(() => [...(data?.heatmap ?? [])].filter((c) => c.avgViews !== null).sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0)).slice(0, 8), [data]);
  const showHeatmap = (data?.byCategory.length ?? 0) <= 1 && (data?.byCampaign.length ?? 0) === 0;

  const statusLabel: Record<ReportStatus, string> = { draft: t("下書き"), reviewed: t("レビュー済"), sent: t("送付済") };

  return (
    <div className="space-y-6 print-report">
      {/* ── ツールバー（印刷には出さない） ── */}
      <div className="print:hidden space-y-3">
        <PageHeader
          eyebrow="Report"
          title={t("月次レポート")}
          description={t("クライアント提出用。集計はこのアカウントのデータだけから作り、文章はAIの下書きを編集して仕上げます。")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="icon" onClick={prevMonth} aria-label={t("前の月")}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="font-display text-sm font-semibold min-w-[110px] text-center tabular-nums">{periodLabel}</span>
              <Button variant="outline" size="icon" onClick={nextMonth} aria-label={t("次の月")}><ChevronRight className="h-4 w-4" /></Button>
              {status ? (
                <Badge variant={status === "sent" ? "default" : status === "reviewed" ? "secondary" : "outline"} className={status === "sent" ? "bg-[#1F4E79] text-white" : ""}>{statusLabel[status]}</Badge>
              ) : (
                <Badge variant="outline">{t("未生成（即席集計）")}</Badge>
              )}
            </div>
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setTargetsOpen(true)}>
            <Target className="h-4 w-4 mr-1.5" />{t("目標")}
          </Button>
          <Button size="sm" disabled={generateMut.isPending || locked} onClick={() => generateMut.mutate({ ...key, withNarrative: true })}
            title={locked ? t("送付済のレポートは再生成できません") : undefined}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${generateMut.isPending ? "animate-spin" : ""}`} />
            {generateMut.isPending ? t("生成中...") : saved ? t("再生成") : t("生成")}
          </Button>
          <Button variant="outline" size="sm" disabled={!saved || locked || !aiAvailable || narrativeMut.isPending} onClick={() => narrativeMut.mutate(key)}
            title={!aiAvailable ? t("AI設定が必要です") : !saved ? t("先にレポートを生成してください") : undefined}>
            <Sparkles className="h-4 w-4 mr-1.5" />{narrativeMut.isPending ? t("作成中...") : t("文章を作り直す")}
          </Button>
          {status === "draft" && (
            <Button variant="outline" size="sm" disabled={statusMut.isPending} onClick={() => statusMut.mutate({ ...key, status: "reviewed" })}>
              <Check className="h-4 w-4 mr-1.5" />{t("レビュー済にする")}
            </Button>
          )}
          {status === "reviewed" && (
            <>
              <Button variant="outline" size="sm" disabled={statusMut.isPending} onClick={() => statusMut.mutate({ ...key, status: "draft" })}>
                <Undo2 className="h-4 w-4 mr-1.5" />{t("下書きに戻す")}
              </Button>
              <Button variant="outline" size="sm" disabled={statusMut.isPending} onClick={() => statusMut.mutate({ ...key, status: "sent" })}>
                <Send className="h-4 w-4 mr-1.5" />{t("送付済にする")}
              </Button>
            </>
          )}
          {status === "sent" && (
            <Button variant="outline" size="sm" disabled={statusMut.isPending} onClick={() => statusMut.mutate({ ...key, status: "reviewed" })}>
              <Undo2 className="h-4 w-4 mr-1.5" />{t("レビュー済に戻す")}
            </Button>
          )}
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" />{t("PDFとして保存")}
          </Button>
        </div>
        {!saved && data && (
          <p className="text-xs text-muted-foreground">{t("この内容は保存されていない即席の集計です。「生成」で保存し、文章の下書きを作ります。")}</p>
        )}
      </div>

      {/* ── 印刷用ヘッダー ── */}
      <div className="hidden print:block border-b pb-3">
        <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Monthly Report</p>
        <h1 className="font-display text-2xl font-semibold mt-1">{brandTitle} — {t("Threads運用レポート")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("対象期間")}: {periodLabel}（{data?.period.from} 〜 {data?.period.to}） / {t("発行日")}: {new Date().toLocaleDateString(locale)}
          {data?.accountName ? ` / ${t("アカウント")}: ${data.accountName}` : ""}
        </p>
      </div>

      {reportQ.isLoading || !data ? (
        <div className="py-16 text-center text-muted-foreground text-sm">{reportQ.isError ? reportQ.error.message : t("読み込み中...")}</div>
      ) : (
        <>
          {/* (1) KPIカード */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 report-section">
            {[
              { color: NAVY, label: t("閲覧数"), value: fmtNum(views?.current), sub: `${t("前月比")} ${fmtPct(views?.pctChange, { sign: true })}` + (views?.previous !== null && views?.previous !== undefined ? `（${t("前月")} ${fmtNum(views.previous)}）` : "") },
              { color: GOLD, label: t("目標値"), value: fmtNum(views?.target), sub: views?.target === null ? t("目標未設定") : t("閲覧数の目標") },
              { color: GREEN, label: t("目標達成率"), value: fmtPct(views?.achievement, { digits: 0 }), sub: views?.achievement === null ? t("目標または実績が無いため算出不可") : t("閲覧数 ÷ 目標値") },
            ].map((c) => (
              <div key={c.label} className="report-card print-color rounded-xl p-4 text-white shadow-none" style={{ backgroundColor: c.color }}>
                <p className="text-xs opacity-90">{c.label}</p>
                <p className="font-display text-3xl font-bold tabular-nums mt-1 leading-none">{c.value}</p>
                <p className="text-xs opacity-90 mt-2">{c.sub}</p>
              </div>
            ))}
          </div>

          {/* (2) グラフ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 report-section">
            <div className="report-card rounded-lg border bg-card p-4">
              <SectionTitle>{t("日次推移")}</SectionTitle>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={dailyChart} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis yAxisId="posts" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis yAxisId="views" orientation="right" tick={{ fontSize: 10 }} width={48} />
                  <YAxis yAxisId="followers" orientation="right" hide domain={["auto", "auto"]} />
                  <Tooltip formatter={fmtTooltip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="posts" dataKey="posts" name={t("投稿数")} fill={NAVY} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  <Line yAxisId="views" type="monotone" dataKey="views" name={t("閲覧数")} stroke={GOLD} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line yAxisId="followers" type="monotone" dataKey="followers" name={t("フォロワー数")} stroke={GREEN} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              {data.daily.every((d) => d.views === null) && <p className="text-[11px] text-muted-foreground mt-1">{t("日次の閲覧数はアカウントインサイトが未取得のため表示していません。")}</p>}
            </div>
            <div className="report-card rounded-lg border bg-card p-4">
              <SectionTitle>{t("月別閲覧数（12か月）")}</SectionTitle>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={monthlyChart} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={fmtTooltip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="views" name={t("閲覧数")} fill={NAVY} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  <Line type="monotone" dataKey="target" name={t("目標")} stroke={GOLD} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* (3) KPI表 */}
          <div className="report-section">
            <SectionTitle>{t("KPI")}</SectionTitle>
            <ReportTable>
              <thead><tr><TH>{t("指標")}</TH><TH right>{t("当月")}</TH><TH right>{t("前月")}</TH><TH right>{t("前月比")}</TH><TH right>{t("目標")}</TH><TH right>{t("達成率")}</TH></tr></thead>
              <tbody>
                {data.kpis.map((k) => (
                  <tr key={k.key}>
                    <TD>{t(KPI_LABELS[k.key])}</TD>
                    <TD right className="font-semibold">{fmtKpi(k.key, k.current)}</TD>
                    <TD right>{fmtKpi(k.key, k.previous)}</TD>
                    <TD right className={k.pctChange !== null && k.pctChange < 0 ? "text-destructive" : ""}>{fmtPct(k.pctChange, { sign: true })}</TD>
                    <TD right>{fmtKpi(k.key, k.target)}</TD>
                    <TD right>{fmtPct(k.achievement, { digits: 0 })}</TD>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>

          {/* (4) 12か月推移表 */}
          <div className="report-section">
            <SectionTitle>{t("12か月の推移")}</SectionTitle>
            <ReportTable>
              <thead><tr><TH>{t("月")}</TH><TH right>{t("投稿数")}</TH><TH right>{t("閲覧数")}</TH><TH right>{t("反応数")}</TH><TH right>{t("反応率")}</TH><TH right>{t("フォロワー純増")}</TH><TH right>{t("リンククリック")}</TH><TH right>{t("コンバージョン")}</TH></tr></thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.yearMonth} className={m.yearMonth === data.yearMonth ? "bg-[#1F4E79]/5 font-medium" : ""}>
                    <TD>{monthLabel(m.yearMonth, lang)}</TD>
                    <TD right>{fmtNum(m.posts)}</TD><TD right>{fmtNum(m.views)}</TD><TD right>{fmtNum(m.engagements)}</TD>
                    <TD right>{fmtPct(m.engagementRate, { digits: 2 })}</TD>
                    <TD right>{m.followerNet === null ? "—" : m.followerNet > 0 ? `+${m.followerNet.toLocaleString()}` : m.followerNet.toLocaleString()}</TD>
                    <TD right>{fmtNum(m.linkClicks)}</TD><TD right>{fmtNum(m.conversions)}</TD>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </div>

          {/* (5) カテゴリー別・キャンペーン別（無ければ曜日×時間帯） */}
          <div className="report-section space-y-4">
            {!showHeatmap ? (
              <>
                {data.byCategory.length > 0 && (
                  <div>
                    <SectionTitle>{t("カテゴリー別")}</SectionTitle>
                    <GroupTable rows={data.byCategory} t={t} />
                  </div>
                )}
                {data.byCampaign.length > 0 && (
                  <div>
                    <SectionTitle>{t("キャンペーン別")}</SectionTitle>
                    <GroupTable rows={data.byCampaign} t={t} />
                  </div>
                )}
              </>
            ) : (
              <div>
                <SectionTitle>{t("曜日×時間帯（平均閲覧の上位）")}</SectionTitle>
                {topHeatmap.length === 0 ? <p className="text-sm text-muted-foreground">{t("反応データのある投稿がありません")}</p> : (
                  <ReportTable>
                    <thead><tr><TH>{t("曜日")}</TH><TH>{t("時間帯")}</TH><TH right>{t("投稿数")}</TH><TH right>{t("平均閲覧")}</TH><TH right>{t("反応率")}</TH></tr></thead>
                    <tbody>
                      {topHeatmap.map((c) => (
                        <tr key={`${c.weekday}-${c.hour}`}>
                          <TD>{weekdays[c.weekday]}</TD><TD>{String(c.hour).padStart(2, "0")}:00</TD>
                          <TD right>{fmtNum(c.posts)}</TD><TD right>{fmtNum(c.avgViews)}</TD><TD right>{fmtPct(c.engagementRate, { digits: 2 })}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </ReportTable>
                )}
              </div>
            )}
          </div>

          {/* (6) 投稿TOP5 / 改善余地 */}
          <div className="report-section space-y-4">
            <div>
              <SectionTitle>{t("投稿 TOP5（反応率順）")}</SectionTitle>
              <PostTable rows={data.topPosts} t={t} locale={locale} empty={t("閲覧50以上の投稿がまだありません")} />
            </div>
            {data.bottomPosts.length > 0 && (
              <div>
                <SectionTitle>{t("改善余地のある投稿 5件")}</SectionTitle>
                <PostTable rows={data.bottomPosts} t={t} locale={locale} empty="" />
              </div>
            )}
          </div>

          {/* (7) ビジネス成果 */}
          <div className="report-section">
            <SectionTitle>{t("ビジネス成果")}</SectionTitle>
            {!data.conversions.trackingEnabled ? (
              <p className="text-sm text-muted-foreground">{t("コンバージョン計測は無効です。")}</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {[[t("リンククリック"), fmtNum(data.conversions.linkClicks)], [t("コンバージョン"), fmtNum(data.conversions.conversions)], [t("成果金額"), fmtYen(data.conversions.valueCents)]].map(([l, v]) => (
                    <div key={l} className="report-card rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-bold tabular-nums mt-0.5">{v}</p></div>
                  ))}
                </div>
                {(data.conversions.byGoal.length > 0 || data.conversions.byCampaign.length > 0) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {[[t("目標別"), data.conversions.byGoal], [t("キャンペーン別"), data.conversions.byCampaign]].map(([label, rows]) => (
                      (rows as ReportData["conversions"]["byGoal"]).length > 0 && (
                        <div key={label as string}>
                          <p className="text-xs font-medium text-muted-foreground mb-1">{label as string}</p>
                          <ReportTable>
                            <thead><tr><TH>{t("名称")}</TH><TH right>{t("リンククリック")}</TH><TH right>{t("コンバージョン")}</TH><TH right>{t("成果金額")}</TH></tr></thead>
                            <tbody>
                              {(rows as ReportData["conversions"]["byGoal"]).map((g) => (
                                <tr key={g.name}><TD>{g.name}</TD><TD right>{fmtNum(g.linkClicks)}</TD><TD right>{fmtNum(g.conversions)}</TD><TD right>{fmtYen(g.valueCents)}</TD></tr>
                              ))}
                            </tbody>
                          </ReportTable>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 改ページ ── (8) 総評・良かった点・課題・次月の施策 */}
          <div className="report-narrative space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <SectionTitle>{t("総評と次月の施策")}</SectionTitle>
              <div className="print:hidden flex items-center gap-2">
                {hasNarrative && !dirty && <span className="text-[11px] text-amber-700">{t("AI下書きです。送付前に内容を確認・編集してください。")}</span>}
                <Button size="sm" variant="outline" disabled={!saved || locked || !dirty || saveNarrativeMut.isPending}
                  onClick={() => saveNarrativeMut.mutate({ ...key, narrative: { ...narrative, highlights: narrative.highlights.filter(Boolean), issues: narrative.issues.filter(Boolean), actions: narrative.actions.filter((a) => a.title.trim() && a.detail.trim()) } })}>
                  <Save className="h-4 w-4 mr-1.5" />{saveNarrativeMut.isPending ? t("保存中...") : t("文章を保存")}
                </Button>
              </div>
            </div>
            {!saved && <p className="print:hidden text-xs text-muted-foreground">{t("文章は「生成」後に編集・保存できます。")}</p>}

            {/* 画面用エディタ */}
            <div className="print:hidden space-y-4">
              <NarrativeField label={t("総評")} value={narrative.summary} rows={5} disabled={!saved || locked} onChange={(v) => editNarrative({ summary: v })} />
              <NarrativeListField label={t("良かった点")} hint={t("1行に1項目")} values={narrative.highlights} disabled={!saved || locked} onChange={(v) => editNarrative({ highlights: v })} />
              <NarrativeListField label={t("課題")} hint={t("1行に1項目")} values={narrative.issues} disabled={!saved || locked} onChange={(v) => editNarrative({ issues: v })} />
              <div className="space-y-2">
                <Label className="text-xs">{t("次月の施策")}</Label>
                {narrative.actions.map((a, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2">
                    <Input value={a.title} disabled={!saved || locked} placeholder={t("見出し")} maxLength={120}
                      onChange={(e) => editNarrative({ actions: narrative.actions.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                    <Textarea rows={2} value={a.detail} disabled={!saved || locked} placeholder={t("何を・どのくらい・なぜ")} maxLength={800} className="text-sm"
                      onChange={(e) => editNarrative({ actions: narrative.actions.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })} />
                    <div className="text-right">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!saved || locked} onClick={() => editNarrative({ actions: narrative.actions.filter((_, j) => j !== i) })}>{t("削除")}</Button>
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!saved || locked || narrative.actions.length >= 8}
                  onClick={() => editNarrative({ actions: [...narrative.actions, { title: "", detail: "" }] })}>{t("施策を追加")}</Button>
              </div>
            </div>

            {/* 印刷用の清書（「AI下書き」の注意書きは出さない） */}
            <div className="hidden print:block space-y-4 text-sm leading-relaxed">
              <div><h3 className="font-semibold mb-1">{t("総評")}</h3><p className="whitespace-pre-wrap">{narrative.summary || "—"}</p></div>
              <div><h3 className="font-semibold mb-1">{t("良かった点")}</h3>{narrative.highlights.filter(Boolean).length ? <ul className="list-disc pl-5">{narrative.highlights.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}</ul> : <p>—</p>}</div>
              <div><h3 className="font-semibold mb-1">{t("課題")}</h3>{narrative.issues.filter(Boolean).length ? <ul className="list-disc pl-5">{narrative.issues.filter(Boolean).map((h, i) => <li key={i}>{h}</li>)}</ul> : <p>—</p>}</div>
              <div><h3 className="font-semibold mb-1">{t("次月の施策")}</h3>{narrative.actions.filter((a) => a.title).length ? <ol className="list-decimal pl-5 space-y-1">{narrative.actions.filter((a) => a.title).map((a, i) => <li key={i}><span className="font-medium">{a.title}</span>{a.detail ? ` — ${a.detail}` : ""}</li>)}</ol> : <p>—</p>}</div>
            </div>
          </div>

          {/* (9) 付録 */}
          <div className="report-section text-xs text-muted-foreground space-y-3 border-t pt-4">
            <div>
              <p className="font-semibold text-foreground mb-1">{t("データ注記")}</p>
              {data.notes.length === 0 ? <p>{t("特記事項はありません。")}</p> : <ul className="list-disc pl-5 space-y-0.5">{data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1">{t("指標の定義")}</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>{t("閲覧数: その月に公開した投稿の閲覧回数の合計（延べ回数。ユニーク人数ではありません）。")}</li>
                <li>{t("反応数: いいね・返信・再投稿・引用・シェアの合計。反応率 = 反応数 ÷ 閲覧数。")}</li>
                <li>{t("フォロワー純増: 月末のフォロワー数 − 前月末のフォロワー数（日次の記録から算出）。")}</li>
                <li>{t("日次推移の閲覧数: アカウント全体の1日あたりの閲覧回数（Threads インサイト）。投稿別の閲覧数とは集計方法が異なります。")}</li>
                <li>{t("投稿 TOP5 / 改善余地: 閲覧50以上の投稿を反応率順に並べたもの。対象が10件未満の月は改善余地を出しません。")}</li>
                <li>{t("リンククリック・コンバージョン: このアプリに登録・連携された成果データの集計。未登録の成果は含みません。")}</li>
                <li>{t("「—」はデータが無い（未取得・未設定・算出不可）ことを示し、0 とは区別しています。")}</li>
                <li>{t("日付の区切りはアカウントのタイムゾーン")}（{data.timezone}）。</li>
              </ul>
            </div>
            <p className="hidden print:block">{t("作成日時")}: {new Date(data.generatedAt).toLocaleString(locale)}</p>
          </div>
        </>
      )}

      {/* 目標値ダイアログ */}
      <Dialog open={targetsOpen} onOpenChange={setTargetsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{periodLabel} {t("の目標値")}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {KPI_KEYS.map((k) => (
              <div key={k} className="grid grid-cols-[1fr_140px] items-center gap-2">
                <Label className="text-sm">{t(KPI_LABELS[k])}{PERCENT_KPIS.has(k) ? " (%)" : ""}</Label>
                <Input type="number" inputMode="decimal" min={0} step={PERCENT_KPIS.has(k) ? 0.1 : 1} value={targetDraft[k]} disabled={!isAdmin}
                  placeholder={t("未設定")} onChange={(e) => setTargetDraft((d) => ({ ...d, [k]: e.target.value }))} />
              </div>
            ))}
            {!isAdmin && <p className="text-xs text-muted-foreground">{t("目標値の変更は管理者のみ行えます。")}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTargetsOpen(false)}>{t("閉じる")}</Button>
            <Button disabled={!isAdmin || targetsMut.isPending}
              onClick={() => targetsMut.mutate({ ...key, targets: Object.fromEntries(KPI_KEYS.map((k) => [k, targetDraft[k].trim() === "" ? null : Number(targetDraft[k])])) as Record<KpiKey, number | null> })}>
              {targetsMut.isPending ? t("保存中...") : t("保存")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GroupTable({ rows, t }: { rows: ReportData["byCategory"]; t: (s: string) => string }) {
  return (
    <ReportTable>
      <thead><tr><TH>{t("名称")}</TH><TH right>{t("投稿数")}</TH><TH right>{t("閲覧数")}</TH><TH right>{t("反応数")}</TH><TH right>{t("反応率")}</TH><TH right>{t("平均閲覧")}</TH></tr></thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.name}>
            <TD>{g.name}</TD><TD right>{fmtNum(g.posts)}</TD><TD right>{fmtNum(g.views)}</TD><TD right>{fmtNum(g.engagements)}</TD>
            <TD right>{fmtPct(g.engagementRate, { digits: 2 })}</TD><TD right>{fmtNum(g.avgViews)}</TD>
          </tr>
        ))}
      </tbody>
    </ReportTable>
  );
}

function PostTable({ rows, t, locale, empty }: { rows: ReportData["topPosts"]; t: (s: string) => string; locale: string; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ReportTable>
      <thead><tr><TH className="w-8">#</TH><TH>{t("投稿")}</TH><TH right>{t("閲覧数")}</TH><TH right>{t("反応数")}</TH><TH right>{t("反応率")}</TH></tr></thead>
      <tbody>
        {rows.map((p, i) => (
          <tr key={p.logId}>
            <TD className="text-muted-foreground tabular-nums">{i + 1}</TD>
            <TD>
              <p className="leading-snug">{p.excerpt}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                {new Date(p.postedAt).toLocaleDateString(locale)} · {t("いいね")} {p.likes} · {t("返信")} {p.replies} · {t("再投稿")} {p.reposts} · {t("引用")} {p.quotes} · {t("シェア")} {p.shares}
              </p>
            </TD>
            <TD right>{fmtNum(p.views)}</TD><TD right>{fmtNum(p.engagements)}</TD><TD right>{fmtPct(p.engagementRate, { digits: 2 })}</TD>
          </tr>
        ))}
      </tbody>
    </ReportTable>
  );
}

function NarrativeField({ label, value, rows, disabled, onChange }: { label: string; value: string; rows: number; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Textarea rows={rows} value={value} disabled={disabled} maxLength={2000} className="text-sm" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function NarrativeListField({ label, hint, values, disabled, onChange }: { label: string; hint: string; values: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label} <span className="text-muted-foreground font-normal">（{hint}）</span></Label>
      <Textarea rows={3} value={values.join("\n")} disabled={disabled} className="text-sm" onChange={(e) => onChange(e.target.value.split("\n").slice(0, 10))} />
    </div>
  );
}
