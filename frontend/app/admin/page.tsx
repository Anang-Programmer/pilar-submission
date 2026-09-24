"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { api } from "../../lib/api";
import styles from "./admin.module.css";
import { Icon } from "../../components/Icon";

type DashboardData = {
  total_projects: number;
  total_articles: number;
  total_peserta: number;
  total_journals: number;
  pending_assignments: number;
  revision_requests: number;
  articles_accepted: number;
  articles_finalized: number;
  articles_ready_for_journal: number;
  articles_submitted_to_journal: number;
  articles_under_journal_review: number;
  articles_published: number;
  flow: Record<string, number>;
  status_distribution: Array<{ key: string; label: string; count: number }>;
  journal_distribution: Array<{
    journal_id: number;
    name: string;
    sinta_level?: string | null;
    count: number;
  }>;
  journal_submission_distribution: Array<{ key: string; label: string; count: number }>;
  activity: Array<{
    date: string;
    articles_in: number;
    reviews_done: number;
    revisions_in: number;
    accepted: number;
  }>;
  reviewer_performance: Array<{
    reviewer_id: number;
    name: string;
    assigned: number;
    reviewed: number;
    revision: number;
    accepted: number;
    pending: number;
  }>;
  progress: Array<{ key: string; label: string; value: number }>;
};

type ActivityKey = "articles_in" | "reviews_done" | "revisions_in" | "accepted";

const STATUS_META: Record<string, { label: string; color: string }> = {
  accepted: { label: "Accepted", color: "#35b97b" },
  major_revision: { label: "Major Revision", color: "#ff7130" },
  minor_revision: { label: "Minor Revision", color: "#f8bd32" },
  in_review: { label: "Sedang Review", color: "#3988e8" },
  submitted: { label: "Submitted", color: "#9b79eb" },
};

const ACTIVITY_META: Record<ActivityKey, { label: string; color: string }> = {
  articles_in: { label: "Artikel Masuk", color: "#2d82e8" },
  reviews_done: { label: "Review Selesai", color: "#38b77c" },
  revisions_in: { label: "Revisi Masuk", color: "#f57b35" },
  accepted: { label: "Accepted", color: "#9b79eb" },
};

function Metric({ icon, value, label }: { icon: ComponentProps<typeof Icon>["name"]; value: number; label: string }) {
  return (
    <div className={styles.dashboardMetric}>
      <div className={styles.dashboardMetricIcon}><Icon name={icon} size={19} /></div>
      <div>
        <div className={styles.dashboardMetricValue}>{value}</div>
        <div className={styles.dashboardMetricLabel}>{label}</div>
      </div>
    </div>
  );
}

function FlowStep({ icon, value, label, tone }: { icon: ComponentProps<typeof Icon>["name"]; value: number; label: string; tone: string }) {
  return (
    <div className={styles.dashboardFlowItem}>
      <div className={`${styles.dashboardFlowCircle} ${styles[`dashboardTone_${tone}`]}`}><Icon name={icon} size={21} /></div>
      <div className={styles.dashboardFlowValue}>{value}</div>
      <div className={styles.dashboardFlowLabel}>{label}</div>
    </div>
  );
}

function Donut({ data }: { data: DashboardData["status_distribution"] }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const stops = data.map((item) => {
    const meta = STATUS_META[item.key] || { label: item.label, color: "#94a3b8" };
    const start = total ? (cursor / total) * 100 : 0;
    cursor += item.count;
    const end = total ? (cursor / total) * 100 : 0;
    return `${meta.color} ${start}% ${end}%`;
  });

  return (
    <div className={styles.dashboardDonutWrap}>
      <div
        className={styles.dashboardDonut}
        style={{ background: `conic-gradient(${stops.join(",") || "#dbe5f0 0 100%"})` }}
      >
        <div className={styles.dashboardDonutHole}>
          <strong>{total}</strong>
          <span>Artikel</span>
        </div>
      </div>
    </div>
  );
}

function ActivityChart({ data }: { data: DashboardData["activity"] }) {
  const width = 700;
  const height = 220;
  const padX = 8;
  const padY = 12;
  const max = Math.max(
    1,
    ...data.flatMap((item) => [item.articles_in, item.reviews_done, item.revisions_in, item.accepted]),
  );

  const pointsFor = (key: ActivityKey) =>
    data
      .map((item, index) => {
        const x = padX + (index * (width - padX * 2)) / Math.max(data.length - 1, 1);
        const y = height - padY - ((item[key] / max) * (height - padY * 2));
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <div className={styles.dashboardChartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.dashboardChart} preserveAspectRatio="none" role="img" aria-label="Aktivitas PILAR berdasarkan seluruh rentang data">
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={0}
            x2={width}
            y1={height * ratio}
            y2={height * ratio}
            stroke="#e7edf4"
            strokeWidth="1"
          />
        ))}
        {(Object.keys(ACTIVITY_META) as ActivityKey[]).map((key) => (
          <polyline
            key={key}
            points={pointsFor(key)}
            fill="none"
            stroke={ACTIVITY_META[key].color}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div className={styles.dashboardChartLegend}>
        {(Object.keys(ACTIVITY_META) as ActivityKey[]).map((key) => (
          <span key={key}>
            <i style={{ background: ACTIVITY_META[key].color }} />
            {ACTIVITY_META[key].label}
          </span>
        ))}
      </div>
      <div className={styles.dashboardChartDates}>
        <span>{data[0]?.date ? formatShortDate(data[0].date) : ""}</span>
        <span>{data[Math.floor(data.length / 2)]?.date ? formatShortDate(data[Math.floor(data.length / 2)].date) : ""}</span>
        <span>{data[data.length - 1]?.date ? formatShortDate(data[data.length - 1].date) : ""}</span>
      </div>
    </div>
  );
}

function formatShortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("id-ID").format(value);
}

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    api.admin.dashboard()
      .then((value: DashboardData) => {
        if (active) setDashboard(value);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Gagal memuat dashboard.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const statusTotal = useMemo(
    () => dashboard?.status_distribution?.reduce((sum, item) => sum + item.count, 0) || 0,
    [dashboard],
  );

  async function exportReport() {
    try {
      const blob = await api.admin.exportReport();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "pilar-admin-summary.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengekspor laporan.");
    }
  }

  const data = dashboard || {
    total_projects: 0,
    total_articles: 0,
    total_peserta: 0,
    total_journals: 0,
    pending_assignments: 0,
    revision_requests: 0,
    articles_accepted: 0,
    articles_finalized: 0,
    articles_ready_for_journal: 0,
    articles_submitted_to_journal: 0,
    articles_under_journal_review: 0,
    articles_published: 0,
    flow: { projects: 0, articles: 0, assigned: 0, reviewed: 0, revision: 0, accepted: 0, ready_journal: 0 },
    status_distribution: [],
    journal_distribution: [],
    journal_submission_distribution: [],
    activity: [],
    reviewer_performance: [],
    progress: [],
  };

  return (
    <div className={styles.dashboardPage}>
      <div className={styles.dashboardHeader}>
        <div>
          <h1>Dashboard Monitoring PILAR PTIK 2026</h1>
          <p>Program Inkubasi Luaran Akademik Berbasis Riset</p>
        </div>
      </div>

      {loading && <div className={styles.dashboardInfo}>Memperbarui data dashboard...</div>}
      {error && <div className={styles.dashboardError}>{error}</div>}

      <section className={styles.dashboardKpis}>
        <Metric icon="project" value={38} label="Usulan Proyek PjBL" />
        <Metric icon="articles" value={data.total_articles} label="Artikel Masuk" />
        <Metric icon="participants" value={data.total_peserta} label="Peserta (Tim)" />
        <Metric icon="checkCircle" value={data.articles_accepted} label="Artikel Diterima" />
        <Metric icon="journal" value={data.total_journals} label="Jurnal Target" />
      </section>

      <section className={styles.dashboardSectionCard}>
        <div className={styles.dashboardSectionTitle}>Alur Proses PILAR</div>
        <div className={styles.dashboardFlow}>
          <FlowStep icon="project" value={38} label="Usulan Proyek PjBL" tone="blue" />
          <span className={styles.dashboardArrow}>→</span>
          <FlowStep icon="articles" value={data.flow.articles} label="Artikel Masuk" tone="purple" />
          <span className={styles.dashboardArrow}>→</span>
          <FlowStep icon="assignment" value={data.flow.assigned} label="Di-assign Reviewer" tone="orange" />
          <span className={styles.dashboardArrow}>→</span>
          <FlowStep icon="review" value={data.flow.reviewed} label="Sudah Direview" tone="yellow" />
          <span className={styles.dashboardArrow}>→</span>
          <FlowStep icon="revision" value={data.flow.revision} label="Revisi (Perbaikan)" tone="blue" />
          <span className={styles.dashboardArrow}>→</span>
          <FlowStep icon="checkCircle" value={data.flow.accepted} label="Accepted" tone="green" />
          <span className={styles.dashboardArrow}>→</span>
          <FlowStep icon="upload" value={data.flow.ready_journal} label="Siap Submit ke Jurnal" tone="purple" />
        </div>
      </section>

      <section className={styles.dashboardTwoCol}>
        <div className={styles.dashboardSectionCard}>
          <div className={styles.dashboardSectionTitle}>Distribusi Status Artikel</div>
          <div className={styles.dashboardStatusGrid}>
            <Donut data={data.status_distribution} />
            <div className={styles.dashboardLegendList}>
              {data.status_distribution.map((item) => {
                const meta = STATUS_META[item.key] || { label: item.label, color: "#94a3b8" };
                const percentage = statusTotal ? Math.round((item.count / statusTotal) * 100) : 0;
                return (
                  <div className={styles.dashboardLegendRow} key={item.key}>
                    <span className={styles.dashboardLegendLabel}>
                      <i style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                    <strong>{formatNumber(item.count)} ({percentage}%)</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className={styles.dashboardSectionCard}>
          <div className={styles.dashboardSectionTitle}>Distribusi Artikel per Jurnal</div>
          <div className={styles.dashboardBars}>
            {data.journal_distribution.length ? data.journal_distribution.map((item, index) => {
              const max = Math.max(...data.journal_distribution.map((journal) => journal.count), 1);
              return (
                <div className={styles.dashboardBarRow} key={item.journal_id}>
                  <span title={item.name}>
                    {item.name}{item.sinta_level ? ` (${item.sinta_level.toUpperCase()})` : ""}
                  </span>
                  <div className={styles.dashboardBarTrack}>
                    <i style={{ width: `${(item.count / max) * 100}%` }} />
                  </div>
                  <strong>{item.count}</strong>
                </div>
              );
            }) : <div className={styles.dashboardEmpty}>Belum ada artikel dengan jurnal target.</div>}
          </div>
        </div>
      </section>

      <section className={styles.dashboardTwoCol}>
        <div className={styles.dashboardSectionCard}>
          <div className={styles.dashboardSectionTitle}>
            Aktivitas PILAR
            <span>
              {data.activity.length > 0
                ? `${formatShortDate(data.activity[0].date)} - ${formatShortDate(
                  data.activity[data.activity.length - 1].date,
                )}`
                : "Belum ada aktivitas"}
            </span>
          </div>
          <ActivityChart data={data.activity} />
        </div>

        <div className={styles.dashboardSectionCard}>
          <div className={styles.dashboardSectionTitle}>
            <div>Perlu Tindakan</div>

          </div>

          <div className={styles.dashboardActionList}>
            <div className={`${styles.dashboardActionItem} ${styles.dashboardActionAmber}`}>
              <span className={styles.dashboardActionText}>
                <Icon name="clock" size={16} /> {data.pending_assignments} artikel menunggu review
              </span>

            </div>

            <div className={`${styles.dashboardActionItem} ${styles.dashboardActionOrange}`}>
              <span className={styles.dashboardActionText}>
                <Icon name="revision" size={16} /> {data.revision_requests} artikel menunggu revisi peserta
              </span>

            </div>

            <div className={`${styles.dashboardActionItem} ${styles.dashboardActionBlue}`}>
              <span className={styles.dashboardActionText}>
                <Icon name="assignment" size={16} /> {Math.max(data.total_articles - data.flow.assigned, 0)} artikel belum di-assign reviewer
              </span>

            </div>

            <div className={`${styles.dashboardActionItem} ${styles.dashboardActionGreen}`}>
              <span className={styles.dashboardActionText}>
                <Icon name="upload" size={16} /> {data.articles_ready_for_journal} artikel siap disubmit ke jurnal
              </span>

            </div>
          </div>
        </div>
      </section>

      <section className={styles.dashboardTwoCol}>
        <div className={styles.dashboardSectionCard}>
          <div className={styles.dashboardSectionTitle}>Kinerja Reviewer</div>
          <div className={styles.dashboardTableWrap}>
            <table className={styles.dashboardTable}>
              <thead>
                <tr>
                  <th>Reviewer</th>
                  <th>Assigned</th>
                  <th>Reviewed</th>
                  <th>Revisi</th>
                  <th>Accepted</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {data.reviewer_performance.map((reviewer) => (
                  <tr key={reviewer.reviewer_id}>
                    <td>{reviewer.name}</td>
                    <td>{reviewer.assigned}</td>
                    <td>{reviewer.reviewed}</td>
                    <td>{reviewer.revision}</td>
                    <td>{reviewer.accepted}</td>
                    <td>{reviewer.pending}</td>
                  </tr>
                ))}
                {!data.reviewer_performance.length && (
                  <tr><td colSpan={6} className={styles.dashboardEmptyCell}>Belum ada data reviewer.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className={styles.dashboardSectionCard}>
          <div className={styles.dashboardSectionTitle}>Progress Tahapan PILAR</div>
          <div className={styles.dashboardProgressList}>
            {data.progress.map((item) => {
              const isProject = item.key === "projects";
              const value = isProject ? 38 : item.value;
              const percentage = isProject
                ? 100
                : Math.min(100, Math.round((value / Math.max(data.total_articles, 1)) * 100));

              return (
                <div className={styles.dashboardProgressItem} key={item.key}>
                  <div className={styles.dashboardProgressHead}>
                    <span>{item.label}</span>
                    <strong>{value}</strong>
                  </div>
                  <div className={styles.dashboardProgressTrack}>
                    <i style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.dashboardSectionCard}>
        <div className={styles.dashboardSectionTitle}>Luaran Akademik</div>
        <div className={styles.dashboardOutputGrid}>
          <div><strong>{data.total_articles}</strong><span>Artikel Masuk</span></div>
          <div><strong>{data.articles_accepted}</strong><span>Accepted</span></div>
          <div><strong>{data.articles_ready_for_journal}</strong><span>Siap Submit</span></div>
          <div><strong>{data.articles_submitted_to_journal}</strong><span>Submitted ke Jurnal</span></div>
          <div><strong>{data.articles_under_journal_review}</strong><span>Under Review</span></div>
          <div><strong>{data.articles_published}</strong><span>Published (DOI)</span></div>
        </div>
      </section>
    </div>
  );
}
