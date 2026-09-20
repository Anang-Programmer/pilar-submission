"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "../../../../lib/api";
import type { Article } from "../../../peserta/types";
import styles from "../../peserta.module.css";


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
function isOpenRevisionRequest(article: any): boolean {
  const revision = String(article?.latest_revision_request?.status || "").trim().toLowerCase();
  return ["open", "pending", "requested", "revision_required"].includes(revision);
}

function reviewAppliesToCurrentVersion(article: any): boolean {
  const review = article?.latest_review;
  const version = article?.current_version;
  if (!review || !version) return false;
  if (review.article_version_id != null) {
    return Number(review.article_version_id) === Number(version.id);
  }
  const reviewedAt = review.submitted_at || review.created_at;
  const uploadedAt = version.uploaded_at;
  if (!reviewedAt || !uploadedAt) return false;
  return new Date(reviewedAt).getTime() >= new Date(uploadedAt).getTime();
}

function statusLabel(article: any): string {
  const recommendation = String(article?.latest_review?.recommendation || "").trim().toLowerCase();
  const raw = String(article?.status || "").trim().toLowerCase();
  const reviewIsCurrent = reviewAppliesToCurrentVersion(article);

  if (article?.finalized_at || ["selesai", "finalized", "final"].includes(raw)) return "Selesai";
  if (isOpenRevisionRequest(article)) return "Revisi Diperlukan";

  // Hanya gunakan rekomendasi untuk status artikel jika review tersebut
  // memang ditujukan ke versi aktif. Ini mencegah V2 sudah diterima tetapi
  // status artikel masih terbaca "Sedang Direview" dari status lama.
  if (reviewIsCurrent) {
    if (["accept", "accepted"].includes(recommendation)) return "Diterima";
    if (["minor revision", "major revision"].includes(recommendation)) return "Revisi Diperlukan";
    if (["rejected", "reject"].includes(recommendation)) return "Ditolak";
    if (["review ulang", "review again"].includes(recommendation)) return "Perlu Dicek Lagi";
  }

  if (raw.includes("review")) return "Sedang Direview";
  if (article?.current_version) return "Artikel Dikirim";
  return "Belum Dikirim";
}
function recommendationLabel(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "accept" || normalized === "accepted") return "Diterima";
  if (normalized === "minor revision") return "Perlu Perbaikan Ringan";
  if (normalized === "major revision") return "Perlu Banyak Perbaikan";
  if (normalized === "review ulang" || normalized === "review again") return "Perlu Dicek Lagi";
  if (normalized === "rejected" || normalized === "reject") return "Ditolak";
  return value || "-";
}

function badgeClass(label: string): string {
  const value = label.toLowerCase();
  if (value.includes("selesai") || value.includes("diterima") || value.includes("accept") || value.includes("submitted")) return styles.done;
  if (value.includes("revisi") || value.includes("revision")) return styles.revision;
  if (value.includes("review")) return styles.review;
  return styles.pending;
}

export default function ArticleDetail() {
  const params = useParams<{ id: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { if (!params?.id) return; api.peserta.article(params.id).then(setArticle).catch((err) => setError(err instanceof ApiError ? err.message : "Gagal memuat detail artikel.")).finally(() => setLoading(false)); }, [params]);
  if (loading) return <div className={styles.panel}>Memuat detail artikel...</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (!article) return null;
  const mentor = article.pendamping?.lecturer;
  const s = statusLabel(article);
  const canSubmitRevision = isOpenRevisionRequest(article) || (reviewAppliesToCurrentVersion(article) && ["minor revision", "major revision"].includes(String(article?.latest_review?.recommendation || "").trim().toLowerCase()));
  return <>
    <div className={styles.title}><div><h1>Detail Artikel</h1><p>Informasi artikel yang terhubung dengan akun peserta.</p></div><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Link href="/peserta/artikel" className={`${styles.btn} ${styles.secondary}`}>Kembali</Link>{canSubmitRevision ? <Link href={`/peserta/upload-revisi?article_id=${article.id}`} className={`${styles.btn} ${styles.primary}`}>Submit Revisi</Link> : null}</div></div>
    <div className={styles.panel}><div className={styles.articleHead}><h2>{article.title}</h2><div className={styles.meta}>Status: <span className={`${styles.badge} ${badgeClass(s)}`}>{s}</span><br/>Jurnal Tujuan: {article.journal?.name || "Belum dipilih"}{article.journal?.sinta_level ? ` — ${article.journal.sinta_level}` : ""}<br/>Dosen Pendamping: {mentor ? `${mentor.full_name}${mentor.academic_title ? `, ${mentor.academic_title}` : ""}` : "Belum ditetapkan"}<br/>Dikirim: {formatDate(article.submitted_at)}</div></div>
      <h3>Penulis</h3><div className={styles.meta}>{article.authors.length ? article.authors.map((author) => <div key={author.id}>{author.author_order}. {author.student?.full_name || `Student #${author.student_id}`}{author.is_corresponding ? " · Corresponding Author" : ""}</div>) : "Data penulis belum tersedia."}</div>
      <h3 style={{ marginTop: 22 }}>Abstrak</h3><div className={styles.meta} style={{ whiteSpace: "pre-wrap" }}>{article.abstract || "Belum ada abstrak."}</div>
      <h3 style={{ marginTop: 22 }}>Versi Aktif</h3><div className={styles.infoGrid}><div className={styles.infoItem}><span>Versi</span><strong>{article.current_version ? `v${article.current_version.version_number}` : "-"}</strong></div><div className={styles.infoItem}><span>File</span><strong>{article.current_version?.file_name || "Belum ada file"}</strong></div></div>
      {article.latest_review && reviewAppliesToCurrentVersion(article) && <div className={styles.notice} style={{ marginTop: 20 }}><b>Rekomendasi: {recommendationLabel(article.latest_review.recommendation)}</b><br/>{article.latest_review.comments_for_author || "Belum ada komentar untuk penulis."}</div>}
    </div>
  </>;
}
