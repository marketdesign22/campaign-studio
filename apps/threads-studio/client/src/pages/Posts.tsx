import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { CheckCheck, FileUp, Pencil, Plus, Repeat, RotateCcw, Send, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
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

const SLOT_LABELS = ["朝", "夕", "追加1", "追加2", "追加3", "追加4"];
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
  const { data: accounts = [] } = trpc.accounts.list.useQuery();
  const { data: settings } = trpc.settings.get.useQuery();
  const utils = trpc.useUtils();
  const invalidate = () => { utils.posts.list.invalidate(); utils.posts.nextPreview.invalidate(); };

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
  const bulkDeleteMut = trpc.posts.bulkDelete.useMutation({
    onSuccess: d => { toast.success(`${d.count}${t("件削除しました")}`); setSelected(new Set()); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const importMut = trpc.posts.bulkImport.useMutation({ onSuccess: d => { toast.success(`${d.count}${t("件インポートしました")}`); invalidate(); setImportOpen(false); setImportText(""); }, onError: e => toast.error(e.message) });
  const approvalMut = trpc.posts.setApproval.useMutation({ onSuccess: () => invalidate(), onError: e => toast.error(e.message) });
  const aiGenerate = trpc.ai.generateDrafts.useMutation({ onError: e => toast.error(e.message) });
  const aiRewrite = trpc.ai.rewrite.useMutation({
    onSuccess: d => { setContent(d.content); toast.success(t("リライトしました")); },
    onError: e => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<typeof postList[0] | null>(null);
  const [content, setContent] = useState("");
  const [slotIndex, setSlotIndex] = useState(0);
  const [catId, setCatId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
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
  const [aiDrafts, setAiDrafts] = useState<string[]>([]);

  function openCreate() { setEditing(null); setContent(""); setSlotIndex(0); setCatId(null); setAccountId(null); setRewriteInstruction(""); setOpen(true); }
  function openEdit(p: typeof postList[0]) { setEditing(p); setContent(p.content); setSlotIndex(p.slotIndex); setCatId(p.categoryId); setAccountId(p.accountId ?? null); setRewriteInstruction(""); setOpen(true); }
  function handleSave() {
    if (editing) updateMut.mutate({ id: editing.id, content, slotIndex, categoryId: catId, accountId });
    else createMut.mutate({ content, slotIndex, categoryId: catId, accountId });
  }
  async function handleSaveAndPostNow() {
    try {
      const created = await createMut.mutateAsync({ content, slotIndex, categoryId: catId, accountId });
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
    setAiDrafts([]);
    aiGenerate.mutate({ topic: aiTopic.trim(), tone: aiTone, count: 3, language: aiLang }, {
      onSuccess: d => setAiDrafts(d.drafts),
    });
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
                {selected.size > 0 && (
                  <Button size="sm" variant="destructive" className="h-7 text-xs ml-auto"
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
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">{SLOT_LABELS[p.slotIndex] ? t(SLOT_LABELS[p.slotIndex]) : `${t("スロット")}${p.slotIndex}`}</span>
                        {p.scheduledDate && <span className="text-xs text-muted-foreground tabular-nums">{p.scheduledDate}</span>}
                        {cat && <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: cat.color }}>{cat.name}</span>}
                        {account && accounts.length > 1 && (
                          <span className="text-xs text-muted-foreground">@{account.name}</span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed line-clamp-3">{p.content}</p>
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
                          <Button size="icon" variant="ghost" className="h-8 w-8" title={t("下書きに戻す")}
                            onClick={() => approvalMut.mutate({ id: p.id, approvalStatus: "draft" })}>
                            <Undo2 className="h-3.5 w-3.5" />
                          </Button>
                        )
                      )}
                      {p.status === "pending" && !isDraft && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-primary" title={t("今すぐ投稿")}
                          disabled={postNowMut.isPending}
                          onClick={() => { if (confirm(t("今すぐThreadsに投稿しますか？"))) postNowMut.mutate({ postId: p.id }); }}>
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {p.status !== "pending" && <Button size="icon" variant="ghost" className="h-8 w-8" title={t("未投稿に戻す")} onClick={() => updateMut.mutate({ id: p.id, status: "pending" })}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="ghost"
                        className={`h-8 w-8 ${p.evergreen ? "text-sky-600" : ""}`}
                        title={p.evergreen ? t("再投稿コンテンツから外す") : t("再投稿コンテンツにする")}
                        onClick={() => evergreenMut.mutate({ id: p.id, evergreen: !p.evergreen })}>
                        <Repeat className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm(t("削除しますか？"))) deleteMut.mutate({ id: p.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit/Create Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? t("原稿を編集") : t("新規原稿を追加")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("投稿内容")} <span className={`text-xs ${content.length > 480 ? "text-destructive" : "text-muted-foreground"}`}>({content.length}/500)</span></Label>
              <Textarea rows={6} value={content} onChange={e => setContent(e.target.value)} maxLength={500} className="resize-none" />
              {/* AI rewrite */}
              <div className="flex gap-2 pt-1">
                <input
                  className="flex-1 text-xs border rounded-md px-2.5 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={t("AIへの指示（例: もっと短く / 絵文字を入れて）")}
                  value={rewriteInstruction}
                  onChange={e => setRewriteInstruction(e.target.value)}
                  maxLength={300}
                />
                <Button size="sm" variant="outline" className="h-8 text-xs shrink-0"
                  disabled={!content.trim() || !rewriteInstruction.trim() || aiRewrite.isPending}
                  onClick={() => aiRewrite.mutate({ content, instruction: rewriteInstruction })}>
                  <Sparkles className={`h-3 w-3 mr-1 text-[var(--brand-accent-deep)] ${aiRewrite.isPending ? "animate-pulse" : ""}`} />
                  {aiRewrite.isPending ? t("生成中...") : t("AIリライト")}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("投稿スロット")}</Label>
                <Select value={String(slotIndex)} onValueChange={v => setSlotIndex(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SLOT_LABELS.map((l, i) => <SelectItem key={i} value={String(i)}>{t(l)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("カテゴリー")}</Label>
                <Select value={catId ? String(catId) : "none"} onValueChange={v => setCatId(v === "none" ? null : Number(v))}>
                  <SelectTrigger><SelectValue placeholder={t("なし")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("なし")}</SelectItem>
                    {cats.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {accounts.length > 1 && (
              <div className="space-y-1.5">
                <Label>{t("投稿先アカウント")}</Label>
                <Select value={accountId ? String(accountId) : "default"} onValueChange={v => setAccountId(v === "default" ? null : Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{t("デフォルト")} ({accounts[0]?.name})</SelectItem>
                    {accounts.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("キャンセル")}</Button>
            {!editing && (
              <Button variant="outline" onClick={handleSaveAndPostNow}
                disabled={!content.trim() || createMut.isPending || postNowMut.isPending}>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {postNowMut.isPending ? t("投稿中...") : t("追加して今すぐ投稿")}
              </Button>
            )}
            <Button onClick={handleSave} disabled={!content.trim() || createMut.isPending || updateMut.isPending}>{editing ? t("更新") : t("追加")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Assist Dialog */}
      <Dialog open={aiOpen} onOpenChange={v => { setAiOpen(v); if (!v) { setAiDrafts([]); } }}>
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
            {aiDrafts.length > 0 && (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {aiDrafts.map((d, i) => (
                  <div key={i} className="rounded-lg border bg-card p-3 space-y-2">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{d}</p>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => { setAiOpen(false); setEditing(null); setContent(d); setSlotIndex(0); setCatId(null); setAccountId(null); setRewriteInstruction(""); setOpen(true); }}>
                        {t("編集して使う")}
                      </Button>
                      <Button size="sm" className="h-7 text-xs" disabled={createMut.isPending}
                        onClick={() => createMut.mutate({ content: d, slotIndex: 0, categoryId: null })}>
                        {t("そのまま追加")}
                      </Button>
                    </div>
                  </div>
                ))}
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
