import type { ReactNode } from "react";
import {
  formatReportValue as fmt,
  type Breakdown,
  type ReportPost,
  type SavedReport,
  type ReportData,
} from "@shared/monthlyReport";
import "./monthly-report.css";
const statuses = {
  draft: "下書き・要レビュー",
  reviewed: "レビュー済",
  sent: "送付済",
};
const eventNames: Record<string, string> = {
  inquiry: "問い合わせ",
  booking: "予約",
  lead: "見込み顧客",
  purchase: "購入",
  custom: "その他の登録成果",
};
function evidenceLabel(key: string, data: ReportData) {
  if (key === "coverage") return "データ取得状況";
  if (key === "business") return "事業成果";
  if (key === "ranking") return "投稿ランキング";
  if (key.startsWith("kpi:"))
    return data.kpis.find(k => "kpi:" + k.key === key)?.label ?? key;
  if (key.startsWith("category:"))
    return (
      "カテゴリ：" +
      (data.categories[Number(key.split(":")[1])]?.name ?? "未分類")
    );
  if (key.startsWith("post:")) return "投稿記録 #" + key.split(":")[1];
  return key;
}
function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mr-section">
      <div className="mr-section-heading">
        <span>{number}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
function BreakdownTable({ rows }: { rows: Breakdown[] }) {
  return rows.length ? (
    <table className="mr-table">
      <thead>
        <tr>
          <th>分類</th>
          <th>投稿数</th>
          <th>取得数</th>
          <th>ビュー合計</th>
          <th>中央値</th>
          <th>ER</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{r.posts}</td>
            <td>{r.measured}</td>
            <td>{fmt(r.views)}</td>
            <td>
              {r.medianViews === null
                ? "未取得"
                : r.medianViews.toLocaleString("ja-JP")}
            </td>
            <td>{fmt(r.rate, "engagementRate")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p className="mr-muted">分類できる投稿がありません。</p>
  );
}
function PostList({ posts }: { posts: ReportPost[] }) {
  return posts.length ? (
    <div className="mr-posts">
      {posts.map((p, i) => (
        <article key={p.id} className="mr-post">
          <div className="mr-post-meta">
            {String(i + 1).padStart(2, "0")} · {p.date} · {p.category}
          </div>
          <p>
            {p.content.length > 220 ? `${p.content.slice(0, 220)}…` : p.content}
          </p>
          <div className="mr-post-stats">
            <strong>{fmt(p.views)} views</strong>
            <span>ER {fmt(p.rate, "engagementRate")}</span>
            <span>
              いいね {fmt(p.likes)} / 返信 {fmt(p.replies)} / リポスト{" "}
              {fmt(p.reposts)}
            </span>
          </div>
          <small>根拠：投稿記録 #{p.id}</small>
        </article>
      ))}
    </div>
  ) : (
    <p className="mr-muted">
      条件を満たす投稿がありません。十分な比較対象が集まってから掲載します。
    </p>
  );
}
function Sparkline({ values }: { values: Array<number | null> }) {
  const finite = values.filter((v): v is number => v !== null);
  if (finite.length < 2)
    return <p className="mr-muted">推移を示すための記録が不足しています。</p>;
  const low = Math.min(...finite),
    high = Math.max(...finite);
  const range = high - low || 1;
  let previous: { x: number; y: number } | null = null;
  const lines: ReactNode[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      previous = null;
      return;
    }
    const point = {
      x: 8 + (i / (values.length - 1)) * 584,
      y: 110 - ((v - low) / range) * 90,
    };
    if (previous)
      lines.push(
        <line
          key={i}
          x1={previous.x}
          y1={previous.y}
          x2={point.x}
          y2={point.y}
          stroke="currentColor"
          strokeWidth="2.5"
        />
      );
    previous = point;
  });
  return (
    <div>
      <svg
        viewBox="0 0 600 130"
        role="img"
        aria-label={`記録の推移。最小${low}、最大${high}`}
        className="mr-chart"
      >
        <line x1="0" y1="115" x2="600" y2="115" stroke="#d8e0e7" />
        {lines}
      </svg>
      <div className="mr-between mr-muted">
        <span>最小 {low.toLocaleString("ja-JP")}</span>
        <span>最大 {high.toLocaleString("ja-JP")}</span>
      </div>
    </div>
  );
}
export function MonthlyReportDocument({ report }: { report: SavedReport }) {
  const d = report.data,
    n = report.narrative;
  const series = d.daily.map(
    day => d.followers.find(f => f.date === day.date)?.count ?? null
  );
  const observations = d.daily.map(day =>
    d.observations.find(o => o.date === day.date)
  );
  return (
    <div className="monthly-report-document">
      <div className="mr-page">
        <div className="mr-cover-label">THREADS / MONTHLY PERFORMANCE</div>
        <div className="mr-between">
          <p className="mr-eyebrow">{d.config.authorName || "運用レポート"}</p>
          <span className="mr-status">
            {statuses[report.status]}
            {d.provisional ? " · 速報" : ""}
          </span>
        </div>
        <h1>
          {d.config.clientName || d.accountName}
          <br />
          <span>月次運用レポート</span>
        </h1>
        <p className="mr-period">{d.month.replace("-", "年 ")}月</p>
        <div className="mr-cover-meta">
          対象アカウント：{d.accountName}
          <br />
          集計タイムゾーン：{d.timezone}
          <br />
          集計日時：
          {new Date(d.generatedAt).toLocaleString("ja-JP", {
            timeZone: d.timezone,
          })}
        </div>
        <Section number="01" title="運用の目的">
          <p>
            {d.config.objective ||
              "運用目的は未設定です。最優先の成果をクライアントと合意してから評価します。"}
          </p>
        </Section>
        <Section number="02" title="エグゼクティブサマリー">
          <p className="mr-summary">{n.summary}</p>
          <div className="mr-priority">
            <small>NEXT PRIORITY</small>
            <h3>{n.actions[0].title}</h3>
            <p>{n.actions[0].action}</p>
          </div>
        </Section>
        <div className="mr-cover-bottom">
          成果を確認し、次の施策につなげる。
          <span>
            {d.accountName} · {d.month}
          </span>
        </div>
      </div>

      <div className="mr-page">
        <Section number="03" title="KPIスコアカード">
          <p className="mr-muted">
            ビュー・ERは公開月別の投稿累計。経過日数が異なるため、前月比較は参考値です。
          </p>
          <table className="mr-table mr-score">
            <thead>
              <tr>
                <th>指標</th>
                <th>当月</th>
                <th>前月</th>
                <th>目標</th>
                <th>達成率</th>
                <th>増減</th>
              </tr>
            </thead>
            <tbody>
              {d.kpis.map(k => (
                <tr key={k.key}>
                  <td>{k.label}</td>
                  <td>
                    <strong>{fmt(k.current, k.key)}</strong>
                  </td>
                  <td>{fmt(k.previous, k.key)}</td>
                  <td>{k.target === null ? "未設定" : fmt(k.target, k.key)}</td>
                  <td
                    className={
                      k.achievement !== null && k.achievement >= 100
                        ? "mr-good"
                        : ""
                    }
                  >
                    {k.achievement === null
                      ? "—"
                      : `${k.achievement.toFixed(1)}%`}
                  </td>
                  <td>
                    {k.delta === null
                      ? "比較不可"
                      : k.key === "engagementRate"
                        ? `${k.delta >= 0 ? "+" : ""}${k.delta.toFixed(2)}pt`
                        : k.change === null
                          ? `差 ${k.delta >= 0 ? "+" : ""}${k.delta.toLocaleString("ja-JP")}`
                          : `${k.change >= 0 ? "+" : ""}${k.change.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mr-note">
            未取得・未設定はゼロと異なります。前月ゼロの場合は増減数のみ掲載。途中月・計測不完全な成果の増減評価は表示しません。
          </p>
        </Section>
        <Section number="04" title="推移とデータの範囲">
          <div className="mr-grid">
            <div>
              <h3>フォロワー総数</h3>
              <Sparkline values={series} />
              <p className="mr-note">
                日次の記録。欠けた日の数値は補完しません。
              </p>
            </div>
            <div>
              <h3>対象月投稿の累計ビュー観測値</h3>
              <Sparkline values={observations.map(o => o?.views ?? null)} />
              <p className="mr-note">
                各取得日の観測対象投稿の累計合計。日別閲覧数ではなく、観測件数も変わります。
              </p>
            </div>
          </div>
          <h3>投稿別反応の観測と運用量</h3>
          <table className="mr-table">
            <thead>
              <tr>
                <th>記録日</th>
                <th>観測投稿数</th>
                <th>累計ビュー</th>
                <th>ER</th>
              </tr>
            </thead>
            <tbody>
              {d.observations
                .filter(o => o.measured > 0)
                .slice(-7)
                .map(o => (
                  <tr key={o.date}>
                    <td>{o.date}</td>
                    <td>{o.measured}</td>
                    <td>{fmt(o.views)}</td>
                    <td>{fmt(o.rate, "engagementRate")}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mr-note">
            直近の観測記録を最大7日分掲載。公開投稿 {d.coverage.posts}件 /
            インサイト取得 {d.coverage.measured}件。
          </p>
        </Section>
      </div>

      <div className="mr-page">
        <Section number="05" title="投稿パフォーマンス">
          <p className="mr-note">
            50ビュー以上の取得済み投稿をER順で評価します。この基準は比較上の目安であり、統計的な有意差を保証しません。
          </p>
          <h3>反応率 上位投稿</h3>
          <PostList posts={d.top} />
          <h3>改善を検討する投稿</h3>
          <p className="mr-note">
            上位掲載と重複しない投稿を低ER順に掲載。投稿の目的や経過日数も踏まえて判断します。
          </p>
          <PostList posts={d.bottom} />
        </Section>
      </div>

      <div className="mr-page">
        <Section number="06" title="コンテンツ分析">
          <h3>カテゴリ別</h3>
          <BreakdownTable rows={d.categories} />
          <h3>キャンペーン別</h3>
          <BreakdownTable rows={d.campaigns} />
          <h3>投稿目的別</h3>
          <BreakdownTable rows={d.purposes} />
          <p className="mr-note">
            タグのない投稿は未分類。地域・言語は本文から推測しません。分類済みのタグが必要です。
          </p>
          <h3>曜日 × 投稿時間帯</h3>
          <div className="mr-heatmap">
            <table className="mr-table">
              <thead>
                <tr>
                  <th>時間</th>
                  {["日", "月", "火", "水", "木", "金", "土"].map(day => (
                    <th key={day}>{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(d.heatmap.map(h => h.hour)))
                  .sort((a, b) => a - b)
                  .map(hour => (
                    <tr key={hour}>
                      <td>{hour}:00</td>
                      {Array.from({ length: 7 }, (_, weekday) => {
                        const p = d.heatmap.find(
                          h => h.weekday === weekday && h.hour === hour
                        );
                        return (
                          <td
                            key={weekday}
                            style={
                              p
                                ? {
                                    background: `rgba(30,96,113,${Math.min(0.5, 0.08 + p.posts * 0.04)})`,
                                  }
                                : {}
                            }
                          >
                            {p ? (
                              <>
                                {p.posts}件<br />
                                <small>{fmt(p.rate, "engagementRate")}</small>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mr-note">
            件数とER。少数投稿・テーマの違いが影響するため、最適な投稿時間の断定には使いません。
          </p>
        </Section>
        <Section number="07" title="オーディエンス">
          <p>
            国・都市・年齢・性別のデータは、このレポートには接続されていません。投稿の言語や地域タグを、実際に閲覧した人の属性として扱いません。
          </p>
        </Section>
      </div>

      <div className="mr-page">
        <Section number="08" title="ビジネス成果">
          <div className="mr-funnel">
            <div>
              <small>登録済みリンククリック</small>
              <strong>{fmt(d.business.clicks)}</strong>
            </div>
            <div>
              <small>LPセッション</small>
              <strong>未連携</strong>
            </div>
            <div>
              <small>登録済み事業成果</small>
              <strong>{fmt(d.business.conversions)}</strong>
            </div>
          </div>
          <p className="mr-note">
            各段階を同じユーザーとして結びつける計測は未確認のため、CTR・CVRは算出していません。事業成果には重複する行動が含まれる可能性があります。
          </p>
          <p>
            {d.business.complete
              ? "担当者が対象月の成果登録完了を確認済みです。"
              : "対象月の成果登録は未確認です。登録分のみを表示しています。"}
          </p>
          <table className="mr-table">
            <thead>
              <tr>
                <th>成果種別</th>
                <th>登録件数</th>
              </tr>
            </thead>
            <tbody>
              {d.business.byType.map(r => (
                <tr key={r.name}>
                  <td>{eventNames[r.name] ?? r.name}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>キャンペーン別の登録成果</h3>
          <table className="mr-table">
            <thead>
              <tr>
                <th>キャンペーン</th>
                <th>件数</th>
              </tr>
            </thead>
            <tbody>
              {d.business.byCampaign.map(r => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section number="09" title="インサイトと翌月の施策">
          {n.insights.map((i, index) => (
            <article className="mr-insight" key={index}>
              <h3>{i.title}</h3>
              <p>{i.body}</p>
              <small>
                根拠：{i.evidence.map(key => evidenceLabel(key, d)).join(" / ")}
              </small>
            </article>
          ))}
          {n.actions.map((a, index) => (
            <article className="mr-action" key={index}>
              <span className="mr-action-number">0{index + 1}</span>
              <div>
                <h3>{a.title}</h3>
                <p>{a.action}</p>
                <p className="mr-note">検証：{a.measurement}</p>
              </div>
            </article>
          ))}
          {d.config.notes && (
            <>
              <h3>今月の施策・特記事項</h3>
              <p className="mr-whitespace">{d.config.notes}</p>
            </>
          )}
        </Section>
      </div>

      <div className="mr-page">
        <Section number="10" title="指標の定義・集計上の留意点">
          <ul className="mr-definitions">
            {d.warnings.map(w => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p>
            対象月は上記タイムゾーンの月初から翌月初まで。公開に成功した投稿だけを集計し、下書き・予約・失敗試行は含めません。
          </p>
          <p>
            フォロワー純増は前月末と当月末の記録差です。速報は当日記録との差を使います。必要な日付の記録がなければ未取得と表示します。
          </p>
          <p>
            目標達成率＝実績÷目標×100。前月比＝（当月−前月）÷前月×100。ERの増減はポイント差を用います。
          </p>
          <p>
            地域・言語の分析には分類済みのタグ、オーディエンスには取得可能な属性データが必要です。取得履歴のない過去の値を推測して埋めることはありません。
          </p>
          <p>
            文章は担当者のレビューを経て提出します。掲載した仮説は次月の検証対象であり、効果の因果関係を保証するものではありません。
          </p>
          <div className="mr-audit">
            <p>レポートID：{report.id}</p>
            <p>
              対象：{d.accountName} / {d.month}
            </p>
            <p>
              インサイト取得範囲：{d.coverage.earliestFetch ?? "未取得"} 〜{" "}
              {d.coverage.latestFetch ?? "未取得"}
            </p>
            <p>
              状態：{statuses[report.status]} / 改訂：{report.revision}
            </p>
            <p>レビュー日時：{report.reviewedAt ?? "未レビュー"}</p>
          </div>
        </Section>
      </div>
    </div>
  );
}
