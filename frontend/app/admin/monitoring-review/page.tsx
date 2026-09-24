"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, Metric, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

const PAGE_SIZE = 10;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function CommentCell({ comment }: { comment?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = String(comment || "").trim();

  if (!text) {
    return <td className={styles.commentCell}>—</td>;
  }

  const words = text.split(/\s+/);
  const isLong = words.length > 15;
  const preview = words.slice(0, 15).join(" ");

  return (
    <td className={styles.commentCell}>
      <div className={styles.commentText}>
        {expanded || !isLong ? text : `${preview}...`}
      </div>
      {isLong ? (
        <button
          type="button"
          className={styles.commentToggle}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Tutup" : "Baca selengkapnya"}
        </button>
      ) : null}
    </td>
  );
}

export default function MonitoringReviewPage() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");

    const [r, s] = await Promise.allSettled([
      api.admin.reviews(),
      api.admin.reportSummary(),
    ]);

    if (r.status === "fulfilled") {
      setReviews(Array.isArray(r.value) ? r.value : []);
    } else {
      setError(r.reason?.message || "Review gagal dimuat");
    }

    if (s.status === "fulfilled") {
      setReport(s.value);
    } else {
      setError((old) => old || (s.reason?.message || "Ringkasan gagal dimuat"));
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

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

  const major = useMemo(
    () => latestReviews.filter((x) => String(x.recommendation || "").toLowerCase().includes("major")).length,
    [latestReviews],
  );

  const minor = useMemo(
    () => latestReviews.filter((x) => String(x.recommendation || "").toLowerCase().includes("minor")).length,
    [latestReviews],
  );

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

  const totalPages = Math.max(1, Math.ceil(visibleReviews.length / PAGE_SIZE));

  const paginatedReviews = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return visibleReviews.slice(start, start + PAGE_SIZE);
  }, [visibleReviews, page]);

  useEffect(() => {
    setPage(1);
  }, [status, recommendation]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    let start = Math.max(1, page - Math.floor(maxButtons / 2));
    let end = Math.min(totalPages, start + maxButtons - 1);

    if (end - start + 1 < maxButtons) {
      start = Math.max(1, end - maxButtons + 1);
    }

    const numbers: number[] = [];
    for (let number = start; number <= end; number += 1) {
      numbers.push(number);
    }
    return numbers;
  }, [page, totalPages]);

  const firstItem = visibleReviews.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = visibleReviews.length
    ? Math.min(page * PAGE_SIZE, visibleReviews.length)
    : 0;

  return (
    <>
      <PageHeader
        title="Monitoring Review"
        description="Pantau proses, rekomendasi, dan artikel yang membutuhkan tindak lanjut."
      />
      <ErrorBanner message={error} onClose={() => setError("")} />

      <div className={`${styles.cards} ${styles.four}`}>
        <Metric value={report?.pending_review_assignments ?? 0} label="Menunggu Review" />
        <Metric value={report?.articles_in_review ?? 0} label="Sedang Direview" />
        <Metric value={major} label="Major Revision" />
        <Metric value={minor} label="Minor Revision" />
      </div>

      <section className={styles.panel}>
        <div className={styles.filter}>
          <select
            className={styles.select}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Semua Status</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="completed">Completed</option>
          </select>

          <select
            className={styles.select}
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value)}
          >
            <option value="">Semua Rekomendasi</option>
            <option value="Accept">Accept</option>
            <option value="Minor Revision">Minor Revision</option>
            <option value="Major Revision">Major Revision</option>
            <option value="Reject">Reject</option>
          </select>
        </div>

        {loading ? <div className={styles.loadingBar}>Memuat review...</div> : null}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Artikel</th>
                <th>Reviewer</th>
                <th>Assign</th>
                <th>Deadline</th>
                <th>Status</th>
                <th>Rekomendasi</th>
                <th>Komentar Reviewer</th>
              </tr>
            </thead>
            <tbody>
              {paginatedReviews.map((item) => (
                <tr key={item.id}>
                  <td>{item.article?.title || "—"}</td>
                  <td>{item.reviewer?.username || item.reviewer?.email || "—"}</td>
                  <td>{formatDate(item.assignment?.assigned_at)}</td>
                  <td>{formatDate(item.assignment?.deadline)}</td>
                  <td><Badge value={item.status} /></td>
                  <td>{item.recommendation || "—"}</td>
                  <CommentCell comment={item.comments_for_author} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!visibleReviews.length && !loading ? (
          <Empty text="Belum ada hasil review yang sesuai." />
        ) : null}

        {visibleReviews.length > 0 ? (
          <div className={styles.pagination}>
            <div className={styles.paginationInfo}>
              Menampilkan {firstItem}–{lastItem} dari {visibleReviews.length} review
            </div>

            <div className={styles.paginationControls}>
              <button
                type="button"
                className={styles.pageButton}
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                ‹
              </button>

              {pageNumbers.map((number) => (
                <button
                  key={number}
                  type="button"
                  className={
                    number === page
                      ? `${styles.pageButton} ${styles.pageButtonActive}`
                      : styles.pageButton
                  }
                  onClick={() => setPage(number)}
                >
                  {number}
                </button>
              ))}

              <button
                type="button"
                className={styles.pageButton}
                disabled={page === totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                ›
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
