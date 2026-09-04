import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAccount } from "@/contexts/AccountContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import {
  AlertTriangle, Bookmark, BookmarkCheck, ExternalLink, EyeOff, Flame, Link2, MessageCircle, RefreshCw,
  RotateCcw, Send, Sparkles, Trash2, TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/i18n";
import type { Suggestion } from "@shared/trendLearning";

type Period = "24h" | "7d" | "30d";
const PERIODS: { value: Period; label: string }[] = [
  { value: "24h", label: "24時間" },
  { value: "7d", label: "7日" },
  { value: "30d", label: "30日" },
];

const COMPONENT_LABEL: Record<string, string> = {
  recency: "新しさ",
  velocity: "伸びの速さ",
  replies: "返信の有無",
  keywordGrowth: "キーワードの増加",
  themeFit: "自社テーマとの適合",
};

/** 取れない指標は 0 ではなく「取得不可」と出す */
function Metric({ label, value }: { label: string; value: number | null }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-baseline gap-1 text-xs">
      <span className="text-muted-foreground">{t(label)}</span>
      <span className={value === null ? "text-muted-foreground/70" : "font-semibold tabular-nums"}>
        {value === null ? t("取得不可") : value.toLocaleString()}
      </span>
    </span>
  );
}

function fmtDate(v: Date | string | null | undefined, locale: string) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const ENGAGE_MAX_LENGTH = 500;
type EngagePost = { id: number; hasReplies: boolean | null; summary: string };
type ReplyOption = { id: string; username: string | null; text: string | null };
type EngageTarget = { type: "post" } | { type: "reply"; reply: ReplyOption };

/**
 * トレンドで収集した他アカウントの投稿へコメントするための入力欄。
 * 投稿本体、またはその投稿についた返信（他人のコメント）のどちらかを選べる。
 * AIは案を1つ作るだけで、送信は必ずここの「送信」ボタンを押した時だけ行われる。
 */
function EngagementBox({ post, onClose }: { post: EngagePost; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [target, setTarget] = useState<EngageTarget>({ type: "post" });
  const [content, setContent] = useState("");
  const [showReplies, setShowReplies] = useState(false);

  const repliesQ = trpc.engagement.listReplies.useQuery({ trendPostId: post.id }, { enabled: showReplies });
  const countQ = trpc.engagement.countForTarget.useQuery({ trendPostId: post.id });
  const suggestMut = trpc.engagement.suggestComment.useMutation({
    onSuccess: (d) => setContent(d.comment),
    onError: (e) => toast.error(e.message),
  });
  const sendMut = trpc.engagement.send.useMutation({
    onSuccess: () => {
      toast.success(t("コメントを送信しました"));
      utils.engagement.countForTarget.invalidate({ trendPostId: post.id });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function suggest() {
    if (target.type === "post") {
      suggestMut.mutate({ trendPostId: post.id, targetType: "post" });
    } else {
      suggestMut.mutate({
        trendPostId: post.id, targetType: "reply",
        replyText: target.reply.text ?? "", replyUsername: target.reply.username ?? undefined,
      });
    }
  }

  function send() {
    const trimmed = content.trim();
    if (!trimmed) return;
    if (target.type === "post") {
      sendMut.mutate({ trendPostId: post.id, targetType: "post", content: trimmed });
    } else {
      sendMut.mutate({
        trendPostId: post.id, targetType: "reply", targetExternalId: target.reply.id,
        targetUsername: target.reply.username ?? undefined, targetSummary: (target.reply.text ?? "").slice(0, 255),
        content: trimmed,
      });
    }
  }

  return (
    <div className="space-y-2.5 pt-2.5 mt-2 border-t">
      {!!countQ.data && (
        <p className="text-[11px] text-amber-700">
          {t("この投稿には既に")}{countQ.data}{t("件コメント済みです")}
        </p>
      )}
      {post.hasReplies && (
        <div className="space-y-1.5">
          {!showReplies ? (
            <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => setShowReplies(true)}>
              {t("この投稿についた返信を見て、返信にコメントする")}
            </Button>
          ) : repliesQ.isLoading ? (
            <p className="text-xs text-muted-foreground">{t("読み込み中...")}</p>
          ) : repliesQ.data && !repliesQ.data.available ? (
            <p className="text-xs text-muted-foreground">{repliesQ.data.errorMessage ?? t("返信を取得できませんでした")}</p>
          ) : repliesQ.data && repliesQ.data.replies.length > 0 ? (
            <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
              <p className="text-[11px] text-muted-foreground">{t("コメント先を選んでください")}:</p>
              <button
                type="button"
                className={`w-full text-left rounded-md border px-2 py-1 text-xs ${target.type === "post" ? "border-[var(--brand-accent)] bg-[var(--brand-accent)]/5" : ""}`}
                onClick={() => setTarget({ type: "post" })}
              >
                {t("投稿本体にコメント")}
              </button>
              {repliesQ.data.replies.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`w-full text-left rounded-md border px-2 py-1 text-xs ${target.type === "reply" && target.reply.id === r.id ? "border-[var(--brand-accent)] bg-[var(--brand-accent)]/5" : ""}`}
                  onClick={() => setTarget({ type: "reply", reply: r })}
                >
                  <span className="font-medium">@{r.username ?? t("不明なユーザー")}</span>: {r.text}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("返信はまだありません")}</p>
          )}
        </div>
      )}

      <Textarea
        rows={2} value={content} maxLength={ENGAGE_MAX_LENGTH}
        placeholder={t("コメントを入力...")}
        onChange={(e) => setContent(e.target.value)}
        className="resize-none text-sm"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground tabular-nums">{content.length}/{ENGAGE_MAX_LENGTH}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={suggestMut.isPending} onClick={suggest}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />{suggestMut.isPending ? t("作成中...") : t("AIで下書きを作る")}
          </Button>
          <Button size="sm" className="h-7 text-xs" disabled={!content.trim() || sendMut.isPending} onClick={send}>
            <Send className="h-3.5 w-3.5 mr-1.5" />{sendMut.isPending ? t("送信中...") : t("送信")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Trends() {
  const { t, lang, locale } = useI18n();
  const [, setLocation] = useLocation();
  const { current: currentAccount } = useAccount();
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin";
  const utils = trpc.useUtils();

  const [period, setPeriod] = useState<Period>("7d");
  const [status, setStatus] = useState<"all" | "active" | "saved" | "excluded">("all");
  const [platform, setPlatform] = useState<"all" | "threads" | "instagram">("all");
  const [refUrl, setRefUrl] = useState("");
  const [refNote, setRefNote] = useState("");
  const [engageOpenId, setEngageOpenId] = useState<number | null>(null);

  const listQ = trpc.trends.list.useQuery({
    period, status, platform: platform === "all" ? undefined : platform,
  });
  const analysisQ = trpc.trends.latestAnalysis.useQuery({ period });
  const recQ = trpc.trends.recommendations.useQuery({ days: 7 });

  const invalidate = () => { utils.trends.list.invalidate(); utils.trends.latestAnalysis.invalidate(); };
  const fetchMut = trpc.trends.fetchNow.useMutation({
    onSuccess: (d) => {
      const failed = d.errors.length;
      if (failed === 0) toast.success(`${d.stored}${t("件を取得しました")}`);
      else {
        const worst = ["auth", "permission", "rate_limited", "network", "unknown"].find((k) => d.errors.some((e) => e.kind === k)) ?? "unknown";
        toast.warning(`${d.stored}${t("件を取得しました")} / ${failed}${t("件のキーワードで失敗")}`, {
          description: t(ERROR_LABEL[worst]), duration: 10_000,
        });
      }
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const analyzeMut = trpc.trends.analyze.useMutation({
    onSuccess: () => { toast.success(t("傾向を分析しました")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const statusMut = trpc.trends.setStatus.useMutation({
    onSuccess: () => utils.trends.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const addRefMut = trpc.trends.addReference.useMutation({
    onSuccess: () => { toast.success(t("参考URLを登録しました")); setRefUrl(""); setRefNote(""); utils.trends.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const analysis = analysisQ.data ?? null;
  const posts = listQ.data?.posts ?? [];
  const aiAvailable = listQ.data?.aiAvailable ?? false;

  /** 原稿作成へ。分析IDとテーマをクエリで渡し、投稿原稿画面のAIダイアログを開く */
  function makeDraft(topic: string) {
    if (!analysis) { toast.error(t("先に「AIで分析」を実行してください")); return; }
    const q = new URLSearchParams({ ai: "1", trend: String(analysis.analysisId), period, topic: topic.slice(0, 300) });
    setLocation(`/posts?${q.toString()}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Research"
        title={t("トレンド")}
        description={currentAccount ? `${currentAccount.name} — ${t("このアカウントの検索条件と収集データだけを表示します")}` : t("Threads / Instagram の話題を収集して、原稿づくりに活かします")}
        actions={
          <>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${fetchMut.isPending ? "animate-spin" : ""}`} />
                {fetchMut.isPending ? t("取得中...") : t("今すぐ取得")}
              </Button>
            )}
            <Button size="sm" onClick={() => analyzeMut.mutate({ period })} disabled={analyzeMut.isPending || !aiAvailable}
              title={aiAvailable ? undefined : t("AI設定が必要です")}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              {analyzeMut.isPending ? t("分析中...") : t("AIで分析")}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5">
          {PERIODS.map((p) => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${period === p.value ? "bg-[var(--brand-accent)] text-white" : "text-muted-foreground hover:text-foreground"}`}>
              {t(p.label)}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {t("最終取得")}: {fmtDate(listQ.data?.lastFetchAt, locale)}
          {listQ.data && listQ.data.keywordCount === 0 && (
            <> · <button className="underline" onClick={() => setLocation("/settings")}>{t("設定でキーワードを登録してください")}</button></>
          )}
          {listQ.data && !listQ.data.autoFetch && <> · {t("自動取得は停止中")}</>}
        </span>
      </div>

      {listQ.data?.lastFetchError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
          <div className="space-y-1.5">
            <p className="font-medium">{t("前回の取得に失敗しました")}</p>
            <p className="text-xs text-muted-foreground">{t(ERROR_LABEL[listQ.data.lastFetchError] ?? ERROR_LABEL.unknown)}</p>
            {NEEDS_RECONNECT.has(listQ.data.lastFetchError) && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setLocation("/settings")}>
                {t("設定画面で再接続する")}
              </Button>
            )}
          </div>
        </div>
      )}

      <Tabs defaultValue="posts">
        <TabsList>
          <TabsTrigger value="posts">{t("収集した投稿")}</TabsTrigger>
          <TabsTrigger value="analysis">{t("傾向分析")}</TabsTrigger>
          <TabsTrigger value="recommend">{t("おすすめ")}</TabsTrigger>
        </TabsList>

        {/* ── 投稿 ── */}
        <TabsContent value="posts" className="space-y-4 mt-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            {t("「コメントする」では他アカウントの投稿へ公開コメントを送れます。AIが作るのは下書きの案だけで、実際にThreadsへ送るのは「送信」を押した時だけです。")}
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">{t("表示")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("すべて")}</SelectItem>
                  <SelectItem value="active">{t("未整理")}</SelectItem>
                  <SelectItem value="saved">{t("保存済み")}</SelectItem>
                  <SelectItem value="excluded">{t("除外")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("プラットフォーム")}</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as typeof platform)}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("すべて")}</SelectItem>
                  <SelectItem value="threads">Threads</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <span className="text-xs text-muted-foreground ml-auto">{posts.length}{t("件")}</span>
          </div>

          {listQ.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("読み込み中...")}</p>
          ) : posts.length === 0 ? (
            <Card className="border shadow-none"><CardContent className="py-10 text-center text-sm text-muted-foreground">
              {t("この期間の投稿はまだありません。設定でキーワードを登録し、「今すぐ取得」を実行してください。")}
            </CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {posts.map((p) => (
                <Card key={p.id} className={`border shadow-none ${p.status === "deleted" ? "opacity-70" : ""}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-[var(--brand-accent)]/12 text-[var(--brand-accent-deep)] font-bold tabular-nums text-sm" title={t("話題性スコア（0〜100）")}>
                          {p.score}
                        </span>
                        {p.isRising && <Badge className="bg-[#047857] text-white gap-1"><Flame className="h-3 w-3" />{t("急上昇")}</Badge>}
                        <Badge variant="outline">{p.platform === "threads" ? "Threads" : "Instagram"}</Badge>
                        {p.status === "saved" && <Badge variant="secondary">{t("保存済み")}</Badge>}
                        {p.status === "excluded" && <Badge variant="secondary">{t("除外")}</Badge>}
                        {p.status === "deleted" && <Badge variant="destructive" className="gap-1"><Trash2 className="h-3 w-3" />{t("元の投稿は削除されています")}</Badge>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {p.status !== "saved" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title={t("保存")} onClick={() => statusMut.mutate({ id: p.id, status: "saved" })}>
                            <Bookmark className="h-4 w-4" />
                          </Button>
                        )}
                        {p.status === "saved" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title={t("保存を解除")} onClick={() => statusMut.mutate({ id: p.id, status: "active" })}>
                            <BookmarkCheck className="h-4 w-4 text-[var(--brand-accent-deep)]" />
                          </Button>
                        )}
                        {p.status !== "excluded" ? (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title={t("除外")} onClick={() => statusMut.mutate({ id: p.id, status: "excluded" })}>
                            <EyeOff className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title={t("除外を解除")} onClick={() => statusMut.mutate({ id: p.id, status: "active" })}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {p.summary || <span className="text-muted-foreground">{t("本文は取得していません（URLから確認してください）")}</span>}
                    </p>

                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <Metric label="いいね" value={p.likes} />
                      <Metric label="返信" value={p.replies} />
                      <Metric label="再投稿" value={p.reposts} />
                      <Metric label="閲覧" value={p.views} />
                      {p.platform === "instagram" && <Metric label="保存" value={p.saves} />}
                      {p.hasReplies !== null && (
                        <span className="text-xs text-muted-foreground">{p.hasReplies ? t("返信あり") : t("返信なし")}</span>
                      )}
                    </div>

                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">{t("スコアの内訳")}</summary>
                      <ul className="mt-1.5 space-y-0.5">
                        {p.scoreBreakdown.map((c: { key: string; points: number; max: number; available: boolean; reason: string }) => (
                          <li key={c.key} className="flex justify-between gap-2">
                            <span>{t(COMPONENT_LABEL[c.key] ?? c.key)}</span>
                            <span className={c.available ? "tabular-nums" : "text-muted-foreground/70"}>
                              {c.available ? `${c.points}/${c.max}` : t("取得不可")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>

                    {p.aiReason && (
                      <div className="rounded-md bg-muted/50 border p-2.5 text-xs space-y-1">
                        <p><span className="font-medium">{t("伸びた理由（AI）")}:</span> {p.aiReason}</p>
                        {p.aiIdeas.length > 0 && (
                          <ul className="list-disc pl-4">{p.aiIdeas.map((i, k) => <li key={k}>{i}</li>)}</ul>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">
                        {p.username ? `@${p.username} · ` : ""}{p.keyword ? `${t("キーワード")}: ${p.keyword} · ` : ""}
                        {t("投稿")}: {fmtDate(p.postedAt, locale)} · {t("取得")}: {fmtDate(p.fetchedAt, locale)}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        {p.permalink && (
                          <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                            <ExternalLink className="h-3 w-3" />{t("出典")}
                          </a>
                        )}
                        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2"
                          onClick={() => makeDraft(p.aiIdeas[0] ?? p.keyword ?? p.summary.slice(0, 80))}>
                          {t("この傾向から原稿を作る")}
                        </Button>
                        {p.platform === "threads" && p.status !== "deleted" && (
                          <Button size="sm" variant="outline" className="h-6 text-[11px] px-2"
                            onClick={() => setEngageOpenId(engageOpenId === p.id ? null : p.id)}>
                            <MessageCircle className="h-3 w-3 mr-1" />{t("コメントする")}
                          </Button>
                        )}
                      </div>
                    </div>

                    {engageOpenId === p.id && (
                      <EngagementBox post={p} onClose={() => setEngageOpenId(null)} />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card className="border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><Link2 className="h-4 w-4" />{t("参考URLを登録")}</CardTitle>
              <CardDescription className="text-xs">
                {t("Threads / Instagram の公開投稿URLを手動で登録します。Instagram の本文・反応数は公式API連携が無いため取得しません（「取得不可」と表示）。")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-2">
              <Input placeholder="https://www.threads.net/@user/post/..." value={refUrl} onChange={(e) => setRefUrl(e.target.value)} className="flex-1" />
              <Input placeholder={t("メモ（任意・140文字まで）")} value={refNote} maxLength={140} onChange={(e) => setRefNote(e.target.value)} className="flex-1" />
              <Button variant="outline" disabled={!refUrl.trim() || addRefMut.isPending} onClick={() => addRefMut.mutate({ url: refUrl, note: refNote || undefined })}>
                {t("登録")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── 分析 ── */}
        <TabsContent value="analysis" className="space-y-4 mt-4">
          {!analysis ? (
            <Card className="border shadow-none"><CardContent className="py-10 text-center text-sm text-muted-foreground">
              {aiAvailable ? t("まだ分析がありません。「AIで分析」を実行してください。") : t("AI設定が必要です。収集・保存・除外はAIなしでも利用できます。")}
            </CardContent></Card>
          ) : (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>{t("AIの分析は推測を含みます。数字・事実・固有名詞は必ず元の投稿で確認してください。他人の文章をそのまま使うことは避けてください。")}</p>
              </div>
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{t("分析日時")}: {fmtDate(analysis.createdAt, locale)} · {t("対象")}: {analysis.postCount}{t("件")}</span>
                <Button size="sm" onClick={() => makeDraft(analysis.result.themes[0] ?? "")}>
                  <TrendingUp className="h-4 w-4 mr-1.5" />{t("この傾向から原稿を作る")}
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {([
                  ["伸びているテーマ", analysis.result.themes],
                  ["よく使われる冒頭の型", analysis.result.hooks],
                  ["文章構成", analysis.result.structures],
                  ["問いかけの型", analysis.result.questions],
                  ["キーワード・ハッシュタグ", analysis.result.keywords],
                  ["自社で使える切り口", analysis.result.angles],
                  ["注意点・リスク", analysis.result.risks],
                ] as [string, string[]][]).map(([label, items]) => (
                  <Card key={label} className="border shadow-none">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t(label)}</CardTitle></CardHeader>
                    <CardContent>
                      {items.length === 0 ? <p className="text-xs text-muted-foreground">{t("不明")}</p> : (
                        <ul className="list-disc pl-4 text-sm space-y-1">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
                      )}
                    </CardContent>
                  </Card>
                ))}
                <Card className="border shadow-none">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t("語調")}</CardTitle></CardHeader>
                  <CardContent><p className="text-sm">{analysis.result.tone || t("不明")}</p></CardContent>
                </Card>
                <Card className="border shadow-none">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t("地域差")}</CardTitle></CardHeader>
                  <CardContent><p className="text-sm">{analysis.result.regionalDifference || t("不明")}</p></CardContent>
                </Card>
                <Card className="border shadow-none">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t("継続性")}</CardTitle></CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <Badge variant="outline">
                      {analysis.result.durability === "fad" ? t("一時的な流行") : analysis.result.durability === "ongoing" ? t("継続する傾向") : t("不明")}
                    </Badge>
                    {analysis.result.durabilityReason && <p className="text-xs text-muted-foreground">{analysis.result.durabilityReason}</p>}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── おすすめ（学習サイクル） ── */}
        <TabsContent value="recommend" className="space-y-4 mt-4">
          {!recQ.data ? (
            <p className="text-sm text-muted-foreground">{t("読み込み中...")}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t("直近7日の投稿成果から、トレンド反映の原稿とそれ以外を同じ指標で比べます。分析値の無い投稿は平均に含めません。")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {([["トレンド反映", recQ.data.trend], ["トレンド未反映", recQ.data.other]] as const).map(([label, g]) => (
                  <Card key={label} className="border shadow-none">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t(label)}</CardTitle></CardHeader>
                    <CardContent className="grid grid-cols-2 gap-2 text-sm">
                      <div><p className="text-xs text-muted-foreground">{t("投稿数")}</p><p className="font-semibold tabular-nums">{g.posts}<span className="text-xs text-muted-foreground font-normal"> ({t("分析あり")} {g.measured})</span></p></div>
                      <div><p className="text-xs text-muted-foreground">{t("平均閲覧")}</p><p className="font-semibold tabular-nums">{g.avgViews === null ? t("未取得") : g.avgViews.toLocaleString()}</p></div>
                      <div><p className="text-xs text-muted-foreground">{t("平均エンゲージメント")}</p><p className="font-semibold tabular-nums">{g.avgEngagement === null ? t("未取得") : g.avgEngagement.toLocaleString()}</p></div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="border shadow-none">
                <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t("次に試すこと")}</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-sm">
                    {recQ.data.suggestions.map((s, i) => <li key={i} className="flex gap-2"><span aria-hidden>•</span><span>{suggestionText(s, lang)}</span></li>)}
                  </ul>
                </CardContent>
              </Card>

              {recQ.data.byHour.some((h) => h.avgEngagement !== null) && (
                <Card className="border shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">{t("時間帯別の平均エンゲージメント")}</CardTitle>
                    <CardDescription className="text-xs">{t("投稿枠のタイムゾーン")}: {recQ.data.timezone}</CardDescription>
                  </CardHeader>
                  <CardContent className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={recQ.data.byHour.map((h) => ({ hour: `${h.hour}:00`, avg: h.avgEngagement ?? 0, posts: h.posts }))}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip formatter={(v: number) => [v, t("平均エンゲージメント")]} />
                        <Bar dataKey="avg" fill="#335B82" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {recQ.data.byTheme.length > 0 && (
                <Card className="border shadow-none">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{t("参考にした傾向ごとの成果")}</CardTitle></CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground"><tr><th className="text-left font-normal">{t("傾向")}</th><th className="text-right font-normal">{t("投稿数")}</th><th className="text-right font-normal">{t("平均エンゲージメント")}</th></tr></thead>
                      <tbody>
                        {recQ.data.byTheme.map((th) => (
                          <tr key={th.theme} className="border-t"><td className="py-1.5">{th.theme}</td><td className="text-right tabular-nums">{th.posts}</td><td className="text-right tabular-nums">{th.avgEngagement === null ? t("未取得") : th.avgEngagement}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** 失敗種別ごとの案内。専門用語だけで終わらせず、次に何をすればよいかを書く */
const ERROR_LABEL: Record<string, string> = {
  auth: "Threads の認証が切れています。設定画面の「アカウントを追加」から同じ表示名で連携リンクを発行し、このアカウントで再接続してください。",
  permission: "検索の権限（threads_keyword_search）がありません。設定画面の「アカウントを追加」から同じ表示名で連携リンクを発行し、このアカウントで再接続すると付与されます。",
  rate_limited: "Threads の検索回数の上限に達しました。次回の自動取得（15分後以降）で再試行します。キーワード数や取得回数を減らすと発生しにくくなります。",
  network: "Threads に接続できませんでした。しばらくしてからもう一度お試しください。",
  unknown: "取得に失敗しました。時間をおいて再度お試しください。続く場合は担当者にご連絡ください。",
};
const NEEDS_RECONNECT = new Set(["auth", "permission"]);

/** 数値を含む提案文。翻訳キーにできないため言語で分岐する */
function suggestionText(s: Suggestion, lang: "ja" | "en"): string {
  const en = lang === "en";
  switch (s.kind) {
    case "not_enough_data":
      return en ? `Only ${s.posts} post(s) in the period — need at least 3 to compare.` : `期間内の投稿が${s.posts}件のため、まだ比較できません（3件以上で表示）。`;
    case "no_analytics":
      return en ? `${s.posts} post(s), but no insights yet. Run "Refresh" on Analytics.` : `投稿は${s.posts}件ありますが、分析値が未取得です。分析ページで「更新」を実行してください。`;
    case "trend_vs_other":
      return en
        ? `Trend-informed posts averaged ${s.trendAvg} engagement (n=${s.trendN}) vs ${s.otherAvg} for others (n=${s.otherN}) — ×${s.ratio}.`
        : `トレンド反映の原稿は平均${s.trendAvg}（${s.trendN}件）、未反映は平均${s.otherAvg}（${s.otherN}件）。${s.ratio}倍です。`;
    case "best_hour":
      return en ? `Posts around ${s.hour}:00 averaged ${s.avg} engagement (n=${s.posts}).` : `${s.hour}時台の投稿が平均${s.avg}（${s.posts}件）で最も反応が高い時間帯です。`;
    case "top_theme":
      return en ? `"${s.theme}" performed best: ${s.avg} avg engagement over ${s.posts} posts.` : `「${s.theme}」を参考にした原稿が平均${s.avg}（${s.posts}件）で最も成果が出ています。`;
    case "next_theme":
      return en ? `Next: write one more post using "${s.theme}" and compare against the ${s.posts} existing ones.` : `次は「${s.theme}」の切り口でもう1本書き、既存${s.posts}件と比べてみてください。`;
  }
}
