import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAccount } from "@/contexts/AccountContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, Check, ExternalLink, RefreshCw, Send, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/i18n";

/** 失敗種別ごとの案内。専門用語だけで終わらせず、次に何をすればよいかを書く */
const ERROR_LABEL: Record<string, string> = {
  auth: "Threadsの認証が切れています。設定画面の「アカウントを追加」から同じ表示名で連携リンクを発行し、このアカウントで再接続してください。",
  permission: "返信の閲覧・送信の権限がありません。設定画面の「アカウントを追加」から同じ表示名で連携リンクを発行し、このアカウントで再接続すると付与されます。",
  rate_limited: "Threadsの利用制限に達しました。しばらく待ってからお試しください。",
  network: "Threadsに接続できませんでした。しばらくしてからもう一度お試しください。",
  unknown: "取得に失敗しました。時間をおいて再度お試しください。",
};
const NEEDS_RECONNECT = new Set(["auth", "permission"]);

function fmtDate(v: Date | string | null | undefined, locale: string) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ReplyBox({
  replyId, maxLength, onSent, initialContent = "",
}: {
  replyId: number;
  maxLength: number;
  onSent: () => void;
  initialContent?: string;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState(initialContent);
  const sendMut = trpc.replies.reply.useMutation({
    onSuccess: () => { toast.success(t("返信を送信しました")); setContent(""); onSent(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-1.5 pt-1">
      <Textarea
        rows={2} value={content} maxLength={maxLength}
        placeholder={t("返信を入力...")}
        onChange={(e) => setContent(e.target.value)}
        className="resize-none text-sm"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground tabular-nums">{content.length}/{maxLength}</span>
        <Button size="sm" className="h-7 text-xs" disabled={!content.trim() || sendMut.isPending}
          onClick={() => sendMut.mutate({ id: replyId, content: content.trim() })}>
          <Send className="h-3.5 w-3.5 mr-1.5" />
          {sendMut.isPending ? t("送信中...") : t("送信")}
        </Button>
      </div>
    </div>
  );
}

export default function Inbox() {
  const { t, locale } = useI18n();
  const [, setLocation] = useLocation();
  const { current: currentAccount } = useAccount();
  const { data: me } = trpc.auth.me.useQuery();
  const isAdmin = me?.role === "admin";
  const utils = trpc.useUtils();

  const [status, setStatus] = useState<"all" | "unread" | "read" | "replied">("all");
  const [openReplyId, setOpenReplyId] = useState<number | null>(null);

  const listQ = trpc.replies.list.useQuery({ status });
  const invalidate = () => { utils.replies.list.invalidate(); utils.replies.unreadCount.invalidate(); };

  const fetchMut = trpc.replies.fetchNow.useMutation({
    onSuccess: (d) => { toast.success(`${d.stored}${t("件を取得しました")}`); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const markReadMut = trpc.replies.markRead.useMutation({ onSuccess: () => invalidate(), onError: (e) => toast.error(e.message) });
  /** テンプレート提案を「この内容で送信」で使う。これも通常の返信送信と同じAPIを通る（自動送信はしない） */
  const quickSendMut = trpc.replies.reply.useMutation({
    onSuccess: () => { toast.success(t("返信を送信しました")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const replies = listQ.data?.replies ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Engagement"
        title={t("受信箱")}
        description={currentAccount ? `${currentAccount.name} — ${t("このアカウントの返信だけを表示します")}` : t("自社投稿についた返信の閲覧・返信")}
        actions={isAdmin && (
          <Button variant="outline" size="sm" onClick={() => fetchMut.mutate()} disabled={fetchMut.isPending}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${fetchMut.isPending ? "animate-spin" : ""}`} />
            {fetchMut.isPending ? t("取得中...") : t("今すぐ取得")}
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5">
          {([["all", "すべて"], ["unread", "未読"], ["read", "既読"], ["replied", "返信済み"]] as const).map(([value, label]) => (
            <button key={value} onClick={() => setStatus(value)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${status === value ? "bg-[var(--brand-accent)] text-white" : "text-muted-foreground hover:text-foreground"}`}>
              {t(label)}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {t("最終取得")}: {fmtDate(listQ.data?.lastFetchAt, locale)}
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

      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t("ダイレクトメッセージ（DM）はThreadsの公式APIが公開されていないため対応していません。ここに出るのは自社投稿への公開返信のみです。")}
      </div>

      {listQ.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("読み込み中...")}</p>
      ) : replies.length === 0 ? (
        <Card className="border shadow-none"><CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("返信はまだありません。")}
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {replies.map((r) => (
            <Card key={r.id} className="border shadow-none">
              <CardContent className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-medium text-sm truncate">{r.username ? `@${r.username}` : t("不明なユーザー")}</span>
                    {r.status === "unread" && <Badge className="bg-[var(--brand-accent)] text-white">{t("未読")}</Badge>}
                    {r.status === "replied" && <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" />{t("返信済み")}</Badge>}
                    {r.hideStatus && r.hideStatus !== "NOT_HUSHED" && <Badge variant="outline">{t("非表示")}</Badge>}
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">{fmtDate(r.postedAt, locale)}</span>
                </div>

                <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.text}</p>

                {r.suggestedReply && (
                  <div className="rounded-md border border-[var(--brand-accent)]/30 bg-[var(--brand-accent)]/5 p-2.5 text-xs space-y-2">
                    <p className="font-medium flex items-center gap-1 text-[var(--brand-accent-deep)]">
                      <Sparkles className="h-3 w-3" />{t("キーワードに一致するテンプレートがあります")}
                    </p>
                    <p className="whitespace-pre-wrap">{r.suggestedReply}</p>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => setOpenReplyId(r.id)}>
                        {t("編集して送信")}
                      </Button>
                      <Button size="sm" className="h-7 text-xs" disabled={quickSendMut.isPending}
                        onClick={() => quickSendMut.mutate({ id: r.id, content: r.suggestedReply! })}>
                        <Send className="h-3.5 w-3.5 mr-1.5" />{t("この内容で送信")}
                      </Button>
                    </div>
                  </div>
                )}

                {r.status === "replied" && r.repliedContent && (
                  <div className="rounded-md bg-muted/50 border p-2.5 text-xs space-y-1">
                    <p className="font-medium">{t("送信した返信")}:</p>
                    <p className="whitespace-pre-wrap">{r.repliedContent}</p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  {r.permalink ? (
                    <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                      <ExternalLink className="h-3 w-3" />{t("Threadsで見る")}
                    </a>
                  ) : <span />}
                  <div className="flex gap-2">
                    {r.status === "unread" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markReadMut.mutate({ id: r.id })}>
                        {t("既読にする")}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => setOpenReplyId(openReplyId === r.id ? null : r.id)}>
                      {t("返信する")}
                    </Button>
                  </div>
                </div>

                {openReplyId === r.id && (
                  <ReplyBox replyId={r.id} maxLength={listQ.data?.maxReplyLength ?? 500}
                    onSent={() => setOpenReplyId(null)} initialContent={r.suggestedReply ?? ""} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
