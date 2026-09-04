import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAccount } from "@/contexts/AccountContext";
import { slotLabel } from "@/lib/slotLabel";
import {
  canSave, countChars, isDirty as draftIsDirty, isBlocking, lengthState,
  MAX_POST_LENGTH, validateDraft,
} from "@shared/postDraft";
import { REWRITE_PRESET_LABELS } from "@/lib/rewritePresets";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CalendarPlus, CheckCheck, FileUp, ImagePlus, Pencil, Plus, Repeat, RotateCcw, Send, Sparkles, Trash2, Undo2, Upload, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/i18n";

/**
 * インポート欄のテキストを投稿の配列に分割する。
 * `---` だけの行があればそれを区切りとした複数行投稿、なければ1行1投稿。
 */
function splitImportPosts(text: string): string[] {
  const hasDelimiter = text.split("\n").some(l => l.trim() === "---");
  const parts = hasDelimiter
    ? text.split(/^\s*---\s*$/m)
    : text.split("\n");
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

/**
 * インポート用ファイルを投稿の配列に変換する。
 * - .md はコードブロック（``` 〜 ```）を1投稿として抽出。無ければ空行区切り
 * - .txt はそのまま行分割
 * - .csv / .tsv / .xlsx / .xls は SheetJS（動的import・初回のみ読込）で解析し、
 *   「文字量が最も多い列」を本文列とみなして抽出する（No.列や日付列を自動で除外）
 */
async function parseImportFile(file: File): Promise<string[]> {
  const clean = (lines: string[]) =>
    lines.map(l => l.trim()).filter(l => l.length > 0);

  const name = file.name.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    const text = await file.text();
    const blocks: string[] = [];
    const re = /```[^\n]*\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const block = m[1].trim();
      if (block) blocks.push(block);
    }
    if (blocks.length > 0) return blocks;
    // コードブロックが無いMarkdownは空行区切りの段落を投稿とみなす
    return text
      .split(/\n\s*\n/)
      .map(p => p.replace(/^#+\s.*$/gm, "").trim())
      .filter(p => p.length > 0);
  }
  if (name.endsWith(".txt")) {
    return clean((await file.text()).split(/\r?\n/));
  }

  const XLSX = await import("xlsx");
  // CSV/TSVはUTF-8テキストとして読む（バイト列で渡すと日本語が文字化けする）
  const wb =
    name.endsWith(".csv") || name.endsWith(".tsv")
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows: unknown[][] = [];
  for (const sheetName of wb.SheetNames) {
    rows.push(
      ...XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
        header: 1,
        raw: false,
      })
    );
  }

  const cellText = (c: unknown) => (c == null ? "" : String(c).trim());
  const colScore = new Map<number, number>();
  for (const row of rows) {
    row.forEach((c, i) => {
      const s = cellText(c);
      if (s) colScore.set(i, (colScore.get(i) ?? 0) + s.length);
    });
  }
  const bestCol =
    Array.from(colScore.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

  const lines = clean(rows.map(row => cellText(row[bestCol])));
  // 先頭行がヘッダーらしければ除外
  if (lines.length > 1 && /^(内容|本文|投稿(内容|文)?|posts?|contents?|texts?|captions?)$/i.test(lines[0])) {
    lines.shift();
  }
  return lines;
}

/**
 * 画像を投稿用に縮小してJPEGのdata URLにする。
 * Threadsの推奨幅は1440pxまで。DB保存量とアップロード時間を抑えるため、
 * 送信前にブラウザ側でリサイズ・再エンコードする。
 */
async function toUploadableJpeg(file: File, maxSide = 1440, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  // 透過PNGをJPEGにすると黒背景になるので白で下地を塗る
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-primary/10 text-primary",
  posted: "bg-emerald-600/10 text-emerald-700",
  error: "bg-destructive/10 text-destructive",
};
const STATUS_LABELS: Record<string, string> = { pending: "未投稿", posted: "投稿済み", error: "エラー" };

const TONES = [
  { value: "standard" as const, label: "いつものトーン" },
  { value: "casual" as const, label: "カジュアル" },
  { value: "formal" as const, label: "フォーマル" },
  { value: "energetic" as const, label: "元気" },
];

export default function Posts() {
  const { t, lang } = useI18n();
  const { data: postList = [], isLoading } = trpc.posts.list.useQuery();
  const { data: cats = [] } = trpc.categories.list.useQuery();
  const { accounts, current: currentAccount } = useAccount();
  const accountSlots = currentAccount?.slots ?? [];
  // 一覧はすべて選択中アカウントの原稿なので、移動先には他のアカウントだけを出す
  const otherAccounts = accounts.filter(a => a.id !== currentAccount?.id);
  const { data: settings } = trpc.settings.get.useQuery();
  const utils = trpc.useUtils();
  const invalidate = () => { utils.posts.list.invalidate(); utils.posts.nextPreview.invalidate(); utils.posts.runway.invalidate(); };

  const createMut = trpc.posts.create.useMutation({ onSuccess: () => { toast.success(t("追加しました")); invalidate(); setOpen(false); }, onError: e => toast.error(e.message) });
  const postNowMut = trpc.manualPost.post.useMutation({
    onSuccess: () => { toast.success(t("Threadsに投稿しました")); invalidate(); },
    onError: e => { toast.error(e.message); invalidate(); },
  });
  const updateMut = trpc.posts.update.useMutation({ onSuccess: () => { toast.success(t("更新しました")); invalidate(); setOpen(false); }, onError: e => toast.error(e.message) });
  const deleteMut = trpc.posts.delete.useMutation({ onSuccess: () => { toast.success(t("削除しました")); invalidate(); }, onError: e => toast.error(e.message) });
  const evergreenMut = trpc.posts.update.useMutation({
    onSuccess: () => { toast.success(t("再投稿コンテンツの設定を更新しました")); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const bulkAssignMut = trpc.posts.bulkAssignAccount.useMutation({
    onSuccess: d => { toast.success(`${d.count}${t("件を移動しました")}`); setSelected(new Set()); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const bulkDeleteMut = trpc.posts.bulkDelete.useMutation({
    onSuccess: d => { toast.success(`${d.count}${t("件削除しました")}`); setSelected(new Set()); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const { data: runway } = trpc.posts.runway.useQuery();
  const autoScheduleMut = trpc.posts.autoSchedule.useMutation({
    onSuccess: () => { toast.success(t("空き枠に割り当てました")); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const uploadMedia = trpc.media.upload.useMutation();

  async function handlePickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await toUploadableJpeg(file);
      const res = await uploadMedia.mutateAsync({ dataUrl });
      setImageUrl(res.url);
      toast.success(t("画像を添付しました"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("画像の処理に失敗しました"));
    } finally {
      setUploading(false);
    }
  }

  const importMut = trpc.posts.bulkImport.useMutation({ onSuccess: d => { toast.success(`${d.count}${t("件インポートしました")}`); invalidate(); setImportOpen(false); setImportText(""); }, onError: e => toast.error(e.message) });
  const approvalMut = trpc.posts.setApproval.useMutation({ onSuccess: () => invalidate(), onError: e => toast.error(e.message) });
  const aiGenerate = trpc.ai.generateDrafts.useMutation({ onError: e => toast.error(e.message) });
  // リライト結果は本文へ即時反映しない。案として保持し、利用者が適用を選ぶ
  const aiRewrite = trpc.ai.rewrite.useMutation({
    onSuccess: d => setRewriteDraft(d),
    onError: e => toast.error(e.message),
  });
  const { data: aiStatus } = trpc.ai.status.useQuery(undefined, { staleTime: 60_000 });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<typeof postList[0] | null>(null);
  const [content, setContent] = useState("");
  const [slotIndex, setSlotIndex] = useState(0);
  const [catId, setCatId] = useState<number | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [rewritePreset, setRewritePreset] = useState<string>("");
  /** AIの提案。適用するまで本文は変えない */
  const [rewriteDraft, setRewriteDraft] = useState<
    { content: string; changeSummary: string[]; warnings: string[] } | null
  >(null);
  /** 「リライト前に戻す」用に、適用直前の本文を1つ保持する */
  const [contentBeforeRewrite, setContentBeforeRewrite] = useState<string | null>(null);
  /** 開いた時点の値。未保存の変更があるかの判定に使う */
  const [initialDraft, setInitialDraft] = useState({
    content: "", scheduledDate: "", slotIndex: 0, imageUrl: null as string | null,
  });
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const importFileRef = useRef<HTMLInputElement>(null);

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const posts = await parseImportFile(file);
      if (posts.length === 0) {
        toast.error(t("ファイルから投稿を検出できませんでした"));
        return;
      }
      // 複数行の投稿が1つでもあれば `---` 区切り形式でテキスト欄に流し込む
      const multiline = posts.some(p => p.includes("\n"));
      const joined = multiline ? posts.join("\n---\n") : posts.join("\n");
      setImportText(prev =>
        (prev.trim() ? prev.replace(/\s+$/, "") + (multiline ? "\n---\n" : "\n") : "") + joined
      );
      toast.success(`${posts.length}${t("件読み込みました")}`);
    } catch {
      toast.error(t("ファイルの読み込みに失敗しました"));
    }
  }
  const [importCatId, setImportCatId] = useState<number | null>(null);

  // AI assist dialog
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiTone, setAiTone] = useState<typeof TONES[number]["value"]>("standard");
  const [aiLang, setAiLang] = useState<"ja" | "en">(lang);
  /** AIの案。角度と参考にした傾向を持つ（トレンド未反映なら空） */
  const [aiVariants, setAiVariants] = useState<{ content: string; angle: string | null; referencedTrends: string[] }[]>([]);
  const [aiResultAnalysisId, setAiResultAnalysisId] = useState<number | null>(null);
  // トレンド反映（切替式）。分析は選択中アカウントのものだけ選べる
  const [aiTrendOn, setAiTrendOn] = useState(false);
  const [aiTrendPeriod, setAiTrendPeriod] = useState<"24h" | "7d" | "30d">("7d");
  const [aiPlatform, setAiPlatform] = useState<"threads" | "instagram">("threads");
  const [aiRegion, setAiRegion] = useState<"JP" | "US" | "OTHER">("JP");
  const [aiPurpose, setAiPurpose] = useState<"awareness" | "follow" | "inquiry" | "recruit" | "sales">("awareness");
  const [aiStrength, setAiStrength] = useState<"weak" | "medium" | "strong">("medium");
  const trendAnalysisQ = trpc.trends.latestAnalysis.useQuery({ period: aiTrendPeriod }, { enabled: aiOpen && aiTrendOn });
  /** 原稿に付けるトレンド参照。編集ダイアログを開く時に決まり、保存時に一緒に送る */
  const [draftTrend, setDraftTrend] = useState<{ analysisId: number; angle: string | null; referencedTrends: string[] } | null>(null);

  // トレンド画面から「この傾向から原稿を作る」で来た場合: ?ai=1&trend=ID&topic=...
  const search = useSearch();
  const [, setLocation] = useLocation();
  useEffect(() => {
    const q = new URLSearchParams(search);
    if (q.get("ai") !== "1") return;
    const trendId = Number(q.get("trend"));
    const period = q.get("period");
    if (period === "24h" || period === "7d" || period === "30d") setAiTrendPeriod(period);
    setAiTopic(q.get("topic") ?? "");
    setAiTrendOn(Number.isInteger(trendId) && trendId > 0);
    setAiVariants([]);
    setAiOpen(true);
    setLocation("/posts", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  /** ダイアログを開くときの共通処理。未保存判定の基準も同時に記録する */
  function openDialog(base: {
    editing: typeof postList[0] | null;
    content: string; slotIndex: number; categoryId: number | null;
    scheduledDate: string; imageUrl: string | null;
    trend?: { analysisId: number; angle: string | null; referencedTrends: string[] } | null;
  }) {
    setEditing(base.editing);
    setDraftTrend(base.trend ?? null);
    setContent(base.content);
    setSlotIndex(base.slotIndex);
    setCatId(base.categoryId);
    setScheduledDate(base.scheduledDate);
    setImageUrl(base.imageUrl);
    setInitialDraft({
      content: base.content, scheduledDate: base.scheduledDate,
      slotIndex: base.slotIndex, imageUrl: base.imageUrl,
    });
    setRewriteInstruction("");
    setRewritePreset("");
    setRewriteDraft(null);
    setContentBeforeRewrite(null);
    setOpen(true);
  }

  function openCreate() {
    openDialog({ editing: null, content: "", slotIndex: 0, categoryId: null, scheduledDate: "", imageUrl: null });
  }
  function openEdit(p: typeof postList[0]) {
    openDialog({
      editing: p, content: p.content, slotIndex: p.slotIndex, categoryId: p.categoryId,
      scheduledDate: p.scheduledDate ?? "", imageUrl: p.imageUrl ?? null,
    });
  }

  const currentDraft = { content, scheduledDate, slotIndex, imageUrl };
  const dirty = draftIsDirty(currentDraft, initialDraft);
  const today = runway?.today ?? new Date().toISOString().slice(0, 10);
  const issues = validateDraft(
    { content, scheduledDate, slotIndex, editingId: editing?.id ?? null },
    postList,
    today
  );
  const blocked = isBlocking(issues);
  const saving = createMut.isPending || updateMut.isPending || postNowMut.isPending;
  const charCount = countChars(content);
  const charState = lengthState(content);

  /** 未保存の変更があれば確認してから閉じる */
  function requestClose(next: boolean) {
    if (next) { setOpen(true); return; }
    if (dirty && !confirm(t("保存されていない変更があります。破棄してよろしいですか？"))) return;
    setOpen(false);
  }

  function handleSave() {
    if (blocked || saving) return;
    const date = scheduledDate || null;
    if (editing) updateMut.mutate({ id: editing.id, content, slotIndex, categoryId: catId, scheduledDate: date, imageUrl });
    else createMut.mutate({ content, slotIndex, categoryId: catId, scheduledDate: date, imageUrl, ...trendFields() });
  }
  /** 原稿に付けるトレンド参照（学習サイクルで成果を比較するため）。無ければ何も付けない */
  function trendFields() {
    return draftTrend
      ? { trendAnalysisId: draftTrend.analysisId, trendMeta: { angle: draftTrend.angle, referencedTrends: draftTrend.referencedTrends } }
      : {};
  }

  /** AIの案を本文へ反映する。直前の本文は「戻す」ために保持しておく */
  function applyRewrite() {
    if (!rewriteDraft) return;
    setContentBeforeRewrite(content);
    setContent(rewriteDraft.content);
    setRewriteDraft(null);
    toast.success(t("リライト案を適用しました"));
  }
  function undoRewrite() {
    if (contentBeforeRewrite === null) return;
    setContent(contentBeforeRewrite);
    setContentBeforeRewrite(null);
    toast.success(t("リライト前に戻しました"));
  }
  async function handleSaveAndPostNow() {
    try {
      const created = await createMut.mutateAsync({ content, slotIndex, categoryId: catId, scheduledDate: scheduledDate || null, imageUrl, ...trendFields() });
      postNowMut.mutate({ postId: created.id });
    } catch {
      // createMut.onError already surfaced the toast
    }
  }
  function handleImport() {
    const all = splitImportPosts(importText);
    const lines = all.filter(l => l.length <= 500);
    if (!lines.length) { toast.error(t("有効な投稿内容がありません")); return; }
    if (all.length > lines.length) {
      toast.warning(`${all.length - lines.length}${t("件は500文字を超えているためスキップされます")}`);
    }
    importMut.mutate({ lines, categoryId: importCatId, postsPerDay: 2 });
  }
  function handleAiGenerate() {
    if (!aiTopic.trim()) return;
    if (aiTrendOn && !trendAnalysisQ.data) {
      toast.error(t("この期間のトレンド分析がありません。トレンド画面で「AIで分析」を実行してください。"));
      return;
    }
    setAiVariants([]);
    setAiResultAnalysisId(null);
    aiGenerate.mutate({
      topic: aiTopic.trim(), tone: aiTone, count: 3, language: aiLang,
      trend: aiTrendOn && trendAnalysisQ.data
        ? { analysisId: trendAnalysisQ.data.analysisId, platform: aiPlatform, region: aiRegion, purpose: aiPurpose, strength: aiStrength }
        : undefined,
    }, {
      onSuccess: d => { setAiVariants(d.variants); setAiResultAnalysisId(d.trendAnalysisId); },
    });
  }
  /** AI案から原稿へ。トレンド反映で生成した案には分析IDと参考傾向を付ける */
  function trendOf(v: { angle: string | null; referencedTrends: string[] }) {
    return aiResultAnalysisId ? { analysisId: aiResultAnalysisId, angle: v.angle, referencedTrends: v.referencedTrends } : null;
  }
  const catMap = Object.fromEntries(cats.map(c => [c.id, c]));
  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]));
  const approvalEnabled = settings?.requireApproval ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Contents"
        title={t("投稿原稿管理")}
        description={approvalEnabled ? t("承認フロー有効：承認済みの原稿のみ自動投稿されます") : t("原稿の追加・編集・削除・一括インポート")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => { setAiOpen(true); }}>
              <Sparkles className="h-4 w-4 mr-1.5 text-[var(--brand-accent-deep)]" />{t("AIアシスト")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1.5" /><span className="hidden sm:inline">{t("一括インポート")}</span><span className="sm:hidden">{t("インポート")}</span></Button>
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />{t("新規追加")}</Button>
          </>
        }
      />

      {runway && (
        <Card className="border shadow-none">
          <CardContent className="py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("予約済みの配信")}</p>
              <p className="text-lg font-semibold tabular-nums">
                {runway.days}{t("日分")}
                {runway.lastDate && <span className="text-xs font-normal text-muted-foreground ml-2">{t("〜")}{runway.lastDate}</span>}
              </p>
            </div>
            {runway.gapDates.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">{t("投稿が途切れる日")}</p>
                <p className="text-lg font-semibold tabular-nums text-amber-600">
                  {runway.gapDates.length}{t("日")}
                  <span className="text-xs font-normal text-muted-foreground ml-2">{runway.gapDates.slice(0, 3).join(", ")}{runway.gapDates.length > 3 ? "…" : ""}</span>
                </p>
              </div>
            )}
            {runway.unscheduled > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">{t("日付未定の原稿")}</p>
                <p className="text-lg font-semibold tabular-nums">{runway.unscheduled}{t("件")}</p>
              </div>
            )}
            <Button size="sm" variant="outline" className="ml-auto"
              disabled={autoScheduleMut.isPending || !runway.unscheduled}
              onClick={() => autoScheduleMut.mutate({ postsPerDay: 2 })}>
              <CalendarPlus className="h-4 w-4 mr-1.5" />
              {autoScheduleMut.isPending ? t("割り当て中...") : t("空き枠に自動割り当て")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border shadow-none">
        <CardContent className="p-0">
          {isLoading ? <div className="py-16 text-center text-muted-foreground text-sm">{t("読み込み中...")}</div>
          : postList.length === 0 ? <div className="py-16 text-center text-muted-foreground text-sm">{t("原稿がありません。「新規追加」「AIアシスト」「一括インポート」から作成してください。")}</div>
          : (
            <div className="divide-y">
              {/* 選択ツールバー */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                <Checkbox
                  checked={selected.size > 0 && selected.size === postList.length}
                  onCheckedChange={v => setSelected(v ? new Set(postList.map(p => p.id)) : new Set())}
                  aria-label={t("すべて選択")}
                />
                <span className="text-xs text-muted-foreground">
                  {selected.size > 0 ? `${selected.size}${t("件選択中")}` : t("すべて選択")}
                </span>
                {selected.size > 0 && otherAccounts.length > 0 && (
                  <Select value="" onValueChange={v => bulkAssignMut.mutate({ ids: Array.from(selected), accountId: Number(v) })}>
                    <SelectTrigger className="h-7 w-[190px] text-xs ml-auto">
                      <SelectValue placeholder={t("別のアカウントへ移動")} />
                    </SelectTrigger>
                    <SelectContent>
                      {otherAccounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {selected.size > 0 && (
                  <Button size="sm" variant="destructive" className={`h-7 text-xs ${otherAccounts.length > 0 ? "" : "ml-auto"}`}
                    disabled={bulkDeleteMut.isPending}
                    onClick={() => { if (confirm(`${selected.size}${t("件の原稿を削除しますか？この操作は取り消せません。")}`)) bulkDeleteMut.mutate({ ids: Array.from(selected) }); }}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" />{bulkDeleteMut.isPending ? t("削除中...") : t("選択を削除")}
                  </Button>
                )}
              </div>
              {postList.map(p => {
                const cat = p.categoryId ? catMap[p.categoryId] : null;
                const account = p.accountId ? accountMap[p.accountId] : null;
                const isDraft = p.approvalStatus === "draft";
                return (
                  <div key={p.id} className={`flex items-start gap-3 p-4 transition-colors ${selected.has(p.id) ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                    <Checkbox className="mt-1" checked={selected.has(p.id)}
                      onCheckedChange={v => setSelected(prev => { const next = new Set(prev); if (v) next.add(p.id); else next.delete(p.id); return next; })}
                      aria-label={t("選択")}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[p.status]}`}>{t(STATUS_LABELS[p.status])}</span>
                        {isDraft && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-700">{t("未承認")}</span>
                        )}
                        {p.evergreen && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-sky-500/15 text-sky-700 inline-flex items-center gap-1">
                            <Repeat className="h-3 w-3" />{t("再投稿")}{p.recycleCount > 0 ? ` ×${p.recycleCount}` : ""}
                          </span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">{slotLabel(accountSlots, p.slotIndex, t("枠"))}</span>
                        {p.scheduledDate && <span className="text-xs text-muted-foreground tabular-nums">{p.scheduledDate}</span>}
                        {cat && <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: cat.color }}>{cat.name}</span>}
                        {account && accounts.length > 1 && (
                          <span className="text-xs text-muted-foreground">@{account.name}</span>
                        )}
                      </div>
                      <div className="flex items-start gap-3">
                        {p.imageUrl && (
                          <img src={p.imageUrl} alt="" className="h-14 w-14 rounded-md object-cover border shrink-0" />
                        )}
                        <p className="text-sm leading-relaxed line-clamp-3">{p.content}</p>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {approvalEnabled && p.status === "pending" && (
                        isDraft ? (
                          <Button size="sm" variant="outline" className="h-8 text-xs text-emerald-700 border-emerald-600/30 hover:bg-emerald-600/5"
                            title={t("承認")}
                            onClick={() => approvalMut.mutate({ id: p.id, approvalStatus: "approved" })}>
                            <CheckCheck className="h-3.5 w-3.5 mr-1" />{t("承認")}
                          </Button>
                        ) : (
                          <Button size="icon" variant="ghost" className="h-8 w-8" title={t("下書きに戻す")} aria-label={t("下書きに戻す")}
                            onClick={() => approvalMut.mutate({ id: p.id, approvalStatus: "draft" })}>
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        )
                      )}
                      {p.status === "pending" && !isDraft && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" title={t("今すぐ投稿")} aria-label={t("今すぐ投稿")}
                          disabled={postNowMut.isPending}
                          onClick={() => { if (confirm(t("今すぐThreadsに投稿しますか？"))) postNowMut.mutate({ postId: p.id }); }}>
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {p.status !== "pending" && <Button size="icon" variant="ghost" className="h-8 w-8" title={t("未投稿に戻す")} aria-label={t("未投稿に戻す")} onClick={() => updateMut.mutate({ id: p.id, status: "pending" })}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="ghost"
                        className={`h-8 w-8 ${p.evergreen ? "text-sky-600" : ""}`}
                        title={p.evergreen ? t("再投稿コンテンツから外す") : t("再投稿コンテンツにする")}
                        aria-label={p.evergreen ? t("再投稿コンテンツから外す") : t("再投稿コンテンツにする")}
                        onClick={() => evergreenMut.mutate({ id: p.id, evergreen: !p.evergreen })}>
                        <Repeat className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={t("原稿を編集")} onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={t("削除")} onClick={() => { if (confirm(t("削除しますか？"))) deleteMut.mutate({ id: p.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit/Create Dialog */}
      <Dialog open={open} onOpenChange={requestClose}>
        {/*
          高さを画面内に収め、本文エリアだけをスクロールさせる。
          見出しと操作は上下に固定して、長い本文でも常に保存へ手が届くようにする。
        */}
        <DialogContent className="sm:max-w-[760px] max-h-[92dvh] h-[92dvh] sm:h-auto flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              {editing ? t("原稿を編集") : t("新規原稿を追加")}
              {dirty && (
                <span className="text-xs font-normal text-[var(--brand-accent-deep)] bg-[var(--brand-accent)]/12 rounded-full px-2 py-0.5">
                  {t("未保存")}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
            {/* 本文 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="post-content">{t("投稿内容")}</Label>
                <span
                  className={`text-xs tabular-nums ${
                    charState === "error" ? "text-destructive font-semibold"
                    : charState === "warn" ? "text-amber-600 font-medium"
                    : "text-muted-foreground"
                  }`}
                  aria-live="polite"
                >
                  {charCount} / {MAX_POST_LENGTH}
                </span>
              </div>
              <Textarea
                id="post-content"
                rows={8}
                value={content}
                onChange={e => setContent(e.target.value)}
                className="resize-y min-h-[140px]"
                aria-describedby="post-content-help"
              />
              <p id="post-content-help" className="text-xs text-muted-foreground">
                {issues.some(i => i.kind === "blank")
                  ? <span className="text-destructive">{t("本文を入力してください。")}</span>
                  : charState === "error"
                    ? <span className="text-destructive">{t("500文字を超えています。")}</span>
                    : t("日本語・英語・絵文字を含めて500文字までです。")}
              </p>

              {/* AIリライト */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--brand-accent-deep)]" />
                    {t("AIリライト")}
                  </span>
                  {contentBeforeRewrite !== null && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={undoRewrite}>
                      {t("リライト前に戻す")}
                    </Button>
                  )}
                </div>

                {!aiStatus?.configured ? (
                  <p className="text-xs text-muted-foreground">
                    {t("AI設定が必要です")}
                    <span className="ml-1">{t("（ANTHROPIC_API_KEY を設定してください）")}</span>
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {REWRITE_PRESET_LABELS.map(preset => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setRewritePreset(rewritePreset === preset.value ? "" : preset.value)}
                          aria-pressed={rewritePreset === preset.value}
                          className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                            rewritePreset === preset.value
                              ? "bg-[var(--brand-accent)] text-white border-transparent"
                              : "bg-card hover:bg-accent"
                          }`}
                        >
                          {t(preset.label)}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="flex-1 text-xs border rounded-md px-2.5 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder={t("AIへの指示（任意）")}
                        aria-label={t("AIへの指示（任意）")}
                        value={rewriteInstruction}
                        onChange={e => setRewriteInstruction(e.target.value)}
                        maxLength={300}
                      />
                      <Button
                        size="sm" variant="outline" className="h-8 text-xs shrink-0"
                        disabled={
                          !content.trim() ||
                          (!rewritePreset && !rewriteInstruction.trim()) ||
                          aiRewrite.isPending
                        }
                        onClick={() => aiRewrite.mutate({
                          content,
                          ...(rewritePreset ? { preset: rewritePreset as never } : {}),
                          ...(rewriteInstruction.trim() ? { instruction: rewriteInstruction.trim() } : {}),
                        })}
                      >
                        {aiRewrite.isPending ? t("生成中...") : t("リライト案を作る")}
                      </Button>
                    </div>
                  </>
                )}

                {/* 提案のプレビュー。適用するまで本文は変わらない */}
                {rewriteDraft && (
                  <div className="rounded-md border bg-card p-3 space-y-2.5" role="region" aria-label={t("リライト案")}>
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground mb-1">{t("元の文章")}</p>
                      <p className="text-xs whitespace-pre-wrap text-muted-foreground line-clamp-4">{content}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground mb-1">{t("リライト案")}</p>
                      <p className="text-sm whitespace-pre-wrap">{rewriteDraft.content}</p>
                    </div>
                    {rewriteDraft.changeSummary.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold text-muted-foreground mb-1">{t("変更点")}</p>
                        <ul className="text-xs list-disc pl-4 space-y-0.5 text-muted-foreground">
                          {rewriteDraft.changeSummary.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      </div>
                    )}
                    {rewriteDraft.warnings.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold text-amber-700 mb-1">{t("警告")}</p>
                        <ul className="text-xs list-disc pl-4 space-y-0.5 text-amber-700">
                          {rewriteDraft.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <Button size="sm" className="h-7 text-xs" onClick={applyRewrite}>{t("この案を適用")}</Button>
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs"
                        disabled={aiRewrite.isPending}
                        onClick={() => aiRewrite.mutate({
                          content,
                          ...(rewritePreset ? { preset: rewritePreset as never } : {}),
                          ...(rewriteInstruction.trim() ? { instruction: rewriteInstruction.trim() } : {}),
                        })}
                      >
                        {t("再生成")}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRewriteDraft(null)}>
                        {t("破棄")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 画像 */}
            <div className="space-y-1.5">
              <Label htmlFor="post-image">{t("画像（任意）")}</Label>
              <input
                ref={imageFileRef} id="post-image" type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only" onChange={handlePickImage}
              />
              {imageUrl ? (
                <div className="flex items-start gap-3">
                  <img src={imageUrl} alt={t("添付画像のプレビュー")} className="h-24 w-24 rounded-md object-cover border" />
                  <div className="flex flex-col gap-1.5">
                    <Button type="button" size="sm" variant="outline" onClick={() => imageFileRef.current?.click()} disabled={uploading}>
                      {uploading ? t("アップロード中...") : t("画像を差し替える")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setImageUrl(null)}>
                      <X className="h-3.5 w-3.5 mr-1" />{t("画像を削除")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => imageFileRef.current?.click()} disabled={uploading}>
                  <ImagePlus className="h-4 w-4 mr-1.5" />{uploading ? t("アップロード中...") : t("画像を追加")}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{t("JPEG / PNG / WebP・推奨 1080×1080 以上・4MBまで")}</p>
            </div>

            {/* 予約 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="post-date">{t("投稿日")}</Label>
                <Input id="post-date" type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  {scheduledDate ? t("この日の指定スロットに投稿されます。") : t("空欄なら「空き枠に自動割り当て」で最短の空きに入ります。")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="post-slot">{t("投稿スロット")}</Label>
                <Select value={String(slotIndex)} onValueChange={v => setSlotIndex(Number(v))}>
                  <SelectTrigger id="post-slot"><SelectValue /></SelectTrigger>
                  <SelectContent>{accountSlots.map((_, i) => <SelectItem key={i} value={String(i)}>{slotLabel(accountSlots, i, t("枠"))}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {accountSlots[slotIndex] ? slotLabel(accountSlots, slotIndex, t("枠")) : t("枠が未設定です")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="post-category">{t("カテゴリー")}</Label>
                <Select value={catId ? String(catId) : "none"} onValueChange={v => setCatId(v === "none" ? null : Number(v))}>
                  <SelectTrigger id="post-category"><SelectValue placeholder={t("なし")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("なし")}</SelectItem>
                    {cats.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 予約に関する警告（保存は妨げない） */}
            {issues.some(i => i.kind === "invalid_date" || i.kind === "past_date" || i.kind === "slot_taken") && (
              <ul className="text-xs space-y-1" role="status">
                {issues.map((i, k) =>
                  i.kind === "invalid_date" ? <li key={k} className="text-destructive">⚠ {t("投稿日の形式が正しくありません。")}</li>
                  : i.kind === "past_date" ? <li key={k} className="text-amber-700">⚠ {t("過去の日付です。次回のスケジューラ実行時に投稿されます。")}</li>
                  : i.kind === "slot_taken" ? <li key={k} className="text-amber-700">⚠ {t("同じ日・同じ枠に別の未投稿原稿があります。")}</li>
                  : null
                )}
              </ul>
            )}

            <p className="text-xs text-muted-foreground">
              {t("投稿先")}: <span className="font-medium text-foreground">{currentAccount?.name ?? "-"}</span>
              <span className="ml-1.5">{t("（左上の切り替えで変更できます）")}</span>
            </p>
          </div>

          <DialogFooter className="px-5 py-3.5 border-t shrink-0 gap-2">
            <Button variant="outline" onClick={() => requestClose(false)} disabled={saving}>{t("キャンセル")}</Button>
            {!editing && (
              <Button variant="outline" onClick={handleSaveAndPostNow} disabled={!canSave(content) || saving}>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {postNowMut.isPending ? t("投稿中...") : t("追加して今すぐ投稿")}
              </Button>
            )}
            <Button onClick={handleSave} disabled={blocked || saving}>
              {saving ? t("保存中…") : editing ? t("更新") : t("追加")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Assist Dialog */}
      <Dialog open={aiOpen} onOpenChange={v => { setAiOpen(v); if (!v) { setAiVariants([]); setAiResultAnalysisId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--brand-accent-deep)]" />{t("AIアシスト — 下書き生成")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("投稿テーマ")}</Label>
              <Textarea rows={2} placeholder={t("例: 8月23日開催のオープンキャンパスの告知。個別相談あり。")}
                value={aiTopic} onChange={e => setAiTopic(e.target.value)} maxLength={300} className="resize-none" />
              <p className="text-xs text-muted-foreground">{t("過去投稿の文体を学習し、ブランドボイスに合わせた案を3つ生成します。")}</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t("トレンドを反映")}</p>
                  <p className="text-xs text-muted-foreground">{t("AIの傾向分析を構成・切り口として使い、異なる角度の3案を作ります。他人の文章は使いません。")}</p>
                </div>
                <Switch checked={aiTrendOn} onCheckedChange={setAiTrendOn} />
              </div>
              {aiTrendOn && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("分析期間")}</Label>
                    <Select value={aiTrendPeriod} onValueChange={v => setAiTrendPeriod(v as typeof aiTrendPeriod)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24h">{t("24時間")}</SelectItem>
                        <SelectItem value="7d">{t("7日")}</SelectItem>
                        <SelectItem value="30d">{t("30日")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("プラットフォーム")}</Label>
                    <Select value={aiPlatform} onValueChange={v => setAiPlatform(v as typeof aiPlatform)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="threads">Threads</SelectItem>
                        <SelectItem value="instagram">Instagram</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("地域")}</Label>
                    <Select value={aiRegion} onValueChange={v => setAiRegion(v as typeof aiRegion)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="JP">{t("日本")}</SelectItem>
                        <SelectItem value="US">{t("米国")}</SelectItem>
                        <SelectItem value="OTHER">{t("その他")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("目的")}</Label>
                    <Select value={aiPurpose} onValueChange={v => setAiPurpose(v as typeof aiPurpose)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="awareness">{t("認知拡大")}</SelectItem>
                        <SelectItem value="follow">{t("フォロー獲得")}</SelectItem>
                        <SelectItem value="inquiry">{t("問い合わせ獲得")}</SelectItem>
                        <SelectItem value="recruit">{t("採用")}</SelectItem>
                        <SelectItem value="sales">{t("販売")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("反映の強さ")}</Label>
                    <Select value={aiStrength} onValueChange={v => setAiStrength(v as typeof aiStrength)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weak">{t("弱め")}</SelectItem>
                        <SelectItem value="medium">{t("標準")}</SelectItem>
                        <SelectItem value="strong">{t("強め")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <Label className="text-xs">{t("使う分析")}</Label>
                    <p className="text-xs h-8 flex items-center">
                      {trendAnalysisQ.isLoading ? t("読み込み中...")
                        : trendAnalysisQ.data ? `${new Date(trendAnalysisQ.data.createdAt).toLocaleDateString()} · ${trendAnalysisQ.data.postCount}${t("件")}`
                        : <span className="text-destructive">{t("分析なし")}</span>}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-end gap-3">
              <div className="space-y-1.5 w-32">
                <Label>{t("言語")}</Label>
                <Select value={aiLang} onValueChange={v => setAiLang(v as "ja" | "en")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">{t("日本語")}</SelectItem>
                    <SelectItem value="en">{t("英語")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex-1">
                <Label>{t("トーン")}</Label>
                <Select value={aiTone} onValueChange={v => setAiTone(v as typeof aiTone)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TONES.map(tn => <SelectItem key={tn.value} value={tn.value}>{t(tn.label)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button onClick={handleAiGenerate} disabled={!aiTopic.trim() || aiGenerate.isPending}>
                {aiGenerate.isPending ? t("生成中...") : t("生成する")}
              </Button>
            </div>
            {aiVariants.length > 0 && (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {aiVariants.map((v, i) => {
                  const tr = trendOf(v);
                  return (
                    <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
                      {v.angle && <p className="text-[11px] font-medium text-[var(--brand-accent-deep)]">{t("角度")}: {v.angle}</p>}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{v.content}</p>
                      {v.referencedTrends.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">{t("参考にした傾向")}: {v.referencedTrends.join(" / ")}</p>
                      )}
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => { setAiOpen(false); openDialog({ editing: null, content: v.content, slotIndex: 0, categoryId: null, scheduledDate: "", imageUrl: null, trend: tr }); }}>
                          {t("編集して使う")}
                        </Button>
                        <Button size="sm" className="h-7 text-xs" disabled={createMut.isPending}
                          onClick={() => createMut.mutate({
                            content: v.content, slotIndex: 0, categoryId: null,
                            ...(tr ? { trendAnalysisId: tr.analysisId, trendMeta: { angle: tr.angle, referencedTrends: tr.referencedTrends } } : {}),
                          })}>
                          {t("そのまま追加")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("一括インポート")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">{t("1行1投稿でテキストを貼り付けてください。空行は無視されます。500文字超の行はスキップされます。")} {t("複数行の投稿は「---」だけの行で区切ってください。")}</p>
            <div className="space-y-1.5">
              <input ref={importFileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,.md,.markdown" className="hidden" onChange={handleImportFile} />
              <Button type="button" variant="outline" size="sm" onClick={() => importFileRef.current?.click()}>
                <FileUp className="h-4 w-4 mr-1.5" />{t("ファイルから読み込み")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("対応形式: Excel (.xlsx) / CSV / TSV / テキスト / Markdown (.md)。Markdownは```で囲まれたブロックを1投稿として読み込みます。Googleスプレッドシート・ドキュメントは「ファイル → ダウンロード」で保存してから読み込んでください（コピー&ペーストでもOK）。")}</p>
            </div>
            {/* field-sizing-fixed: 大量テキスト読込時にダイアログが画面外まで伸びるのを防ぐ */}
            <Textarea rows={12} placeholder={t("1行目の投稿内容\n2行目の投稿内容\n...")} value={importText} onChange={e => setImportText(e.target.value)} className="font-mono text-sm resize-none field-sizing-fixed h-[40vh] max-h-[40vh] overflow-y-auto" />
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>{t("カテゴリー（任意）")}</Label>
                <Select value={importCatId ? String(importCatId) : "none"} onValueChange={v => setImportCatId(v === "none" ? null : Number(v))}>
                  <SelectTrigger><SelectValue placeholder={t("なし")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("なし")}</SelectItem>
                    {cats.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-muted-foreground pt-5">{splitImportPosts(importText).length}{t("件検出")}</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>{t("キャンセル")}</Button>
            <Button onClick={handleImport} disabled={!importText.trim() || importMut.isPending}>{importMut.isPending ? t("インポート中...") : t("インポート実行")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
