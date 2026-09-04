import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Link2, MousePointerClick, Target } from "lucide-react";

const TYPES = ["follow", "profile_visit", "website_visit", "inquiry", "document_request", "consultation", "booking", "purchase", "email_signup", "phone", "custom"] as const;
const EVENT_TYPES = ["link_click", "profile_visit", "follow", "inquiry", "booking", "lead", "purchase", "custom"] as const;
const TYPE_LABELS: Record<typeof TYPES[number], string> = { follow: "フォロー", profile_visit: "プロフィール訪問", website_visit: "Webサイト訪問", inquiry: "問い合わせ", document_request: "資料請求", consultation: "無料相談", booking: "来店予約", purchase: "商品購入", email_signup: "メール登録", phone: "電話", custom: "カスタム成果" };
const EVENT_LABELS: Record<typeof EVENT_TYPES[number], string> = { link_click: "リンククリック", profile_visit: "プロフィール訪問", follow: "フォロー", inquiry: "問い合わせ", booking: "予約", lead: "見込み顧客", purchase: "購入", custom: "カスタム成果" };
export function ConversionWorkspace() {
  const { t } = useI18n(); const utils = trpc.useUtils();
  const [anchor] = useState(() => Date.now()); const [period, setPeriod] = useState<"7" | "30" | "custom">("30");
  const [customFrom, setCustomFrom] = useState(() => new Date(anchor - 30 * 86_400_000).toISOString().slice(0, 10)); const [customTo, setCustomTo] = useState(() => new Date(anchor).toISOString().slice(0, 10));
  const to = useMemo(() => period === "custom" ? new Date(`${customTo}T23:59:59.999Z`) : new Date(anchor + 60_000), [anchor, customTo, period]);
  const from = useMemo(() => period === "custom" ? new Date(`${customFrom}T00:00:00.000Z`) : new Date(anchor - Number(period) * 86_400_000), [anchor, customFrom, period]);
  const goalsQ = trpc.conversions.goals.useQuery(); const postsQ = trpc.posts.list.useQuery(); const summaryQ = trpc.conversions.summary.useQuery({ from, to }, { enabled: from < to });
  const [goalName, setGoalName] = useState(""); const [goalType, setGoalType] = useState<typeof TYPES[number]>("inquiry"); const [destination, setDestination] = useState("");
  const [goalPriority, setGoalPriority] = useState(3); const [goalValue, setGoalValue] = useState(""); const [goalRegion, setGoalRegion] = useState(""); const [goalCampaign, setGoalCampaign] = useState(""); const [goalPrimary, setGoalPrimary] = useState(false); const [attributionDays, setAttributionDays] = useState(30);
  const [baseUrl, setBaseUrl] = useState(""); const [campaign, setCampaign] = useState("");
  const [eventType, setEventType] = useState<typeof EVENT_TYPES[number]>("inquiry"); const [quantity, setQuantity] = useState(1); const [value, setValue] = useState(""); const [note, setNote] = useState(""); const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10)); const [postId, setPostId] = useState("none"); const [goalId, setGoalId] = useState("none");
  const [csv, setCsv] = useState("");
  const goalMut = trpc.conversions.createGoal.useMutation({ onSuccess: () => { setGoalName(""); utils.conversions.goals.invalidate(); toast.success(t("成果目標を追加しました")); }, onError: e => toast.error(e.message) });
  const goalUpdate = trpc.conversions.updateGoal.useMutation({ onSuccess: () => utils.conversions.goals.invalidate(), onError: e => toast.error(e.message) });
  const manualMut = trpc.conversions.addManual.useMutation({ onSuccess: () => { setNote(""); utils.conversions.summary.invalidate(); toast.success(t("成果を登録しました")); }, onError: e => toast.error(e.message) });
  const reviseMut = trpc.conversions.revise.useMutation({ onSuccess: () => { utils.conversions.summary.invalidate(); toast.success(t("成果を修正しました")); }, onError: e => toast.error(e.message) });
  const csvMut = trpc.conversions.importCsv.useMutation({ onSuccess: result => { setCsv(""); utils.conversions.summary.invalidate(); toast.success(`${result.created}${t("件インポートしました")}`); }, onError: e => toast.error(e.message) });
  const previewQ = trpc.conversions.utmPreview.useQuery({ url: baseUrl, campaign: campaign || "campaign" }, { enabled: /^https?:\/\//.test(baseUrl) && !!campaign });
  const m = summaryQ.data?.overall;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><Label>{t("分析期間")}</Label><Select value={period} onValueChange={v => setPeriod(v as typeof period)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">{t("7日")}</SelectItem><SelectItem value="30">{t("30日")}</SelectItem><SelectItem value="custom">{t("任意期間")}</SelectItem></SelectContent></Select>{period === "custom" && <><Input className="w-40" type="date" aria-label={t("開始日")} value={customFrom} onChange={e => setCustomFrom(e.target.value)} /><Input className="w-40" type="date" aria-label={t("終了日")} value={customTo} onChange={e => setCustomTo(e.target.value)} /></>}</div>
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {[["リンククリック", m?.clicks], ["クリック率", m?.clickRate == null ? "—" : `${m.clickRate.toFixed(2)}%`], ["成果件数", m?.conversions], ["コンバージョン率", m?.conversionRate == null ? "—" : `${m.conversionRate.toFixed(2)}%`], ["成果金額", m ? `¥${Math.round(m.valueCents / 100).toLocaleString()}` : "—"]].map(([label, val]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t(String(label))}</p><p className="text-xl font-bold tabular-nums">{val ?? "—"}</p></CardContent></Card>)}
    </div>
    {summaryQ.data?.reference && <p className="text-xs text-amber-700">{t("データが5件未満のため参考値です")}</p>}
    <div className="grid gap-4 lg:grid-cols-3">
      <Card><CardHeader><CardTitle className="text-base flex gap-2"><Target className="h-4 w-4" />{t("成果目標")}</CardTitle><CardDescription>{t("問い合わせ・予約・購入など、投稿で増やしたい成果です。")}</CardDescription></CardHeader><CardContent className="space-y-3">
        <div className="space-y-1"><Label>{t("表示名")}</Label><Input value={goalName} onChange={e => setGoalName(e.target.value)} /></div>
        <Select value={goalType} onValueChange={v => setGoalType(v as typeof goalType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map(x => <SelectItem key={x} value={x}>{t(TYPE_LABELS[x])}</SelectItem>)}</SelectContent></Select>
        <Input type="url" placeholder={t("遷移先URL（任意）")} value={destination} onChange={e => setDestination(e.target.value)} />
        <div className="grid grid-cols-2 gap-2"><Input type="number" min={1} max={5} aria-label={t("優先度")} value={goalPriority} onChange={e => setGoalPriority(Number(e.target.value))} /><Input type="number" min={0} placeholder={t("金額換算値（円）")} value={goalValue} onChange={e => setGoalValue(e.target.value)} /><Input placeholder={t("対象地域")} value={goalRegion} onChange={e => setGoalRegion(e.target.value)} /><Input placeholder={t("キャンペーン名")} value={goalCampaign} onChange={e => setGoalCampaign(e.target.value)} /><Input className="col-span-2" type="number" min={1} max={365} aria-label={t("計測期間（日）")} value={attributionDays} onChange={e => setAttributionDays(Number(e.target.value))} /></div>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={goalPrimary} onChange={e => setGoalPrimary(e.target.checked)} />{t("主要な成果目標")}</label>
        <Button disabled={!goalName.trim()} onClick={() => goalMut.mutate({ name: goalName, type: goalType, destinationUrl: destination || null, enabled: true, priority: goalPriority, valueCents: goalValue ? Math.round(Number(goalValue) * 100) : null, currency: "JPY", region: goalRegion || null, campaign: goalCampaign || null, attributionDays, primary: goalPrimary || (goalsQ.data?.length ?? 0) === 0 })}>{t("目標を追加")}</Button>
        <ul className="text-sm space-y-1">{goalsQ.data?.map(g => <li key={g.id} className="border rounded p-2 flex items-center justify-between gap-2"><span>{g.primary ? "★ " : ""}{g.name}<span className="text-xs text-muted-foreground ml-2">{t(TYPE_LABELS[g.type as typeof TYPES[number]] ?? g.type)}</span></span><Button size="sm" variant="ghost" onClick={() => goalUpdate.mutate({ id: g.id, value: { enabled: !g.enabled } })}>{g.enabled ? t("無効にする") : t("有効にする")}</Button></li>)}</ul>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base flex gap-2"><Link2 className="h-4 w-4" />{t("UTMリンク")}</CardTitle><CardDescription>{t("投稿からのアクセスを判別する計測情報をURLへ追加します。")}</CardDescription></CardHeader><CardContent className="space-y-3">
        <Input type="url" placeholder="https://example.com/page?existing=1#section" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} /><Input placeholder={t("キャンペーン名")} value={campaign} onChange={e => setCampaign(e.target.value)} />
        <Textarea readOnly value={previewQ.data?.url ?? ""} aria-label={t("UTM付きURLプレビュー")} />
        {previewQ.data?.url && <Button variant="outline" onClick={() => navigator.clipboard.writeText(previewQ.data.url)}>{t("コピー")}</Button>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base flex gap-2"><MousePointerClick className="h-4 w-4" />{t("手動成果登録")}</CardTitle><CardDescription>{t("正式連携がなくても成果を記録できます。変更時は履歴を保持します。")}</CardDescription></CardHeader><CardContent className="space-y-3">
        <Select value={eventType} onValueChange={v => setEventType(v as typeof eventType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{EVENT_TYPES.map(x => <SelectItem key={x} value={x}>{t(EVENT_LABELS[x])}</SelectItem>)}</SelectContent></Select>
        <div className="grid grid-cols-2 gap-2"><Select value={postId} onValueChange={setPostId}><SelectTrigger aria-label={t("対象投稿")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("投稿を指定しない")}</SelectItem>{postsQ.data?.map(post => <SelectItem key={post.id} value={String(post.id)}>#{post.id} {post.content.slice(0, 24)}</SelectItem>)}</SelectContent></Select><Select value={goalId} onValueChange={setGoalId}><SelectTrigger aria-label={t("成果目標")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("目標を指定しない")}</SelectItem>{goalsQ.data?.map(goal => <SelectItem key={goal.id} value={String(goal.id)}>{goal.name}</SelectItem>)}</SelectContent></Select></div>
        <Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} aria-label={t("成果日")} />
        <div className="grid grid-cols-2 gap-2"><Input type="number" min={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} aria-label={t("件数")} /><Input type="number" min={0} placeholder={t("金額（円）")} value={value} onChange={e => setValue(e.target.value)} /></div>
        <Textarea maxLength={500} placeholder={t("メモ（個人情報は入力しない）")} value={note} onChange={e => setNote(e.target.value)} />
        <Button onClick={() => manualMut.mutate({ eventType, eventTime: new Date(`${eventDate}T12:00:00`), quantity, postId: postId === "none" ? null : Number(postId), conversionGoalId: goalId === "none" ? null : Number(goalId), valueCents: value ? Math.round(Number(value) * 100) : null, currency: "JPY", note: note || null, source: "manual" })}>{t("成果を登録")}</Button>
        <div className="border-t pt-3 space-y-2"><Label>{t("CSVインポート")}</Label><input type="file" accept=".csv,text/csv" aria-label={t("CSVファイル")} onChange={async event => { const file = event.target.files?.[0]; if (file && file.size <= 256_000) setCsv(await file.text()); event.target.value = ""; }} /><Button size="sm" variant="outline" disabled={!csv || csvMut.isPending} onClick={() => csvMut.mutate({ csv })}>{t("CSVを読み込む")}</Button></div>
      </CardContent></Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">{t("成果の比較")}</CardTitle><CardDescription>{t("トレンド利用とAI作成が成果にどう関係したかを参考値で比較します。")}</CardDescription></CardHeader><CardContent className="space-y-2 text-sm">{summaryQ.data && [["トレンド使用", summaryQ.data.comparisons.trend.used], ["トレンド未使用", summaryQ.data.comparisons.trend.unused], ["AI生成", summaryQ.data.comparisons.creation.ai], ["手動作成", summaryQ.data.comparisons.creation.manual]].map(([label, metric]) => { const x = metric as typeof m; return <div key={String(label)} className="grid grid-cols-3 gap-2 border-b py-2"><span>{t(String(label))}</span><span>{t("クリック")}: {x?.clicks ?? 0}</span><span>{t("成果")}: {x?.conversions ?? 0}</span></div>; })}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">{t("内訳")}</CardTitle><CardDescription>{t("投稿・キャンペーン・目標ごとの成果です。")}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm">{summaryQ.data && <><div><strong>{t("投稿別")}</strong>{summaryQ.data.byPost.length ? summaryQ.data.byPost.map(row => <p key={row.postId}>#{row.postId}: {row.conversions}{t("件")} / {row.clicks}{t("クリック")}</p>) : <p className="text-muted-foreground">{t("データ未取得")}</p>}</div><div><strong>{t("キャンペーン別")}</strong>{summaryQ.data.byCampaign.map(row => <p key={row.campaign}>{row.campaign}: {row.conversions}{t("件")}</p>)}</div><div><strong>{t("目標別")}</strong>{summaryQ.data.byGoal.map(row => <p key={row.id}>{row.name}: {row.conversions}{t("件")}</p>)}</div></>}</CardContent></Card>
    </div>
    {summaryQ.data?.events.length ? <Card><CardHeader><CardTitle className="text-base">{t("最近の成果イベント")}</CardTitle><CardDescription>{t("修正すると変更前の内容と理由が履歴に残ります。")}</CardDescription></CardHeader><CardContent className="space-y-2 text-sm">{summaryQ.data.events.slice(0, 10).map(event => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2"><span>{new Date(event.eventTime).toLocaleDateString()} · {t(EVENT_LABELS[event.eventType as typeof EVENT_TYPES[number]] ?? event.eventType)} · {event.quantity}{t("件")}</span><Button size="sm" variant="ghost" onClick={() => { const next = window.prompt(t("修正後の件数"), String(event.quantity)); if (!next) return; const reason = window.prompt(t("修正理由")); if (reason) reviseMut.mutate({ id: event.id, value: { quantity: Number(next) }, reason }); }}>{t("修正")}</Button></div>)}</CardContent></Card> : null}
  </div>;
}
