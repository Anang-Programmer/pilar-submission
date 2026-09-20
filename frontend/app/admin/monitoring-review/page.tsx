"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, Metric, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

export default function MonitoringReviewPage() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const [r, s] = await Promise.allSettled([
      api.admin.reviews(),
      api.admin.reportSummary(),
    ]);
    if (r.status === "fulfilled") setReviews(Array.isArray(r.value) ? r.value : []); else setError(r.reason?.message || "Review gagal dimuat");
    if (s.status === "fulfilled") setReport(s.value); else setError((old) => old || (s.reason?.message || "Ringkasan gagal dimuat"));
    setLoading(false);
  }

  useEffect(() => { load(); }, [status, recommendation]);

  // Tampilkan hanya hasil review terbaru untuk setiap assignment.
  // Endpoint mengurutkan created_at desc, jadi item pertama adalah review terbaru.
  const latestReviews = useMemo(() => {
    const seen = new Set<string>();
    return reviews.filter((item) => {
      const key = String(item.assignment_id ?? item.article?.id ?? item.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [reviews]);

  const major = useMemo(() => latestReviews.filter((x) => String(x.recommendation || "").toLowerCase().includes("major")).length, [latestReviews]);
  const minor = useMemo(() => latestReviews.filter((x) => String(x.recommendation || "").toLowerCase().includes("minor")).length, [latestReviews]);

  const visibleReviews = useMemo(() => {
    return latestReviews.filter((item) => {
      const currentStatus = String(item.status || "").toLowerCase();
      const currentRecommendation = String(item.recommendation || "").toLowerCase();
      return (
        (!status || currentStatus === status.toLowerCase()) &&
        (!recommendation || currentRecommendation === recommendation.toLowerCase())
      );
    });
  }, [latestReviews, status, recommendation]);

  return (
    <>
      <PageHeader title="Monitoring Review" description="Pantau proses, rekomendasi, dan artikel yang membutuhkan tindak lanjut." />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <div className={`${styles.cards} ${styles.four}`}>
        <Metric value={report?.pending_review_assignments ?? 0} label="Menunggu Review" />
        <Metric value={report?.articles_in_review ?? 0} label="Sedang Direview" />
        <Metric value={major} label="Major Revision" />
        <Metric value={minor} label="Minor Revision" />
      </div>
      <section className={styles.panel}>
        <div className={styles.filter}>
          <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua Status</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="completed">Completed</option></select>
          <select className={styles.select} value={recommendation} onChange={(e) => setRecommendation(e.target.value)}><option value="">Semua Rekomendasi</option><option value="Accept">Accept</option><option value="Minor Revision">Minor Revision</option><option value="Major Revision">Major Revision</option><option value="Reject">Reject</option></select>
        </div>
        {loading ? <div className={styles.loadingBar}>Memuat review...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Artikel</th><th>Reviewer</th><th>Assign</th><th>Deadline</th><th>Status</th><th>Rekomendasi</th><th>Score</th></tr></thead>
            <tbody>{visibleReviews.map((item) => <tr key={item.id}>
              <td>{item.article?.title || "—"}</td>
              <td>{item.reviewer?.username || item.reviewer?.email || "—"}</td>
              <td>{item.assignment?.assigned_at ? new Date(item.assignment.assigned_at).toLocaleDateString("id-ID") : "—"}</td>
              <td>{item.assignment?.deadline || "—"}</td>
              <td><Badge value={item.status} /></td>
              <td>{item.recommendation || "—"}</td>
              <td>{item.overall_score ?? "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {!visibleReviews.length && !loading ? <Empty text="Belum ada hasil review yang sesuai." /> : null}
      </section>
    </>
  );
}
