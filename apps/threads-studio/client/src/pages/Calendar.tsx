import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/i18n";
import { useAccount } from "@/contexts/AccountContext";
import { slotLabel } from "@/lib/slotLabel";
import { ChevronLeft, ChevronRight, Clock, GripVertical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const SLOT_PILL: Record<number, string> = {
  0: "bg-amber-100 text-amber-800 border-amber-200",
  1: "bg-indigo-100 text-indigo-800 border-indigo-200",
  2: "bg-emerald-100 text-emerald-800 border-emerald-200",
  3: "bg-rose-100 text-rose-800 border-rose-200",
  4: "bg-purple-100 text-purple-800 border-purple-200",
  5: "bg-cyan-100 text-cyan-800 border-cyan-200",
};
const STATUS_BG: Record<string, string> = {
  pending: "bg-blue-50 border-blue-200",
  posted: "bg-green-50 border-green-200",
  error: "bg-red-50 border-red-200",
};

type PostItem = {
  id: number;
  content: string;
  status: string;
  slotIndex: number;
  scheduledDate: string | null;
};

// ── Draggable post chip ──────────────────────────────────────────────────────
function DraggablePost({
  post,
  onEdit,
  isDragging,
}: {
  post: PostItem;
  onEdit: (p: PostItem) => void;
  isDragging?: boolean;
}) {
  const { t } = useI18n();
  const slots = useAccount().current?.slots ?? [];
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `post-${post.id}`,
    data: { post },
  });
  const style = transform
    ? { transform: CSS.Translate.toString(transform), zIndex: 50, opacity: 0.85 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`w-full text-left text-[10px] sm:text-xs px-1.5 py-0.5 rounded border flex items-center gap-1 select-none
        ${STATUS_BG[post.status] ?? ""} ${isDragging ? "shadow-lg ring-2 ring-[#335B82]/40" : "hover:shadow-sm"} transition-shadow cursor-grab active:cursor-grabbing`}
    >
      {/* Drag handle */}
      <span {...listeners} {...attributes} className="shrink-0 touch-none">
        <GripVertical className="h-2.5 w-2.5 text-muted-foreground" />
      </span>
      {/* Slot badge */}
      <span className={`shrink-0 text-[9px] font-semibold px-1 rounded border ${SLOT_PILL[post.slotIndex] ?? ""}`}>
        {slotLabel(slots, post.slotIndex, t("枠"))}
      </span>
      {/* Content preview — click to edit */}
      <button
        className="truncate flex-1 text-left"
        onClick={e => { e.stopPropagation(); onEdit(post); }}
      >
        {post.content.slice(0, 18)}{post.content.length > 18 ? "…" : ""}
      </button>
    </div>
  );
}

// ── Droppable calendar cell ──────────────────────────────────────────────────
function DroppableCell({
  dateStr,
  dayNum,
  isToday,
  dow,
  posts,
  onEdit,
  activeId,
}: {
  dateStr: string;
  dayNum: number;
  isToday: boolean;
  dow: number;
  posts: PostItem[];
  onEdit: (p: PostItem) => void;
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${dateStr}` });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[80px] sm:min-h-[100px] border-b border-r p-1 transition-colors
        ${isOver ? "bg-[#335B82]/8 ring-1 ring-inset ring-[#335B82]/30" : ""}
        ${dow === 0 ? "border-l" : ""}`}
    >
      <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full
        ${isToday ? "bg-[#335B82] text-white" : dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-foreground"}`}>
        {dayNum}
      </div>
      <div className="space-y-0.5">
        {posts.slice(0, 4).map(p => (
          <DraggablePost
            key={p.id}
            post={p}
            onEdit={onEdit}
            isDragging={activeId === `post-${p.id}`}
          />
        ))}
        {posts.length > 4 && (
          <div className="text-[10px] text-muted-foreground pl-1">+{posts.length - 4}</div>
        )}
      </div>
    </div>
  );
}

// ── Overlay chip (shown while dragging) ─────────────────────────────────────
function OverlayChip({ post }: { post: PostItem }) {
  const { t } = useI18n();
  const slots = useAccount().current?.slots ?? [];
  return (
    <div className={`text-xs px-2 py-1 rounded border shadow-xl flex items-center gap-1.5 max-w-[160px]
      ${STATUS_BG[post.status] ?? ""} ring-2 ring-[#335B82]/30`}>
      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className={`text-[9px] font-semibold px-1 rounded border ${SLOT_PILL[post.slotIndex] ?? ""}`}>
        {slotLabel(slots, post.slotIndex, t("枠"))}
      </span>
      <span className="truncate">{post.content.slice(0, 20)}…</span>
    </div>
  );
}

// ── Main Calendar page ───────────────────────────────────────────────────────
export default function Calendar() {
  const { t, lang } = useI18n();
  const slots = useAccount().current?.slots ?? [];
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selected, setSelected] = useState<PostItem | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editSlot, setEditSlot] = useState(0);
  const [activePost, setActivePost] = useState<PostItem | null>(null);

  const { data: byDate, refetch } = trpc.posts.calendarView.useQuery({ year, month });
  const rescheduleMut = trpc.posts.reschedule.useMutation({
    onSuccess: () => { toast.success(t("スケジュールを更新しました")); setSelected(null); refetch(); },
    onError: () => toast.error(t("更新に失敗しました")),
  });

  // dnd-kit sensors: 8px threshold prevents accidental drags on click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function handleDragStart(e: DragStartEvent) {
    const post = (e.active.data.current as { post: PostItem }).post;
    setActivePost(post);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActivePost(null);
    const { active, over } = e;
    if (!over) return;
    const post = (active.data.current as { post: PostItem }).post;
    const targetDate = String(over.id).replace("cell-", "");
    if (targetDate === post.scheduledDate) return; // no change
    rescheduleMut.mutate({ id: post.id, scheduledDate: targetDate, slotIndex: post.slotIndex });
    toast.info(`→ ${targetDate}`);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); }

  function openEdit(p: PostItem) { setSelected(p); setEditDate(p.scheduledDate ?? ""); setEditSlot(p.slotIndex); }

  const totalPosts = Object.values(byDate ?? {}).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Schedule"
        title={t("投稿カレンダー")}
        description={t("ドラッグで日付変更・クリックで詳細編集")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="font-display text-sm font-semibold min-w-[110px] text-center tabular-nums">{lang === "ja" ? `${year}年 ${month}月` : new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
            <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline" className="text-xs px-3 py-1">
          <Clock className="h-3 w-3 mr-1.5" />{t("この月")}: {totalPosts}{t("件")}
        </Badge>
        {slots.map((_, s) => (
          <Badge key={s} variant="outline" className={`text-xs px-2 py-1 ${SLOT_PILL[s] ?? ""}`}>
            {slotLabel(slots, s, t("枠"))}: {Object.values(byDate ?? {}).reduce((c, arr) => c + arr.filter(p => p.slotIndex === s).length, 0)}{t("件")}
          </Badge>
        ))}
      </div>

      {/* Calendar with DnD */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <Card>
          <CardContent className="p-0">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b">
              {(lang === "ja" ? ["日", "月", "火", "水", "木", "金", "土"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).map((d, i) => (
                <div key={d} className={`text-center text-xs font-medium py-2 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-muted-foreground"}`}>{d}</div>
              ))}
            </div>
            {/* Cells */}
            <div className="grid grid-cols-7">
              {Array.from({ length: totalCells }).map((_, idx) => {
                const dayNum = idx - firstDow + 1;
                const isValid = dayNum >= 1 && dayNum <= daysInMonth;
                const dateStr = isValid
                  ? `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`
                  : "";
                const posts = (isValid && byDate?.[dateStr]) ? (byDate[dateStr] as PostItem[]) : [];
                const isToday = dateStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
                const dow = idx % 7;

                if (!isValid) {
                  return (
                    <div key={idx} className={`min-h-[80px] sm:min-h-[100px] border-b border-r bg-muted/30 ${dow === 0 ? "border-l" : ""}`} />
                  );
                }

                return (
                  <DroppableCell
                    key={dateStr}
                    dateStr={dateStr}
                    dayNum={dayNum}
                    isToday={isToday}
                    dow={dow}
                    posts={posts}
                    onEdit={openEdit}
                    activeId={activePost ? `post-${activePost.id}` : null}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.23,1,0.32,1)" }}>
          {activePost && <OverlayChip post={activePost} />}
        </DragOverlay>
      </DndContext>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground items-center">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-50 border border-blue-200 inline-block" />{t("未投稿")}</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-50 border border-green-200 inline-block" />{t("投稿済み")}</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-50 border border-red-200 inline-block" />{t("エラー")}</span>
        <span className="ml-auto text-[11px]">
          <GripVertical className="h-3 w-3 inline mr-0.5" />{t("ドラッグで日付変更　クリックでスロット変更")}
        </span>
      </div>

      {/* Edit Dialog (slot & date fine-tuning) */}
      <Dialog open={!!selected} onOpenChange={v => !v && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("スケジュール詳細編集")}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted text-sm leading-relaxed max-h-32 overflow-y-auto">
                {selected.content}
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium block mb-1">{t("投稿日")}</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    className="w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#335B82]"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">{t("投稿スロット（時間帯）")}</label>
                  <Select value={String(editSlot)} onValueChange={v => setEditSlot(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {slots.map((_, i) => (
                        <SelectItem key={i} value={String(i)}>{slotLabel(slots, i, t("枠"))}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setSelected(null)}>{t("キャンセル")}</Button>
                <Button
                  onClick={() => rescheduleMut.mutate({ id: selected.id, scheduledDate: editDate, slotIndex: editSlot })}
                  disabled={!editDate || rescheduleMut.isPending}
                  className="bg-[#335B82] hover:bg-[#2a4a6b]"
                >
                  {rescheduleMut.isPending ? t("保存中…") : t("保存")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
