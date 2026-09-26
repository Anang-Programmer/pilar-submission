"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../../lib/api";
import { Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../../admin/admin.module.css";

const PAGE_SIZE = 10;

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("id-ID");
}

function CommentCell({ comment }: { comment?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = String(comment || "").trim();
  if (!text) return <td className={styles.commentCell}>—</td>;
  const words = text.split(/\s+/);
  const long = words.length > 15;
  const preview = words.slice(0, 15).join(" ");
  return <td className={styles.commentCell}><div className={styles.commentText}>{expanded || !long ? text : `${preview}...`}</div>{long ? <button type="button" className={styles.commentToggle} onClick={() => setExpanded((v) => !v)}>{expanded ? "Tutup" : "Baca selengkapnya"}</button> : null}</td>;
}

export default function DashboardUserReviewerHistoryPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [recommendation, setRecommendation] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.admin.reviewerHistory({ recommendation: recommendation || undefined })
      .then((data) => active && setHistory(Array.isArray(data) ? data : []))
      .catch((e) => active && setError(e instanceof ApiError ? e.message : "Riwayat reviewer gagal dimuat"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [recommendation]);

  useEffect(() => setPage(1), [recommendation]);
  const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  useEffect(() => setPage((current) => Math.min(current, totalPages)), [totalPages]);
  const pageRows = useMemo(() => history.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [history, page]);

  return (
    <>
      <PageHeader title="Reviewers History" description="Riwayat hasil review reviewer dan komentar untuk penulis." />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        <div className={styles.filter}>
          <select className={styles.select} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} aria-label="Filter rekomendasi review">
            <option value="">Semua Rekomendasi</option><option value="Accept">Accept</option><option value="Minor Revision">Minor Revision</option><option value="Major Revision">Major Revision</option><option value="Reject">Reject</option>
          </select>
          <span style={{ color: "#64748b", fontSize: 12 }}>Total: <strong>{history.length}</strong></span>
        </div>
        {loading ? <div className={styles.loadingBar}>Memuat history reviewer...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Authors</th><th>Article Title</th><th>Reviewer</th><th>Review Date</th><th>Komentar Reviewer</th><th>Recommendation</th><th>Version</th><th>Keterangan</th></tr></thead>
            <tbody>{pageRows.map((item) => <tr key={item.id}><td>{item.Authors || "—"}</td><td>{item.article_title || "—"}</td><td>{item.Reviewer || "—"}</td><td>{formatDate(item.updated_at)}</td><CommentCell comment={item.comments_for_author} /><td>{item.recommendation || "—"}</td><td>{item.version_number ?? "—"}</td><td>{item.Keterangan || "Processing Review"}</td></tr>)}</tbody>
          </table>
        </div>
        {!history.length && !loading ? <Empty text="Belum ada riwayat review yang sesuai." /> : null}
        {history.length > 0 ? <div className={styles.pagination}>
          <div className={styles.paginationInfo}>Menampilkan {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, history.length)} dari {history.length} review</div>
          <div className={styles.paginationControls}>
            <button type="button" className={styles.pageButton} onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={page === 1}>‹</button>
            <button type="button" className={`${styles.pageButton} ${styles.pageButtonActive}`}>{page}</button>
            <button type="button" className={styles.pageButton} onClick={() => setPage((v) => Math.min(totalPages, v + 1))} disabled={page === totalPages}>›</button>
          </div>
        </div> : null}
      </section>
    </>
  );
}
