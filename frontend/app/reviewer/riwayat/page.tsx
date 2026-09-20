"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import styles from "../reviewer.module.css";
import type { ReviewerReview } from "../types";
import { formatDateTime } from "../types";

export default function ReviewerHistoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.reviewer.history()
      .then((data) => setItems(data || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat riwayat review."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className={styles.titleRow}>
        <div><h1>Riwayat Review</h1><p>Jejak hasil review yang telah disubmit.</p></div>
      </div>

      {loading && <div className={styles.notice}>Memuat riwayat...</div>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Artikel</th><th>Tanggal</th><th>Rekomendasi</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {!items.length && !loading ? (
                <tr><td colSpan={5} className={styles.empty}>Belum ada review yang disubmit.</td></tr>
              ) : items.map((item) => {
                const review = item as ReviewerReview & { article?: { title?: string } | null };
                return (
                  <tr key={review.id}>
                    <td><strong>{review.article?.title || "-"}</strong></td>
                    <td>{formatDateTime(review.submitted_at)}</td>
                    <td>{review.recommendation || "-"}</td>
                    <td><span className={`${styles.badge} ${styles.done}`}>Terkirim</span></td>
                    <td>
                      {review.assignment_id ? (
                        <Link className={`${styles.btn} ${styles.secondary} ${styles.small}`} href={`/reviewer/review/${review.assignment_id}`}>Detail</Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
