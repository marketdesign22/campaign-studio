import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Target } from "lucide-react";
import { DEFAULT_PURPOSE_RATIOS, purposeRatiosSchema } from "@shared/contentStrategy";
import type { z } from "zod";

type PurposeRatios = z.infer<typeof purposeRatiosSchema>;
const RATIO_FIELDS: Array<[keyof PurposeRatios, string]> = [
  ["awarenessEmpathy", "認知・共感"], ["educationExpertise", "教育・専門性"],
  ["trustResults", "信頼・実績"], ["community", "会話・コミュニティ"], ["salesInquiry", "販売・問い合わせ"],
];

export function ContentOsSettingsCard() {
  const { t } = useI18n(); const q = trpc.settings.get.useQuery(); const utils = trpc.useUtils();
  const [weekly, setWeekly] = useState(7), [cta, setCta] = useState(""), [forbidden, setForbidden] = useState(""), [strictness, setStrictness] = useState<"standard" | "strict">("standard");
  const [ratios, setRatios] = useState<PurposeRatios>({ ...DEFAULT_PURPOSE_RATIOS });
  const [autoStrategy, setAutoStrategy] = useState(false), [review, setReview] = useState(true), [tracking, setTracking] = useState(true), [limit, setLimit] = useState(10);
  useEffect(() => { if (!q.data) return; setWeekly(q.data.weeklyPostCount); setCta(q.data.defaultCta ?? ""); try { setForbidden((JSON.parse(q.data.forbiddenTopics ?? "[]") as string[]).join("\n")); } catch { setForbidden(""); } try { setRatios(q.data.purposeRatios ? JSON.parse(q.data.purposeRatios) as PurposeRatios : { ...DEFAULT_PURPOSE_RATIOS }); } catch { setRatios({ ...DEFAULT_PURPOSE_RATIOS }); } setStrictness(q.data.qualityStrictness); setAutoStrategy(q.data.autoWeeklyStrategy); setReview(q.data.weeklyReviewEnabled); setTracking(q.data.conversionTrackingEnabled); setLimit(q.data.strategyAiDailyLimit); }, [q.data]);
  const save = trpc.settings.saveOps.useMutation({ onSuccess: () => { utils.settings.get.invalidate(); toast.success(t("コンテンツ運用設定を保存しました")); }, onError: e => toast.error(e.message) });
  const row = (label: string, value: boolean, set: (v: boolean) => void) => <div className="flex items-center justify-between gap-3"><Label>{t(label)}</Label><Switch checked={value} onCheckedChange={set} /></div>;
  return <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" />{t("コンテンツ運用OS設定")}</CardTitle><CardDescription>{t("選択中クライアントだけに適用されます。")}</CardDescription></CardHeader><CardContent className="space-y-4">
    <div className="grid sm:grid-cols-2 gap-3"><div><Label>{t("週間の投稿数")}</Label><Input type="number" min={1} max={42} value={weekly} onChange={e => setWeekly(Number(e.target.value))} /></div><div><Label>{t("AI利用上限（1日）")}</Label><Input type="number" min={0} max={100} value={limit} onChange={e => setLimit(Number(e.target.value))} /></div></div>
    <div><Label>{t("既定CTA")}</Label><Input value={cta} onChange={e => setCta(e.target.value)} placeholder={t("例: 詳細はプロフィールのリンクから")} /></div>
    <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("投稿目的の比率")}</legend><div className="grid grid-cols-2 sm:grid-cols-5 gap-2">{RATIO_FIELDS.map(([key, label]) => <div key={key}><Label className="text-xs">{t(label)} (%)</Label><Input aria-label={`${t(label)} (%)`} type="number" min={0} max={100} value={ratios[key]} onChange={e => setRatios(prev => ({ ...prev, [key]: Number(e.target.value) }))} /></div>)}</div><p className={`text-xs ${Object.values(ratios).reduce((sum, value) => sum + value, 0) === 100 ? "text-muted-foreground" : "text-destructive"}`}>{t("合計")}: {Object.values(ratios).reduce((sum, value) => sum + value, 0)}%</p></fieldset>
    <div><Label>{t("禁止テーマ・禁止表現（1行1件）")}</Label><Textarea value={forbidden} onChange={e => setForbidden(e.target.value)} rows={3} /></div>
    <div><Label>{t("品質チェックの厳しさ")}</Label><Select value={strictness} onValueChange={v => setStrictness(v as typeof strictness)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="standard">{t("標準")}</SelectItem><SelectItem value="strict">{t("厳格")}</SelectItem></SelectContent></Select></div>
    {row("週間戦略の自動作成", autoStrategy, setAutoStrategy)}{row("週間振り返り", review, setReview)}{row("コンバージョン計測", tracking, setTracking)}
    <Button className="w-full" disabled={save.isPending || Object.values(ratios).reduce((sum, value) => sum + value, 0) !== 100} onClick={() => save.mutate({ weeklyPostCount: weekly, purposeRatios: ratios, defaultCta: cta || null, forbiddenTopics: JSON.stringify(forbidden.split("\n").map(x => x.trim()).filter(Boolean)), qualityStrictness: strictness, strategyAiDailyLimit: limit, autoWeeklyStrategy: autoStrategy, weeklyReviewEnabled: review, conversionTrackingEnabled: tracking })}>{t("保存")}</Button>
  </CardContent></Card>;
}
