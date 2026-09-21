"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../../lib/api";
import type { Article } from "../types";
import styles from "../peserta.module.css";


function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}
function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function statusLabel(article: any): string {
  const revision = String(article?.latest_revision_request?.status || "").toLowerCase();
  const recommendation = String(article?.latest_review?.recommendation || "").toLowerCase();
  const raw = String(article?.status || "").toLowerCase();

  if (
    article?.finalized_at ||
    ["finalized", "final", "selesai"].includes(raw)
  ) {
    return "Selesai";
  }

  const currentVersionId =
    article?.current_version?.id ?? article?.current_version_id ?? null;
  const reviewedVersionId = article?.latest_review?.article_version_id ?? null;
  const acceptedCurrentVersion =
    ["accept", "accepted", "diterima"].includes(recommendation) &&
    currentVersionId != null &&
    reviewedVersionId != null &&
    String(currentVersionId) === String(reviewedVersionId);

  if (acceptedCurrentVersion || raw === "selesai review") {
    return "Menunggu Finalisasi";
  }

  if (
    ["open", "pending", "requested", "revision_required"].includes(revision) ||
    recommendation === "major revision" ||
    recommendation === "minor revision"
  ) {
    return "Revisi Diperlukan";
  }

  if (raw.includes("review")) {
    return "Sedang Direview";
  }

  if (article?.current_version) {
    return "Artikel Dikirim";
  }

  return "Belum Dikirim";
}
function badgeClass(label: string): string {
  const value = label.toLowerCase();
  if (value.includes("selesai") || value.includes("accept") || value.includes("submitted")) return styles.done;
  if (value.includes("revisi") || value.includes("revision")) return styles.revision;
  if (value.includes("review")) return styles.review;
  return styles.pending;
}

export default function PesertaArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { api.peserta.articles().then(setArticles).catch((err) => setError(err instanceof ApiError ? err.message : "Gagal memuat artikel peserta.")).finally(() => setLoading(false)); }, []);

  const openArticle = async (article: Article) => {
    const versionId = article.current_version?.id;
    if (!versionId) {
      setError("Artikel belum memiliki file versi aktif.");
      return;
    }
    const tab = window.open("about:blank", "_blank");
    try {
      const result = await api.peserta.downloadVersion(article.id, versionId);
      if (!result?.url) throw new Error("URL artikel tidak tersedia.");
      if (tab) tab.location.href = result.url;
      else window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : "Gagal membuka artikel.");
    }
  };

  return <>
    <div className={styles.title}><div><h1>Artikel Saya</h1><p>Daftar proyek dan artikel yang sedang Anda kembangkan.</p></div><Link href="/peserta/upload-artikel" className={`${styles.btn} ${styles.primary}`}>Upload Artikel</Link></div>
    {error && <div className={styles.error}>{error}</div>}
    <div className={styles.panel}><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>No</th><th>Judul Artikel</th><th>Jurnal Tujuan</th><th>Pendamping</th><th>Versi</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={7} className={styles.empty}>Memuat artikel...</td></tr> : articles.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Belum ada artikel. Pastikan project sudah ditetapkan oleh admin.</td></tr> : articles.map((article, index) => {
        const mentor = article.pendamping?.lecturer;
        const s = statusLabel(article);
        return <tr key={article.id}><td>{index + 1}</td><td><b>{article.title}</b></td><td>{article.journal?.abbreviation || article.journal?.name || "-"}{article.journal?.sinta_level ? ` — ${article.journal.sinta_level}` : ""}</td><td>{mentor ? `${mentor.full_name}${mentor.academic_title ? `, ${mentor.academic_title}` : ""}` : "Belum ditetapkan"}</td><td>{article.current_version_number ? `v${article.current_version_number}` : "-"}</td><td><span className={`${styles.badge} ${badgeClass(s)}`}>{s}</span></td><td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button type="button" onClick={() => openArticle(article)} className={`${styles.btn} ${styles.secondary} ${styles.small}`}>Lihat Artikel</button><Link href={`/peserta/artikel/${article.id}`} className={`${styles.btn} ${styles.primary} ${styles.small}`}>Detail</Link></div></td></tr>;
      })}
    </tbody></table></div></div>
  </>;
}
