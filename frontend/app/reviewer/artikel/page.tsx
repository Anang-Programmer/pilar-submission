"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import styles from "../reviewer.module.css";
import type { ReviewerAssignment } from "../types";
import { authorNames, badgeClass, formatDate } from "../types";

export default function ReviewerArticlesPage() {
  const [items, setItems] = useState<ReviewerAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.reviewer.assignments()
      .then((data) => setItems(data || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat artikel."))
      .finally(() => setLoading(false));
  }, []);

  const openArticle = async (assignmentId: number) => {
    const tab = window.open("about:blank", "_blank");
    try {
      const result = await api.reviewer.downloadArticle(assignmentId);
      if (!result?.url) throw new Error("URL artikel tidak tersedia.");
      if (tab) tab.location.href = result.url;
      else window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : "Gagal membuka artikel.");
    }
  };

  return (
    <>
      <div className={styles.titleRow}>
        <div><h1>Artikel Saya</h1><p>Daftar naskah yang ditugaskan kepada reviewer.</p></div>
      </div>

      {loading && <div className={styles.notice}>Memuat artikel...</div>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>No</th><th>Penulis</th><th>Judul</th><th>Pendamping</th><th>Versi</th><th>Deadline</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {!items.length && !loading ? (
                <tr><td colSpan={8} className={styles.empty}>Belum ada artikel yang ditugaskan kepada Anda.</td></tr>
              ) : items.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td>
                  <td>{authorNames(item)}</td>
                  <td>
                    <strong>{item.article?.title || "-"}</strong>
                    {item.journal?.name ? <div className={styles.muted}>{item.journal.name}</div> : null}
                  </td>
                  <td>{item.pendamping?.lecturer?.full_name || "Belum ada pendamping"}</td>
                  <td>v{item.version?.version_number ?? "-"}</td>
                  <td>{formatDate(item.deadline)}</td>
                  <td><span className={`${styles.badge} ${styles[badgeClass(item.display_status) as keyof typeof styles]}`}>{item.display_status}</span></td>
                  <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button type="button" className={`${styles.btn} ${styles.secondary} ${styles.small}`} onClick={() => openArticle(item.id)}>Lihat Artikel</button><Link className={`${styles.btn} ${styles.primary} ${styles.small}`} href={`/reviewer/review/${item.id}`}>Review</Link></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
