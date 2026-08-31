import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { AlertCircle, AtSign, CheckCircle2, Inbox, Send, Sunrise, Sunset } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const STATS = [
  { key: "pending" as const, label: "未投稿", icon: Inbox, chip: "bg-primary/10 text-primary" },
  { key: "posted" as const, label: "投稿済み", icon: CheckCircle2, chip: "bg-emerald-600/10 text-emerald-700" },
  { key: "error" as const, label: "エラー", icon: AlertCircle, chip: "bg-destructive/10 text-destructive" },
];

export default function Dashboard() {
  const { t, locale } = useI18n();
  const { data: posts } = trpc.posts.list.useQuery();
  const { data: logs } = trpc.postLogs.list.useQuery({ limit: 5 });
  const { data: preview } = trpc.posts.nextPreview.useQuery();
  const utils = trpc.useUtils();

  const manualPost = trpc.manualPost.post.useMutation({
    onSuccess: () => {
      toast.success(t("投稿が完了しました"));
      utils.posts.list.invalidate();
      utils.postLogs.list.invalidate();
      utils.posts.nextPreview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const counts = {
    pending: posts?.filter((p) => p.status === "pending").length ?? 0,
    posted: posts?.filter((p) => p.status === "posted").length ?? 0,
    error: posts?.filter((p) => p.status === "error").length ?? 0,
  };

  const today = new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric", weekday: "short" });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Overview"
        title={t("ダッシュボード")}
        description={`${today} — ${t("公式Threads運用状況")}`}
      />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {STATS.map((s) => (
          <Card key={s.key} className="border shadow-none">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-3.5">
                <span className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${s.chip}`}>
                  <s.icon className="h-5 w-5" strokeWidth={1.8} />
                </span>
                <div>
                  <p className="text-xs text-muted-foreground tracking-wide">{t(s.label)}</p>
                  <p className="text-[26px] font-bold leading-tight tabular-nums">{counts[s.key]}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Next post preview */}
      <Card className="border shadow-none overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
            {t("次回投稿プレビュー")}
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5">
          {preview ? (
            <div className="space-y-4">
              {/* Threads-style post card */}
              <div className="rounded-xl border bg-card p-4 sm:p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="h-9 w-9 rounded-full bg-[var(--brand-accent)] flex items-center justify-center shrink-0">
                    <AtSign className="h-4 w-4 text-[#1d3450]" strokeWidth={2.4} />
                  </span>
                  <div className="leading-tight">
                    <p className="text-sm font-semibold">{preview.accountName ?? t("アカウント未設定")}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      {preview.slotIndex === 0 ? (
                        <><Sunrise className="h-3 w-3" />{t("朝の投稿枠")}</>
                      ) : preview.slotIndex === 1 ? (
                        <><Sunset className="h-3 w-3" />{t("夕方の投稿枠")}</>
                      ) : (
                        <>{t("追加投稿枠")} {preview.slotIndex}</>
                      )}
                      <span className="text-muted-foreground/50">・No.{preview.id}</span>
                    </p>
                  </div>
                </div>
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                  {preview.content}
                </p>
              </div>
              <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" className="gap-2" disabled={manualPost.isPending}>
                      <Send className="h-4 w-4" />
                      {manualPost.isPending ? t("投稿中...") : t("今すぐ投稿")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("投稿を確認")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("この原稿をThreadsに今すぐ投稿します。よろしいですか？")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("キャンセル")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => manualPost.mutate({ postId: preview.id })}>
                        {t("投稿する")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : (
            <div className="py-8 text-center">
              <Inbox className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">{t("未投稿の原稿がありません")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent logs */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold">{t("最近の投稿履歴")}</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-2">
          {logs && logs.length > 0 ? (
            <div className="divide-y">
              {logs.map((log) => (
                <div key={log.id} className="py-3.5 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{log.content}</p>
                    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                      {new Date(log.postedAt).toLocaleString(locale)}
                    </p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                    log.status === "posted"
                      ? "bg-emerald-600/10 text-emerald-700"
                      : "bg-destructive/10 text-destructive"
                  }`}>
                    {log.status === "posted" ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                    {log.status === "posted" ? t("投稿済み") : t("エラー")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">{t("投稿履歴がありません")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
