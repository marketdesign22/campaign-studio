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
  AlertTriangle, AtSign, CheckCircle, Compass, Copy, ExternalLink, KeyRound, Link2, LucideIcon, Palette, Plus, RefreshCw,
  ShieldCheck, Sparkles, Trash2, Users,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { TZ_OPTIONS, useI18n } from "@/i18n";
import { MAX_SLOTS, PostingSlot, SlotTimezone } from "@shared/postingSlots";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROFILE_FIELD_KEYS, type ProfileFieldKey } from "@shared/clientProfile";
import { ContentOsSettingsCard } from "@/components/ContentOsSettingsCard";

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


/** 改行・カンマ区切りの入力を配列にする */
function splitList(text: string): string[] {
  return Array.from(new Set(text.split(/[\n,、]/).map((s) => s.trim()).filter(Boolean)));
}

const PROFILE_LABELS: Record<ProfileFieldKey, string> = {
  clientName: "クライアント名", brandName: "ブランド名", industry: "業種", industryDetail: "業種の細分類",
  productsServices: "主な商品・サービス", strengths: "特徴・強み", achievements: "実績", targetCustomers: "想定顧客",
  customerProblems: "顧客の悩み", useCases: "利用場面", regions: "対象地域・商圏", languages: "対応言語", priceRange: "価格帯",
  marketingGoals: "集客目的", conversionPaths: "問い合わせ・購入導線", brandTone: "ブランドの語調", commonWords: "よく使う言葉",
  avoidExpressions: "避けるべき表現", postThemes: "投稿テーマ", regionKeywords: "地域キーワード", industryKeywords: "業界キーワード",
  problemKeywords: "顧客課題キーワード", productKeywords: "商品キーワード", seasonalKeywords: "季節キーワード", referenceAccounts: "競合・参考アカウント候補",
};

function ClientProfileReaderCard() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const profileQ = trpc.clientProfile.get.useQuery();
  const [homepageUrl, setHomepageUrl] = useState("");
  const [threadsUrl, setThreadsUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [instagramBio, setInstagramBio] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selected, setSelected] = useState<ProfileFieldKey[]>([]);
  const [edits, setEdits] = useState<Partial<Record<ProfileFieldKey, string>>>({});
  const [keywordEnabled, setKeywordEnabled] = useState<Record<string, boolean>>({});
  const draft = profileQ.data?.draft;

  useEffect(() => {
    if (!draft) return;
    setSelected(PROFILE_FIELD_KEYS.filter((key) => draft.profile[key].status !== "missing" && !draft.profile[key].conflict));
    setEdits({});
    setKeywordEnabled(Object.fromEntries(draft.keywords.map((keyword) => [keyword.keyword, keyword.enabled])));
  }, [draft?.id]);

  const scanMut = trpc.clientProfile.scan.useMutation({
    onSuccess: async () => {
      await utils.clientProfile.get.invalidate();
      setReviewOpen(true);
      toast.success(t("AIが候補を作成しました。確認するまで設定は変更されません。"));
    },
    onError: (error) => toast.error(error.message),
  });
  const approveMut = trpc.clientProfile.approve.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.clientProfile.get.invalidate(), utils.trends.getSettings.invalidate()]);
      setReviewOpen(false);
      toast.success(t("承認したクライアント情報と検索候補を反映しました。"));
    },
    onError: (error) => toast.error(error.message),
  });
  const improveMut = trpc.clientProfile.improveKeywords.useMutation({
    onSuccess: async () => {
      await utils.clientProfile.get.invalidate();
      setReviewOpen(true);
      toast.success(t("検索成果をもとにAIが改善候補を作成しました。"));
    },
    onError: (error) => toast.error(error.message),
  });
  const approve = (fields: ProfileFieldKey[], enableAllKeywords = false) => {
    if (!draft) return;
    approveMut.mutate({
      draftId: draft.id,
      selectedFields: fields,
      edits: Object.fromEntries(Object.entries(edits).map(([key, value]) => [
        key, Array.isArray(draft.profile[key as ProfileFieldKey].value) ? splitList(value) : value,
      ])) as Partial<Record<ProfileFieldKey, string | string[] | null>>,
      keywords: draft.keywords.map((keyword) => ({
        ...keyword, enabled: enableAllKeywords || (keywordEnabled[keyword.keyword] ?? false),
      })),
    });
  };

  return <>
    <Card className="border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-base font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4" />{t("クライアント情報のAI自動取得")}</CardTitle>
        <CardDescription>{t("公式サイトと連携済みThreadsから候補を作ります。InstagramはURLと貼り付けた紹介文だけを使用し、スクレイピングしません。")}</CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="pt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="clientHomepage">{t("公式ホームページURL")}</Label><Input id="clientHomepage" type="url" value={homepageUrl} onChange={(e) => setHomepageUrl(e.target.value)} placeholder="https://example.com" /></div>
          <div className="space-y-1.5"><Label htmlFor="clientThreads">Threads</Label><Input id="clientThreads" value={threadsUrl} onChange={(e) => setThreadsUrl(e.target.value)} placeholder="https://www.threads.net/@account" /></div>
          <div className="space-y-1.5"><Label htmlFor="clientInstagram">Instagram</Label><Input id="clientInstagram" value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} placeholder="https://www.instagram.com/account" /></div>
          <div className="space-y-1.5"><Label htmlFor="clientInstagramBio">{t("Instagram紹介文（任意）")}</Label><Textarea id="clientInstagramBio" rows={2} maxLength={2000} value={instagramBio} onChange={(e) => setInstagramBio(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={scanMut.isPending || (!homepageUrl.trim() && !threadsUrl.trim() && !instagramUrl.trim() && !instagramBio.trim())} onClick={() => scanMut.mutate({
            homepageUrl: homepageUrl.trim() || undefined, threadsUrl: threadsUrl.trim() || undefined,
            instagramUrl: instagramUrl.trim() || undefined, instagramBio: instagramBio.trim() || undefined,
          })}><Sparkles className="h-4 w-4 mr-1.5" />{scanMut.isPending ? t("安全に読み取り中...") : t("AIでクライアント情報を読み取る")}</Button>
          {draft && <Button variant="outline" onClick={() => setReviewOpen(true)}>{t("前回の読み取り結果を確認")}</Button>}
          {profileQ.data?.current && <Button variant="outline" disabled={improveMut.isPending} onClick={() => improveMut.mutate()}>
            {improveMut.isPending ? t("改善案を作成中...") : t("AIで検索キーワードを改善")}
          </Button>}
        </div>
        <p className="text-xs text-muted-foreground">{t("最大8ページ・合計12万文字まで。robots.txtとアクセス制限を尊重し、JavaScript・Cookie・ログイン情報は使用しません。")}</p>
      </CardContent>
    </Card>

    <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("AIが読み取ったクライアント情報")}</DialogTitle></DialogHeader>
        {!draft ? <p className="text-sm text-muted-foreground">{t("確認できる候補はありません。")}</p> : <div className="space-y-5">
          {draft.warnings.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="inline h-4 w-4 mr-1" />{draft.warnings.join(" / ")}</div>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setSelected([...PROFILE_FIELD_KEYS])}>{t("すべての項目を選択")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected([])}>{t("すべての選択を解除")}</Button>
          </div>
          <div className="space-y-3">
            {PROFILE_FIELD_KEYS.map((key) => {
              const field = draft.profile[key];
              const shown = edits[key] ?? (Array.isArray(field.value) ? field.value.join("\n") : field.value ?? "");
              const currentValue = profileQ.data?.current?.[key]?.value;
              const differs = currentValue !== undefined && JSON.stringify(currentValue) !== JSON.stringify(field.value);
              return <div key={key} className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" aria-label={`${PROFILE_LABELS[key]}を採用`} checked={selected.includes(key)} onChange={(e) => setSelected(e.target.checked ? [...selected, key] : selected.filter((item) => item !== key))} />
                  <span className="font-medium text-sm">{t(PROFILE_LABELS[key])}</span>
                  <span className="text-xs rounded-full border px-2 py-0.5">{field.status === "verified" ? t("確認済み") : field.status === "inferred" ? t("推定") : field.status === "user_edited" ? t("ユーザー修正済み") : t("未取得")}</span>
                  <span className="text-xs text-muted-foreground">{t("信頼度")} {Math.round(field.confidence * 100)}%</span>
                </div>
                <Textarea rows={Array.isArray(field.value) ? 3 : 2} value={shown} onChange={(e) => setEdits({ ...edits, [key]: e.target.value })} />
                {differs && <p className="text-xs text-muted-foreground">{t("現在の設定")}: {Array.isArray(currentValue) ? currentValue.join(" / ") : currentValue || t("未設定")}</p>}
                {field.conflict && <p className="text-xs text-destructive">{t("情報が一致しません")}: {field.conflict}</p>}
                {field.sources.length > 0 && <div className="flex flex-wrap gap-2">{field.sources.map((source) => <a key={`${key}-${source.url}`} href={source.url} target="_blank" rel="noreferrer" className="text-xs underline inline-flex items-center gap-1" title={source.excerpt}>{source.pageTitle || t("出典")}<ExternalLink className="h-3 w-3" /></a>)}</div>}
              </div>;
            })}
          </div>
          <div className="space-y-2"><h3 className="font-semibold">{t("トレンド検索キーワード候補")}</h3>
            <div className="grid gap-2 sm:grid-cols-2">{draft.keywords.map((keyword) => <label key={keyword.keyword} className="rounded-lg border p-3 flex gap-2 text-sm"><input type="checkbox" checked={keywordEnabled[keyword.keyword] ?? false} onChange={(e) => setKeywordEnabled({ ...keywordEnabled, [keyword.keyword]: e.target.checked })} /><span><span className="font-medium">{keyword.keyword}</span><span className="block text-xs text-muted-foreground">{keyword.category} / {t("優先度")} {keyword.priority} — {keyword.reason}</span></span></label>)}</div>
          </div>
        </div>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setReviewOpen(false)}>{t("後で確認")}</Button>
          {draft && <Button variant="secondary" disabled={approveMut.isPending} onClick={() => approve(
            PROFILE_FIELD_KEYS.filter((key) => draft.profile[key].status !== "missing" && !draft.profile[key].conflict), true,
          )}>{t("すべて承認")}</Button>}
          {draft && <Button disabled={approveMut.isPending} onClick={() => approve(selected)}>{approveMut.isPending ? t("反映中...") : t("選択した項目と検索条件を承認")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

/**
 * トレンドリサーチの設定。アカウントごとに独立して保存される。
 * 既定は1日2回（9:00 / 18:00）。Threads の keyword_search は1ユーザーあたり
 * 1日 2,200 回の上限があり、20キーワード × 2種類 × 2回 = 80回/日 で十分余裕がある。
 */
function TrendSettingsCard() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data } = trpc.trends.getSettings.useQuery();
  const [keywords, setKeywords] = useState("");
  const [excludeKeywords, setExcludeKeywords] = useState("");
  const [refAccounts, setRefAccounts] = useState("");
  const [language, setLanguage] = useState<"ja" | "en">("ja");
  const [region, setRegion] = useState<"JP" | "US" | "OTHER">("JP");
  const [industry, setIndustry] = useState("");
  const [fetchTimes, setFetchTimes] = useState<{ hour: number; minute: number }[]>([{ hour: 9, minute: 0 }, { hour: 18, minute: 0 }]);
  const [autoFetch, setAutoFetch] = useState(true);
  const [retentionDays, setRetentionDays] = useState(30);
  const [aiDailyLimit, setAiDailyLimit] = useState(20);

  useEffect(() => {
    if (!data) return;
    setKeywords(data.keywords.join("\n"));
    setExcludeKeywords(data.excludeKeywords.join("\n"));
    setRefAccounts(data.refAccounts.map((a) => `@${a}`).join("\n"));
    setLanguage(data.language === "en" ? "en" : "ja");
    setRegion(data.region === "US" ? "US" : data.region === "OTHER" ? "OTHER" : "JP");
    setIndustry(data.industry ?? "");
    setFetchTimes(data.fetchTimes);
    setAutoFetch(data.autoFetch);
    setRetentionDays(data.retentionDays);
    setAiDailyLimit(data.aiDailyLimit);
  }, [data]);

  const saveMut = trpc.trends.saveSettings.useMutation({
    onSuccess: () => { toast.success(t("トレンド設定を保存しました")); utils.trends.getSettings.invalidate(); utils.trends.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const kwCount = splitList(keywords).length;
  return (
    <Card className="border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
          <Compass className="h-4 w-4" />{t("トレンドリサーチ")}
        </CardTitle>
        <CardDescription>{t("検索条件・収集データ・学習結果はこのアカウントにだけ保存されます。")}</CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="pt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="trendKeywords">{t("検索キーワード")} <span className="text-xs text-muted-foreground">({kwCount}/20)</span></Label>
            <Textarea id="trendKeywords" rows={5} value={keywords} onChange={(e) => setKeywords(e.target.value)}
              placeholder={t("1行に1つ（例: 留学 / オープンキャンパス）")} className="resize-none text-sm" />
            {kwCount > 20 && <p className="text-xs text-destructive">{t("キーワードは20個までです（超過分は取得に使われません）")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trendExclude">{t("除外キーワード・禁止表現")}</Label>
            <Textarea id="trendExclude" rows={5} value={excludeKeywords} onChange={(e) => setExcludeKeywords(e.target.value)}
              placeholder={t("含む投稿を収集から外し、AI生成でも使わない語")} className="resize-none text-sm" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trendRef">{t("参考アカウント")}</Label>
          <Textarea id="trendRef" rows={2} value={refAccounts} onChange={(e) => setRefAccounts(e.target.value)}
            placeholder="@account1, @account2" className="resize-none text-sm" />
          <p className="text-xs text-muted-foreground">{t("メモとして保持します。相手の投稿を自動収集はしません（公開投稿はURLで個別登録できます）。")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t("言語")}</Label>
            <Select value={language} onValueChange={(v) => setLanguage(v as typeof language)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ja">{t("日本語")}</SelectItem><SelectItem value="en">{t("英語")}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("地域")}</Label>
            <Select value={region} onValueChange={(v) => setRegion(v as typeof region)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="JP">{t("日本")}</SelectItem><SelectItem value="US">{t("米国")}</SelectItem><SelectItem value="OTHER">{t("その他")}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trendIndustry">{t("業種")}</Label>
            <Input id="trendIndustry" value={industry} maxLength={60} onChange={(e) => setIndustry(e.target.value)} placeholder={t("例: 教育・留学")} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50 border">
          <div>
            <p className="text-sm font-medium">{t("自動取得")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("既定は1日2回。Threads の検索APIは1アカウントあたり1日2,200回が上限で、20キーワード×2種類×2回＝80回/日に収まります。回数を増やすほど上限とサーバー負荷に近づきます。")}
            </p>
          </div>
          <Switch checked={autoFetch} onCheckedChange={setAutoFetch} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("取得時刻")} <span className="text-xs text-muted-foreground">({data?.timezone ?? "—"})</span></Label>
          <div className="flex flex-wrap gap-2">
            {fetchTimes.map((ft, i) => (
              <div key={i} className="flex items-center gap-1 rounded-lg border bg-card p-1.5">
                <Input type="number" min={0} max={23} value={ft.hour} aria-label={t("時")} className="w-14 h-8 text-center font-mono"
                  onChange={(e) => setFetchTimes(fetchTimes.map((x, k) => k === i ? { ...x, hour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) } : x))} />
                <span className="font-bold text-muted-foreground">:</span>
                <Input type="number" min={0} max={59} value={String(ft.minute).padStart(2, "0")} aria-label={t("分")} className="w-14 h-8 text-center font-mono"
                  onChange={(e) => setFetchTimes(fetchTimes.map((x, k) => k === i ? { ...x, minute: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) } : x))} />
                {fetchTimes.length > 1 && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setFetchTimes(fetchTimes.filter((_, k) => k !== i))} aria-label={t("削除")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {fetchTimes.length < 4 && (
              <Button size="sm" variant="outline" className="h-11" onClick={() => setFetchTimes([...fetchTimes, { hour: 12, minute: 0 }])}>
                <Plus className="h-3.5 w-3.5 mr-1" />{t("追加")}
              </Button>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="trendRetention">{t("保存期間（日）")}</Label>
            <Input id="trendRetention" type="number" min={7} max={180} value={retentionDays} onChange={(e) => setRetentionDays(Number(e.target.value))} className="max-w-[140px]" />
            <p className="text-xs text-muted-foreground">{t("期間を過ぎた収集投稿は自動で消えます。「保存」した投稿は残ります。")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trendAiLimit">{t("AI分析の1日上限（回）")}</Label>
            <Input id="trendAiLimit" type="number" min={0} max={100} value={aiDailyLimit} onChange={(e) => setAiDailyLimit(Number(e.target.value))} className="max-w-[140px]" />
            <p className="text-xs text-muted-foreground">{t("分析1回ごとにAI利用料が発生します。0にすると分析を止めます。")}</p>
          </div>
        </div>
        <Button className="w-full" disabled={saveMut.isPending}
          onClick={() => saveMut.mutate({
            keywords: splitList(keywords).slice(0, 50),
            excludeKeywords: splitList(excludeKeywords),
            refAccounts: splitList(refAccounts).map((a) => a.replace(/^@/, "")),
            language, region, industry: industry.trim() || null,
            fetchTimes, autoFetch,
            retentionDays: Math.min(180, Math.max(7, retentionDays)),
            aiDailyLimit: Math.min(100, Math.max(0, aiDailyLimit)),
          })}>
          {saveMut.isPending ? t("保存中...") : t("トレンド設定を保存")}
        </Button>
      </CardContent>
    </Card>
  );
}

type ReplyTemplateRow = { id: number; keywords: string[]; replyText: string; enabled: boolean };

/**
 * 1件のテンプレート編集行。
 * 保存を押すまでThreadsへは何も送らない。有効/無効の切替だけは即時保存する
 * （提案するかどうかの見た目の状態なので、他のフィールドと違って迷いにくい）。
 */
function ReplyTemplateEditor({
  template, onChanged,
}: {
  template: ReplyTemplateRow;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [keywords, setKeywords] = useState(template.keywords.join(", "));
  const [replyText, setReplyText] = useState(template.replyText);

  const updateMut = trpc.replies.templates.update.useMutation({
    onSuccess: () => { toast.success(t("テンプレートを保存しました")); onChanged(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.replies.templates.delete.useMutation({
    onSuccess: () => { toast.success(t("テンプレートを削除しました")); onChanged(); },
    onError: (e) => toast.error(e.message),
  });

  const kws = splitList(keywords);

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch checked={template.enabled}
            onCheckedChange={(v) => updateMut.mutate({ id: template.id, enabled: v })} />
          <span className="text-xs text-muted-foreground">{template.enabled ? t("有効") : t("無効")}</span>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
          onClick={() => { if (confirm(t("このテンプレートを削除しますか？"))) deleteMut.mutate({ id: template.id }); }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t("反応するキーワード（カンマ区切り）")}</Label>
        <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ビザ, 在留資格" className="text-sm" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{t("提案する返信文")}</Label>
        <Textarea rows={2} value={replyText} maxLength={500}
          onChange={(e) => setReplyText(e.target.value)} className="resize-none text-sm" />
      </div>
      <div className="flex justify-end">
        <Button size="sm" className="h-7 text-xs" disabled={kws.length === 0 || !replyText.trim() || updateMut.isPending}
          onClick={() => updateMut.mutate({ id: template.id, keywords: kws, replyText: replyText.trim() })}>
          {updateMut.isPending ? t("保存中...") : t("保存")}
        </Button>
      </div>
    </div>
  );
}

/**
 * 受信箱の自動返信テンプレート。
 * キーワードに一致した返信へ、この定型文を「案」として受信箱に出す。
 * 実際に送るかどうかは必ず利用者が受信箱で選ぶ（自動送信はしない）。
 */
function ReplyTemplatesCard() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data: templates = [] } = trpc.replies.templates.list.useQuery();
  const [newKeywords, setNewKeywords] = useState("");
  const [newReply, setNewReply] = useState("");

  const refresh = () => utils.replies.templates.list.invalidate();
  const createMut = trpc.replies.templates.create.useMutation({
    onSuccess: () => { toast.success(t("テンプレートを追加しました")); setNewKeywords(""); setNewReply(""); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const newKws = splitList(newKeywords);

  return (
    <Card className="border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-base font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4" />{t("自動返信テンプレート")}
        </CardTitle>
        <CardDescription>
          {t("キーワードに一致する返信があると、受信箱に候補として表示します。自動では送信せず、必ず利用者が内容を確認してから送信します。")}
        </CardDescription>
      </CardHeader>
      <Separator />
      <CardContent className="pt-5 space-y-3">
        {templates.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("まだテンプレートがありません。")}</p>
        )}
        {templates.map((tpl) => (
          <ReplyTemplateEditor key={tpl.id} template={tpl} onChanged={refresh} />
        ))}
        <div className="rounded-lg border border-dashed p-3 space-y-2">
          <p className="text-xs font-medium">{t("新しいテンプレートを追加")}</p>
          <Input value={newKeywords} onChange={(e) => setNewKeywords(e.target.value)}
            placeholder={t("キーワード（カンマ区切り。例: ビザ, 在留資格）")} className="text-sm" />
          <Textarea rows={2} value={newReply} maxLength={500} onChange={(e) => setNewReply(e.target.value)}
            placeholder={t("この内容で提案する返信文")} className="resize-none text-sm" />
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" disabled={newKws.length === 0 || !newReply.trim() || createMut.isPending}
              onClick={() => createMut.mutate({ keywords: newKws, replyText: newReply.trim() })}>
              <Plus className="h-3.5 w-3.5 mr-1" />{createMut.isPending ? t("追加中...") : t("追加")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
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
              {t("Renderの環境変数に OPENAI_API_KEY を設定してください。OPENAI_MODEL でモデルを変更できます。")}
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
      {hasAccounts && <ContentOsSettingsCard />}

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

      {/* Trend research (per account) */}
      {hasAccounts && <ClientProfileReaderCard />}
      {hasAccounts && <TrendSettingsCard />}

      {/* Reply auto-suggest templates (per account) */}
      {hasAccounts && <ReplyTemplatesCard />}

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
