"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import styles from "../reviewer.module.css";
import type { ReviewerAssignment } from "../types";
import { authorNames, badgeClass, formatDate } from "../types";

export default function ChooseReviewPage() {
  const [items, setItems] = useState<ReviewerAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.reviewer.assignments()
      .then((data) => setItems(data || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat assignment."))
      .finally(() => setLoading(false));
  }, []);

  const actionable = items.filter((item) => item.display_status !== "Selesai");

  return (
    <>
      <div className={styles.titleRow}>
        <div><h1>Form Review</h1><p>Pilih artikel yang akan direview.</p></div>
      </div>

      {loading && <div className={styles.notice}>Memuat assignment review...</div>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.panel}>
        <h3 className={styles.panelTitle}>Assignment yang Dapat Ditindaklanjuti</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Artikel</th><th>Penulis</th><th>Deadline</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {!actionable.length && !loading ? (
                <tr><td colSpan={5} className={styles.empty}>Tidak ada assignment yang perlu ditindaklanjuti.</td></tr>
              ) : actionable.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.article?.title || "-"}</strong><div className={styles.muted}>v{item.version?.version_number ?? "-"}</div></td>
                  <td>{authorNames(item)}</td>
                  <td>{formatDate(item.deadline)}</td>
                  <td><span className={`${styles.badge} ${styles[badgeClass(item.display_status) as keyof typeof styles]}`}>{item.display_status}</span></td>
                  <td><Link className={`${styles.btn} ${styles.primary} ${styles.small}`} href={`/reviewer/review/${item.id}`}>Mulai Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
