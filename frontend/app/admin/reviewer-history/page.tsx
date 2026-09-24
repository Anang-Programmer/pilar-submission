"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

const PAGE_SIZE = 10;

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("id-ID");
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
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Tutup" : "Baca selengkapnya"}
        </button>
      ) : null}
    </td>
  );
}

export default function ReviewerHistoryPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [recommendation, setRecommendation] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const rows = await api.admin.reviewerHistory({
        recommendation: recommendation || undefined,
      });
      setHistory(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setError(err?.message || "Riwayat reviewer gagal dimuat");
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [recommendation]);

  const counts = useMemo(() => {
    const revision = history.filter((row) => String(row.recommendation || "").toLowerCase().includes("revision")).length;
    const accept = history.filter((row) => String(row.recommendation || "").toLowerCase().includes("accept")).length;
    return { total: history.length, revision, accept };
  }, [history]);

  const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));

  const paginatedHistory = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return history.slice(start, start + PAGE_SIZE);
  }, [history, page]);

  useEffect(() => {
    setPage(1);
  }, [recommendation]);

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

  const firstItem = history.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = history.length ? Math.min(page * PAGE_SIZE, history.length) : 0;

  return (
    <>
      <PageHeader
        title="Reviewers History"
        description="Riwayat seluruh hasil review reviewer, termasuk komentar untuk penulis dan versi artikel."
      />
      <ErrorBanner message={error} onClose={() => setError("")} />

      <section className={styles.panel}>
        <div className={styles.filter}>
          <select
            className={styles.select}
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value)}
            aria-label="Filter rekomendasi review"
          >
            <option value="">Semua Rekomendasi</option>
            <option value="Accept">Accept</option>
            <option value="Minor Revision">Minor Revision</option>
            <option value="Major Revision">Major Revision</option>
            <option value="Reject">Reject</option>
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#64748b", fontSize: 12 }}>
            <span>Total: <strong>{counts.total}</strong></span>
            <span>· Revisi: <strong>{counts.revision}</strong></span>
            <span>· Accept: <strong>{counts.accept}</strong></span>
          </div>
        </div>

        {loading ? <div className={styles.loadingBar}>Memuat history reviewer...</div> : null}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Authors</th>
                <th>Article Title</th>
                <th>Reviewer</th>
                <th>Review Date</th>
                <th>Komentar Reviewer</th>
                <th>Recommendation</th>
                <th>Version</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              {paginatedHistory.map((item) => (
                <tr key={item.id}>
                  <td>{item.Authors || "—"}</td>
                  <td>{item.article_title || "—"}</td>
                  <td>{item.Reviewer || "—"}</td>
                  <td>{formatDate(item.updated_at)}</td>
                  <CommentCell comment={item.comments_for_author} />
                  <td>{item.recommendation || "—"}</td>
                  <td>{item.version_number ?? "—"}</td>
                  <td>{item.Keterangan || "Processing Review"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!history.length && !loading ? <Empty text="Belum ada riwayat review yang sesuai." /> : null}

        {history.length > 0 ? (
          <div className={styles.pagination}>
            <div className={styles.paginationInfo}>
              Menampilkan {firstItem}–{lastItem} dari {history.length} review
            </div>
            <div className={styles.paginationControls}>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                aria-label="Halaman sebelumnya"
              >
                ‹
              </button>

              {pageNumbers.map((number) => (
                <button
                  key={number}
                  type="button"
                  className={`${styles.pageButton} ${number === page ? styles.pageButtonActive : ""}`}
                  onClick={() => setPage(number)}
                  aria-current={number === page ? "page" : undefined}
                >
                  {number}
                </button>
              ))}

              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
                aria-label="Halaman berikutnya"
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
