import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { AlertCircle, CheckCircle2, Inbox, Repeat, Send, Sunrise, Sunset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useI18n } from "@/i18n";

const slotLabel: Record<number, string> = { 0: "朝", 1: "夕", 99: "手動" };
type FilterType = "all" | "posted" | "error";

const FILTERS: { value: FilterType; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "posted", label: "投稿済み" },
  { value: "error", label: "エラー" },
];

export default function History() {
  const { t, locale } = useI18n();
  const { data: logs, isLoading } = trpc.postLogs.list.useQuery({ limit: 100 });
  const utils = trpc.useUtils();
  const saveEvergreenMut = trpc.posts.saveAsEvergreen.useMutation({
    onSuccess: () => { toast.success(t("再投稿コンテンツに登録しました")); utils.posts.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const [filter, setFilter] = useState<FilterType>("all");

  const filtered = logs?.filter((l) => filter === "all" || l.status === filter) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Archive"
        title={t("投稿履歴")}
        description={t("過去の投稿ログ（最新100件）")}
        actions={
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                  filter === f.value ? "bg-card shadow-sm text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(f.label)}
                {f.value !== "all" && logs && (
                  <span className="ml-1.5 text-xs opacity-60 tabular-nums">
                    {logs.filter((l) => l.status === f.value).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        }
      />

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">{t("読み込み中...")}</div>
      ) : filtered.length > 0 ? (
        <Card className="border shadow-none">
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map((log) => (
                <div key={log.id} className="flex items-start gap-3.5 p-4 sm:p-5">
                  <span className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                    log.status === "posted" ? "bg-emerald-600/10 text-emerald-700" : "bg-destructive/10 text-destructive"
                  }`}>
                    {log.status === "posted" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <span className={`font-medium ${log.status === "posted" ? "text-emerald-700" : "text-destructive"}`}>
                        {log.status === "posted" ? t("投稿済み") : t("エラー")}
                      </span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        {log.slotIndex === 0 ? <Sunrise className="h-3 w-3" /> : log.slotIndex === 1 ? <Sunset className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                        {slotLabel[log.slotIndex] ? t(slotLabel[log.slotIndex]) : `${t("スロット")}${log.slotIndex}`}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {new Date(log.postedAt).toLocaleString(locale)}
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      {log.imageUrl && (
                        <img src={log.imageUrl} alt="" className="h-16 w-16 rounded-md object-cover border shrink-0" />
                      )}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap line-clamp-4">{log.content}</p>
                    </div>
                    {log.status === "posted" && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-sky-700 hover:bg-sky-500/10 -ml-2"
                        disabled={saveEvergreenMut.isPending}
                        onClick={() => saveEvergreenMut.mutate({ content: log.content, postId: log.postId ?? null })}>
                        <Repeat className="h-3.5 w-3.5 mr-1" />{t("再投稿コンテンツにする")}
                      </Button>
                    )}
                    {log.threadsPostId && (
                      <p className="text-xs text-muted-foreground/70 tabular-nums">Threads ID: {log.threadsPostId}</p>
                    )}
                    {log.errorMessage && (
                      <p className="text-xs text-destructive bg-destructive/5 rounded-md p-2.5">{log.errorMessage}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border shadow-none">
          <CardContent className="py-16 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-muted-foreground text-sm">
              {filter === "all" ? t("投稿履歴がありません") : filter === "posted" ? t("「投稿済み」の履歴がありません") : t("「エラー」の履歴がありません")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
