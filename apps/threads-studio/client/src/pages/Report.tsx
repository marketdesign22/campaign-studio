import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAccount } from "@/contexts/AccountContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { MonthlyReportDocument } from "@/components/MonthlyReportDocument";
import {
  emptyReportConfig,
  metricKeys,
  metricLabels,
  type ReportConfig,
  type ReportNarrative,
  type SavedReport,
} from "@shared/monthlyReport";
import { toast } from "sonner";

export default function Report() {
  const { current } = useAccount();
  return current ? (
    <ReportWorkspace key={current.id} accountId={current.id} />
  ) : (
    <p>アカウントを読み込んでいます。</p>
  );
}
function ReportWorkspace({ accountId }: { accountId: number }) {
  const [month, setMonth] = useState(
    new Date().toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
    })
  );
  return (
    <ReportMonth
      key={`${accountId}:${month}`}
      month={month}
      setMonth={setMonth}
    />
  );
}
function ReportMonth({
  month,
  setMonth,
}: {
  month: string;
  setMonth: (value: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftConfig, setDraftConfig] = useState<ReportConfig | null>(null);
  const [edit, setEdit] = useState<ReportNarrative | null>(null);
  const utils = trpc.useUtils();
  const configQuery = trpc.reports.config.useQuery({ month });
  const list = trpc.reports.list.useQuery({ month });
  const id = selectedId ?? list.data?.[0]?.id ?? null;
  const reportQuery = trpc.reports.get.useQuery(
    { id: id ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: !!id }
  );
  const report = reportQuery.data;
  const config = draftConfig ?? configQuery.data ?? emptyReportConfig();
  const saveConfig = trpc.reports.saveConfig.useMutation({
    onError: e => toast.error(e.message),
  });
  const generate = trpc.reports.generate.useMutation({
    onSuccess: async r => {
      setSelectedId(r.report.id);
      setEdit(null);
      await utils.reports.list.invalidate({ month });
      utils.reports.get.setData({ id: r.report.id }, r.report);
      toast.success(
        r.aiWarning ?? "レポートの下書きを作成しました。内容をご確認ください。"
      );
    },
    onError: e => toast.error(e.message),
  });
  const save = trpc.reports.saveNarrative.useMutation({
    onSuccess: r => {
      utils.reports.get.setData({ id: r.id }, r);
      setEdit(null);
      toast.success("文章を保存しました。");
    },
    onError: e => toast.error(e.message),
  });
  const status = trpc.reports.setStatus.useMutation({
    onSuccess: r => {
      utils.reports.get.setData({ id: r.id }, r);
      utils.reports.list.invalidate({ month });
      toast.success(
        r.status === "sent"
          ? "送付済みとして記録しました。メールは送信していません。"
          : "レビュー済みにしました。"
      );
    },
    onError: e => toast.error(e.message),
  });
  const copy = trpc.reports.copy.useMutation({
    onSuccess: r => {
      setSelectedId(r.id);
      utils.reports.get.setData({ id: r.id }, r);
      utils.reports.list.invalidate({ month });
    },
    onError: e => toast.error(e.message),
  });
  const busy =
    generate.isPending ||
    saveConfig.isPending ||
    save.isPending ||
    status.isPending ||
    copy.isPending;
  const changeConfig = (value: Partial<ReportConfig>) =>
    setDraftConfig({ ...config, ...value });
  const build = async () => {
    try {
      await saveConfig.mutateAsync({ month, config });
      setDraftConfig(null);
      await utils.reports.config.invalidate({ month });
      generate.mutate({ month });
    } catch {
      /* mutation shows error */
    }
  };
  return (
    <div className="print-report space-y-5">
      <div className="print:hidden">
        <PageHeader
          eyebrow="CLIENT REPORT"
          title="月次クライアントレポート"
          description="成果・分析・次月施策を作成し、レビュー後に提出用PDFとして保存します。"
        />
        <div className="flex flex-wrap gap-3 items-center mt-5">
          <label>
            対象月{" "}
            <input
              aria-label="対象月"
              className="border rounded p-2"
              type="month"
              value={month}
              disabled={busy || !!edit}
              onChange={e => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
          </label>
          <Button
            disabled={
              busy || configQuery.isLoading || !!configQuery.error || !!edit
            }
            onClick={build}
          >
            {generate.isPending
              ? "レポートを生成中…"
              : "取得済みデータから新しい版を生成"}
          </Button>
          <select
            className="border rounded p-2 max-w-full"
            aria-label="保存済みレポート"
            disabled={busy || !!edit}
            value={id ?? ""}
            onChange={e => setSelectedId(e.target.value)}
          >
            <option value="" disabled>
              保存済みレポートを選択
            </option>
            {list.data?.map(r => (
              <option key={r.id} value={r.id}>
                {new Date(r.generatedAt).toLocaleString("ja-JP")} ·{" "}
                {r.status === "draft"
                  ? "下書き"
                  : r.status === "reviewed"
                    ? "レビュー済"
                    : "送付済"}
              </option>
            ))}
          </select>
        </div>
        <details className="border rounded-lg p-4 mt-4" open={!report}>
          <summary className="cursor-pointer font-semibold">
            クライアント情報・目標・今月の施策
          </summary>
          <p className="text-xs text-muted-foreground my-3">
            目標は未設定でも生成できます。ここでの変更は次に生成する版へ反映されます。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="提出先・クライアント名"
              value={config.clientName}
              max={120}
              onChange={clientName => changeConfig({ clientName })}
            />
            <Field
              label="作成者・会社名"
              value={config.authorName}
              max={120}
              onChange={authorName => changeConfig({ authorName })}
            />
            <Field
              label="運用目的・最優先の成果"
              value={config.objective}
              max={600}
              onChange={objective => changeConfig({ objective })}
            />
            <Field
              label="今月の施策・特記事項"
              value={config.notes}
              max={3000}
              onChange={notes => changeConfig({ notes })}
            />
            {metricKeys.map(key => (
              <label className="text-sm" key={key}>
                {metricLabels[key]}の目標
                <input
                  aria-label={`${metricLabels[key]}の目標`}
                  type="number"
                  min="0"
                  max="1000000000000"
                  step={key === "engagementRate" ? "0.01" : "1"}
                  className="block border rounded p-2 w-full mt-1"
                  value={config.targets[key] ?? ""}
                  onChange={e =>
                    changeConfig({
                      targets: {
                        ...config.targets,
                        [key]:
                          e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label className="flex gap-2 text-sm mt-4">
            <input
              type="checkbox"
              checked={config.conversionComplete}
              onChange={e =>
                changeConfig({ conversionComplete: e.target.checked })
              }
            />
            対象月の成果登録が完了し、未登録分がないことを確認した
          </label>
          <label className="flex gap-2 text-sm mt-3">
            <input
              type="checkbox"
              checked={config.autoGenerate}
              onChange={e => changeConfig({ autoGenerate: e.target.checked })}
            />
            月初に前月の下書きを自動作成する（クライアントへの自動送信なし）
          </label>
          <Button
            className="mt-4"
            variant="outline"
            disabled={busy || configQuery.isLoading || !!configQuery.error}
            onClick={async () => {
              try {
                await saveConfig.mutateAsync({ month, config });
                setDraftConfig(null);
                await utils.reports.config.invalidate({ month });
                toast.success("設定を保存しました。");
              } catch {}
            }}
          >
            設定を保存
          </Button>
        </details>
        {(configQuery.error || list.error || reportQuery.error) && (
          <p role="alert" className="text-red-700 mt-4">
            {configQuery.error?.message ??
              list.error?.message ??
              reportQuery.error?.message}{" "}
            保存先の更新が完了しているか確認してください。
          </p>
        )}
        {report && (
          <div className="flex flex-wrap gap-2 mt-4 items-center">
            <span className="text-xs text-muted-foreground">
              数値は生成時点で固定
            </span>
            {report.status === "draft" ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy || !!edit}
                  onClick={() => setEdit(structuredClone(report.narrative))}
                >
                  文章を編集
                </Button>
                <Button
                  disabled={busy || !!edit}
                  onClick={() =>
                    status.mutate({
                      id: report.id,
                      revision: report.revision,
                      status: "reviewed",
                    })
                  }
                >
                  内容を確認してレビュー済みにする
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => copy.mutate({ id: report.id })}
              >
                内容を複製して修正
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy || !!edit}
              onClick={() => window.print()}
            >
              {report.status === "draft"
                ? "下書きをPDF保存"
                : "提出用PDFを保存"}
            </Button>
            {report.status === "reviewed" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  status.mutate({
                    id: report.id,
                    revision: report.revision,
                    status: "sent",
                  })
                }
              >
                送付済みとして記録
              </Button>
            )}
          </div>
        )}
        {edit && report && (
          <NarrativeEditor
            value={edit}
            onChange={setEdit}
            busy={busy}
            onCancel={() => setEdit(null)}
            onSave={() =>
              save.mutate({
                id: report.id,
                revision: report.revision,
                narrative: edit,
              })
            }
          />
        )}
        {!report && !list.isLoading && !list.error && (
          <p className="border rounded-lg p-8 mt-5 text-muted-foreground">
            対象月のレポートはまだありません。目的や施策を入力して「新しい版を生成」を押してください。
          </p>
        )}
      </div>
      {report && <MonthlyReportDocument report={report as SavedReport} />}
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  max = 1800,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
}) {
  return (
    <label className="text-sm block">
      {label}
      <textarea
        aria-label={label}
        className="border rounded p-2 w-full mt-1 min-h-20"
        maxLength={max}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}
function NarrativeEditor({
  value,
  onChange,
  onSave,
  onCancel,
  busy,
}: {
  value: ReportNarrative;
  onChange: (n: ReportNarrative) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="border rounded-lg p-5 mt-4 space-y-4">
      <h2 className="font-semibold">レポート文章の編集</h2>
      <Field
        label="総括"
        value={value.summary}
        onChange={summary => onChange({ ...value, summary })}
      />
      {value.insights.map((i, index) => (
        <div className="grid sm:grid-cols-2 gap-3" key={index}>
          <Field
            label={`所見${index + 1}の見出し`}
            value={i.title}
            max={120}
            onChange={title =>
              onChange({
                ...value,
                insights: value.insights.map((x, j) =>
                  j === index ? { ...x, title } : x
                ),
              })
            }
          />
          <Field
            label={`所見${index + 1}の内容`}
            value={i.body}
            max={1000}
            onChange={body =>
              onChange({
                ...value,
                insights: value.insights.map((x, j) =>
                  j === index ? { ...x, body } : x
                ),
              })
            }
          />
        </div>
      ))}
      {value.actions.map((a, index) => (
        <div className="grid sm:grid-cols-3 gap-3" key={index}>
          {(["title", "action", "measurement"] as const).map((key, j) => (
            <Field
              key={key}
              label={`施策${index + 1} ${["見出し", "内容・担当・期限", "検証方法"][j]}`}
              value={a[key]}
              max={key === "title" ? 120 : key === "action" ? 1000 : 400}
              onChange={text =>
                onChange({
                  ...value,
                  actions: value.actions.map((x, i) =>
                    i === index ? { ...x, [key]: text } : x
                  ),
                })
              }
            />
          ))}
        </div>
      ))}
      <Button disabled={busy} onClick={onSave}>
        文章を保存
      </Button>{" "}
      <Button variant="outline" disabled={busy} onClick={onCancel}>
        編集を取り消す
      </Button>
    </div>
  );
}
