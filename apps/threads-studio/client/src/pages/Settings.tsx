import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAccount } from "@/contexts/AccountContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  AtSign, CheckCircle, Copy, KeyRound, Link2, LucideIcon, Palette, Plus, RefreshCw,
  ShieldCheck, Sparkles, Trash2, Users,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { TZ_OPTIONS, useI18n } from "@/i18n";
import { MAX_SLOTS, PostingSlot, SlotTimezone } from "@shared/postingSlots";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AccountRow = {
  id: number;
  name: string;
  threadsUserId: string;
  hasToken: boolean;
  tokenRefreshedAt: Date | string | null;
  tokenExpiresAt: Date | string | null;
  morningHour: number;
  morningMinute: number;
  eveningHour: number;
  eveningMinute: number;
  timezone: SlotTimezone;
  /** 投稿枠。サーバーが解決済みの配列で返す（未設定なら朝夕から組み立てた2件） */
  slots: PostingSlot[];
  active: boolean;
};

/** 投稿枠1件の編集行。時刻とタイムゾーンを枠ごとに指定する */
function SlotRow({
  index, slot, canRemove, onChange, onRemove,
}: {
  index: number;
  slot: PostingSlot;
  canRemove: boolean;
  onChange: (next: PostingSlot) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5 p-3 rounded-xl border bg-card">
      <span className="h-8 w-8 rounded-lg bg-[var(--brand-accent)]/12 flex items-center justify-center shrink-0 text-xs font-bold text-[var(--brand-accent-deep)] tabular-nums">
        {index + 1}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        <Input
          type="number" min={0} max={23} value={slot.hour}
          aria-label={t("時")}
          onChange={(e) => onChange({ ...slot, hour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) })}
          className="w-14 text-center font-mono h-8"
        />
        <span className="font-bold text-muted-foreground">:</span>
        <Input
          type="number" min={0} max={59} value={String(slot.minute).padStart(2, "0")}
          aria-label={t("分")}
          onChange={(e) => onChange({ ...slot, minute: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) })}
          className="w-14 text-center font-mono h-8"
        />
      </div>
      <Select value={slot.timezone} onValueChange={(v) => onChange({ ...slot, timezone: v as SlotTimezone })}>
        <SelectTrigger className="h-8 flex-1 min-w-0 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {TZ_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>{t(o.labelJa)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
        disabled={!canRemove}
        aria-label={t("この枠を削除")}
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function AccountCard({ account }: { account: AccountRow }) {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const [slots, setSlots] = useState<PostingSlot[]>(account.slots);
  const [newToken, setNewToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const updateMut = trpc.accounts.update.useMutation({
    onSuccess: () => { toast.success(t("保存しました")); utils.accounts.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.accounts.delete.useMutation({
    onSuccess: () => { toast.success(t("アカウントを削除しました")); utils.accounts.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const refreshMut = trpc.accounts.refreshToken.useMutation({
    onSuccess: () => { toast.success(t("トークンをリフレッシュしました")); utils.accounts.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const replaceMut = trpc.accounts.replaceToken.useMutation({
    onSuccess: () => { toast.success(t("トークンを更新しました")); setNewToken(""); setShowToken(false); utils.accounts.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const expires = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;
  const expiresSoon = expires && expires.getTime() - Date.now() < 14 * 24 * 3600 * 1000;

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-10 w-10 rounded-full bg-[var(--brand-accent)] flex items-center justify-center shrink-0">
            <AtSign className="h-5 w-5 text-[#1d3450]" strokeWidth={2.4} />
          </span>
          <div className="min-w-0">
            <p className="font-semibold truncate">{account.name}</p>
            <p className="text-xs text-muted-foreground tabular-nums truncate">User ID: {account.threadsUserId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">{account.active ? t("有効") : t("停止中")}</span>
          <Switch checked={account.active} onCheckedChange={(v) => updateMut.mutate({ id: account.id, active: v })} />
        </div>
      </div>

      {/* Token status */}
      <div className={`flex items-center gap-2.5 text-xs rounded-lg px-3 py-2 ${expiresSoon ? "bg-destructive/8 text-destructive" : "bg-emerald-600/8 text-emerald-700"}`}>
        <CheckCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">
          {t("トークン登録済み")}
          {expires && ` (${t("失効予定")}: ${expires.toLocaleDateString(locale)}) `}
          {t("— 7日ごとに自動更新されます")}
        </span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={refreshMut.isPending}
          onClick={() => refreshMut.mutate({ id: account.id })}>
          <RefreshCw className={`h-3 w-3 mr-1 ${refreshMut.isPending ? "animate-spin" : ""}`} />{t("今すぐ更新")}
        </Button>
      </div>

      {showToken ? (
        <div className="flex gap-2">
          <Input type="password" placeholder={t("新しいアクセストークン")} value={newToken}
            onChange={(e) => setNewToken(e.target.value)} className="font-mono text-sm" />
          <Button size="sm" disabled={!newToken.trim() || replaceMut.isPending}
            onClick={() => replaceMut.mutate({ id: account.id, threadsAccessToken: newToken })}>
            {replaceMut.isPending ? t("検証中...") : t("保存")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowToken(false); setNewToken(""); }}>{t("取消")}</Button>
        </div>
      ) : (
        <button className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => setShowToken(true)}>
          {t("トークンを手動で差し替える")}
        </button>
      )}

      <Separator />

      {/* Schedule */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">{t("自動投稿スケジュール")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("枠ごとにタイムゾーンを指定できます。日本時間と現地時間を混ぜても構いません。")}
          </p>
        </div>

        <div className="space-y-2">
          {slots.map((slot, i) => (
            <SlotRow
              key={i}
              index={i}
              slot={slot}
              canRemove={slots.length > 1}
              onChange={(next) => setSlots(slots.map((s, j) => (j === i ? next : s)))}
              onRemove={() => setSlots(slots.filter((_, j) => j !== i))}
            />
          ))}
        </div>

        {slots.length < MAX_SLOTS && (
          <Button
            size="sm" variant="outline" className="w-full"
            onClick={() => setSlots([...slots, { hour: 9, minute: 0, timezone: slots[slots.length - 1]?.timezone ?? "LA" }])}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />{t("投稿枠を追加")}
          </Button>
        )}

        <div className="flex justify-between items-center">
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
            onClick={() => { if (confirm(`"${account.name}" ${t("を削除しますか？原稿と履歴は残ります。")}`)) deleteMut.mutate({ id: account.id }); }}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />{t("削除")}
          </Button>
          <Button size="sm" disabled={updateMut.isPending}
            onClick={() => updateMut.mutate({ id: account.id, slots })}>
            {updateMut.isPending ? t("保存中...") : t("スケジュールを保存")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { t } = useI18n();
  const { current: currentAccount, hasAccounts } = useAccount();
  // アカウントが1件も無いうちは、アカウント前提のAPIを呼ばない
  // （このページから最初の1件を追加できるようにするため）
  const { data: settings } = trpc.settings.get.useQuery(undefined, { enabled: hasAccounts });
  const { data: accounts = [], isLoading: accountsLoading } = trpc.accounts.list.useQuery();
  const utils = trpc.useUtils();

  // Ops settings
  const [requireApproval, setRequireApproval] = useState(false);
  const [notifyOnError, setNotifyOnError] = useState(true);
  const [brandName, setBrandName] = useState("");
  const [brandAccent, setBrandAccent] = useState("#ff9800");
  const [autoFillEvergreen, setAutoFillEvergreen] = useState(false);
  const [recycleRewrite, setRecycleRewrite] = useState(true);
  const [recycleCooldownDays, setRecycleCooldownDays] = useState(30);

  useEffect(() => {
    if (settings) {
      setRequireApproval(settings.requireApproval ?? false);
      setNotifyOnError(settings.notifyOnError ?? true);
      setAutoFillEvergreen(settings.autoFillEvergreen ?? false);
      setRecycleRewrite(settings.recycleRewrite ?? true);
      setRecycleCooldownDays(settings.recycleCooldownDays ?? 30);
      setBrandName(settings.brandName ?? "");
      setBrandAccent(settings.brandAccent ?? "#ff9800");
    }
  }, [settings]);

  const saveOpsMut = trpc.settings.saveOps.useMutation({
    onSuccess: () => { toast.success(t("設定を保存しました")); utils.settings.get.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  // AIの利用状態。APIキーそのものは返ってこない（設定済みかどうかとモデル名のみ）
  const { data: aiStatus } = trpc.ai.status.useQuery();
  const aiTest = trpc.ai.testConnection.useMutation({
    onSuccess: (d) => toast.success(`${t("AI利用可能")} — ${d.model}`),
    onError: (e) => toast.error(e.message),
  });

  // Add account dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTokenValue, setNewTokenValue] = useState("");
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const connectLinkMut = trpc.accounts.createConnectLink.useMutation({
    onSuccess: (d) => setConnectUrl(d.url),
    onError: (e) => toast.error(e.message),
  });
  const createMut = trpc.accounts.create.useMutation({
    onSuccess: (d) => {
      toast.success(`${t("アカウントを追加しました")}${d.username ? ` (@${d.username})` : ""}`);
      setAddOpen(false); setNewName(""); setNewTokenValue("");
      utils.accounts.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        eyebrow="Preferences"
        title={t("設定")}
        description={
          currentAccount
            ? `${currentAccount.name} — ${t("運用ルールとブランドはこのアカウントにのみ適用されます")}`
            : t("アカウント・運用ルール・ブランドの管理")
        }
      />

      {/* AI */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4" />{t("AIアシスト")}
          </CardTitle>
          <CardDescription className="mt-1">
            {t("原稿の生成とリライトに使います。APIキーはサーバー側にのみ保存され、画面には表示されません。")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            className={`flex items-center gap-2.5 text-xs rounded-lg px-3 py-2 ${
              aiStatus?.available ? "bg-emerald-600/8 text-emerald-700" : "bg-muted text-muted-foreground"
            }`}
            role="status"
          >
            {aiStatus?.available
              ? <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              : <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}
            <span className="flex-1">
              {aiStatus === undefined ? t("AIに接続中…")
                : aiStatus.available
                  ? `${t("AI利用可能")}（${aiStatus.provider} / ${aiStatus.model}）`
                  : t("AI設定が必要です")}
            </span>
          </div>
          {!aiStatus?.configured && (
            <p className="text-xs text-muted-foreground">
              {t("Renderの環境変数に ANTHROPIC_API_KEY を設定してください。ANTHROPIC_MODEL でモデルを変更できます。")}
            </p>
          )}
          <Button
            size="sm" variant="outline"
            disabled={!aiStatus?.configured || aiTest.isPending}
            onClick={() => aiTest.mutate()}
          >
            <Sparkles className={`h-3.5 w-3.5 mr-1.5 ${aiTest.isPending ? "animate-pulse" : ""}`} />
            {aiTest.isPending ? t("AIに接続中…") : t("AI接続テスト")}
          </Button>
        </CardContent>
      </Card>

      {/* Accounts */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
                <Users className="h-4 w-4" />
                {t("Threadsアカウント")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("複数アカウントを登録し、それぞれに投稿時刻を設定できます。")}
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />{t("追加")}
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5 space-y-4">
          {accountsLoading ? (
            <p className="text-sm text-muted-foreground">{t("読み込み中...")}</p>
          ) : accounts.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <KeyRound className="h-7 w-7 text-muted-foreground/40 mx-auto" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                {t("アカウントが未登録です。Meta開発者ポータルで取得した長期アクセストークンで追加してください。")}
              </p>
            </div>
          ) : (
            accounts.map((a) => <AccountCard key={a.id} account={a as AccountRow} />)
          )}
        </CardContent>
      </Card>

      {/* Operations */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {t("運用ルール")}
          </CardTitle>
          <CardDescription>{t("チーム運用・クライアント納品時の安全設定。")}</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50 border">
            <div>
              <p className="text-sm font-medium">{t("承認フロー")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("新規原稿を「下書き」として作成し、承認済みの原稿だけを自動投稿します。")}
              </p>
            </div>
            <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
          </div>
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50 border">
            <div>
              <p className="text-sm font-medium">{t("失敗時の通知")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("自動投稿の失敗やトークン失効の危険をオーナーへ通知します。")}
              </p>
            </div>
            <Switch checked={notifyOnError} onCheckedChange={setNotifyOnError} />
          </div>
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50 border">
            <div>
              <p className="text-sm font-medium">{t("空き枠を再投稿コンテンツで埋める")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("予約原稿が尽きた投稿枠を、「再投稿コンテンツ」に登録した過去の投稿で自動的に埋めます。")}
              </p>
            </div>
            <Switch checked={autoFillEvergreen} onCheckedChange={setAutoFillEvergreen} />
          </div>
          {autoFillEvergreen && (
            <div className="space-y-4 pl-3 border-l-2 border-primary/20">
              <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50 border">
                <div>
                  <p className="text-sm font-medium">{t("AIで言い回しを変える")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("内容・数字・固有名詞はそのままに、言い回しと絵文字だけを変えて再投稿します（APIキー未設定時は原文のまま）。")}
                  </p>
                </div>
                <Switch checked={recycleRewrite} onCheckedChange={setRecycleRewrite} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cooldown">{t("同じ投稿を再利用するまでの間隔（日）")}</Label>
                <Input id="cooldown" type="number" min={1} max={365} value={recycleCooldownDays}
                  onChange={(e) => setRecycleCooldownDays(Number(e.target.value))} className="max-w-[140px]" />
              </div>
            </div>
          )}
          <Button className="w-full" disabled={saveOpsMut.isPending}
            onClick={() => saveOpsMut.mutate({ requireApproval, notifyOnError, autoFillEvergreen, recycleRewrite, recycleCooldownDays })}>
            {saveOpsMut.isPending ? t("保存中...") : t("運用ルールを保存")}
          </Button>
        </CardContent>
      </Card>

      {/* Brand */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
            <Palette className="h-4 w-4" />
            {t("ブランド設定")}
          </CardTitle>
          <CardDescription>{t("表示名とアクセントカラーを組織に合わせて変更できます。")}</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="brandName">{t("ブランド名")}</Label>
            <Input id="brandName" placeholder="Threads Studio" value={brandName} maxLength={64}
              onChange={(e) => setBrandName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brandAccent">{t("アクセントカラー")}</Label>
            <div className="flex items-center gap-3">
              <input
                id="brandAccent" type="color" value={brandAccent}
                onChange={(e) => setBrandAccent(e.target.value)}
                className="h-9 w-14 rounded-md border cursor-pointer bg-card p-1"
              />
              <Input value={brandAccent} onChange={(e) => setBrandAccent(e.target.value)}
                className="w-32 font-mono text-sm" maxLength={7} />
              <span className="text-xs text-muted-foreground">{t("サイドバー等の差し色に反映されます")}</span>
            </div>
          </div>
          <Button className="w-full" disabled={saveOpsMut.isPending}
            onClick={() => saveOpsMut.mutate({
              brandName: brandName.trim() || null,
              brandAccent: /^#[0-9a-fA-F]{6}$/.test(brandAccent) ? brandAccent : null,
            })}>
            {saveOpsMut.isPending ? t("保存中...") : t("ブランド設定を保存")}
          </Button>
        </CardContent>
      </Card>

      {/* Add account dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setConnectUrl(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("アカウントを追加")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("表示名")}</Label>
              <Input placeholder={t("例: 〇〇大学 公式")} value={newName} maxLength={64}
                onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-2 p-3 rounded-lg border bg-muted/40">
              <p className="text-sm font-medium">{t("方法A: 連携リンクを送る（推奨）")}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("リンクを開いた本人がThreadsで許可すると、このアプリにアカウントが追加されます。パスワードを預かる必要がありません。")}
              </p>
              {connectUrl ? (
                <div className="space-y-1.5">
                  <Input readOnly value={connectUrl} className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()} />
                  <Button size="sm" variant="outline" className="w-full"
                    onClick={() => { navigator.clipboard?.writeText(connectUrl); toast.success(t("リンクをコピーしました")); }}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" />{t("リンクをコピー")}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" disabled={!newName.trim() || connectLinkMut.isPending}
                  onClick={() => connectLinkMut.mutate({ name: newName.trim() })}>
                  <Link2 className="h-3.5 w-3.5 mr-1.5" />
                  {connectLinkMut.isPending ? t("発行中...") : t("連携リンクを発行")}
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("方法B: 長期アクセストークンを直接入力")}</Label>
              <Input type="password" placeholder="THxxxxxxxx..." value={newTokenValue}
                onChange={(e) => setNewTokenValue(e.target.value)} className="font-mono text-sm" />
              <p className="text-xs text-muted-foreground">
                {t("保存時にトークンを検証し、Threads User IDを自動取得します。")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("キャンセル")}</Button>
            <Button disabled={!newName.trim() || !newTokenValue.trim() || createMut.isPending}
              onClick={() => createMut.mutate({ name: newName.trim(), threadsAccessToken: newTokenValue })}>
              {createMut.isPending ? t("検証・追加中...") : t("追加")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
