"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../lib/api";
import styles from "./reviewer.module.css";
import type { ReviewerAssignment } from "./types";
import { authorNames, badgeClass, formatDate } from "./types";

export default function ReviewerDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.reviewer.dashboard()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat dashboard."))
      .finally(() => setLoading(false));
  }, []);

  const recent = (data?.recent_assignments || []) as ReviewerAssignment[];

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
        <div>
          <h1>Dashboard Reviewer</h1>
          <p>Monitoring proses review artikel PILAR PTIK 2026.</p>
        </div>
      </div>

      {loading && <div className={styles.notice}>Memuat data dashboard...</div>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.cards}>
        <div className={styles.card}><div className={styles.num}>{data?.articles_selected ?? "-"}</div><div className={styles.label}>Artikel Terpilih</div></div>
        <div className={styles.card}><div className={styles.num}>{data?.pending_reviews ?? "-"}</div><div className={styles.label}>Perlu Direview</div></div>
        <div className={styles.card}><div className={styles.num}>{data?.in_revision ?? "-"}</div><div className={styles.label}>Sedang Revisi</div></div>
        <div className={styles.card}><div className={styles.num}>{data?.completed ?? "-"}</div><div className={styles.label}>Selesai</div></div>
      </div>

      <div className={styles.panel}>
        <h3 className={styles.panelTitle}>Artikel Terbaru</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Mahasiswa</th><th>Judul Artikel</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {!recent.length && !loading ? (
                <tr><td colSpan={4} className={styles.empty}>Belum ada artikel yang ditugaskan kepada Anda.</td></tr>
              ) : recent.map((item) => (
                <tr key={item.id}>
                  <td>{authorNames(item)}</td>
                  <td>
                    <strong>{item.article?.title || "-"}</strong>
                    {item.version?.version_number ? <div className={styles.muted}>Versi {item.version.version_number}</div> : null}
                  </td>
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
