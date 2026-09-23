"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import type { ReviewResult } from "../types";
import { Icon } from "../../../components/Icon";
import styles from "../peserta.module.css";

function formatDate(value?: string | null): string {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
    : "-";
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

function reviewMessage(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "minor revision" || normalized === "major revision") return "Silakan upload revisi.";
  if (normalized === "accept" || normalized === "accepted") return "Artikel Anda diterima.";
  if (normalized === "review ulang" || normalized === "review again") return "Artikel perlu diperiksa kembali oleh reviewer.";
  if (normalized === "rejected" || normalized === "reject") return "Artikel ditolak.";
  return "";
}

function needsRevision(value?: string | null): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "minor revision" || normalized === "major revision";
}

export default function HasilReviewPage() {
  const router = useRouter();
  const [items, setItems] = useState<ReviewResult[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.peserta.reviewResults()
      .then((value) => {
        setItems(value);
        if (value[0]) setSelectedId(String(value[0].id));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Gagal memuat hasil review peserta."))
      .finally(() => setLoading(false));
  }, []);

  const article = items.find((x) => String(x.id) === selectedId) || null;
  const review = article?.reviews?.[0] || article?.latest_review;
  const reviewerName = review?.reviewer_name || "Reviewer";
  const recommendation = recommendationLabel(review?.recommendation);
  const message = reviewMessage(review?.recommendation);

  return <>
    <div className={styles.title}>
      <div>
        <h1>Hasil Review</h1>
        <p>Masukan reviewer untuk membantu penyempurnaan artikel Anda.</p>
      </div>
    </div>

    {error && <div className={styles.error}>{error}</div>}

    <div className={styles.panel}>
      {loading ? <div className={styles.empty}>Memuat hasil review...</div> : items.length === 0 ? <div className={styles.empty}>Belum ada artikel atau hasil review yang masuk.</div> : <>
        {items.length > 1 && (
          <div className={styles.field}>
            <label>Pilih Artikel</label>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
        )}

        <div className={styles.articleHead}>
          <h2>{article?.title}</h2>
          <div className={styles.metaRow}>
            <span className={styles.metaItem}>
              Versi <strong>{article?.current_version_number ? `v${article.current_version_number}` : "-"}</strong>
            </span>
            <span className={styles.metaItem}>
              Reviewer <strong>{reviewerName}</strong>
            </span>
            <span className={styles.metaItem}>
              Dikirim <strong>{formatDate(article?.submitted_at)}</strong>
            </span>
          </div>
        </div>

        {review ? <>
          <div className={styles.notice}>
            <b>Rekomendasi: {recommendation}</b>
            {message && <> · {message}</>}
          </div>

          <h3 className={styles.sectionHead}>Komentar untuk Penulis</h3>
          <div className={styles.reviewComment}>
            {review.comments_for_author || "Belum ada komentar untuk penulis."}
          </div>

          {needsRevision(review.recommendation) && (
            <div className={styles.actionRow}>
              <button
                type="button"
                className={`${styles.btn} ${styles.primary}`}
                onClick={() => router.push("/peserta/upload-revisi")}
              >
                <Icon name="upload" size={15} />
                Upload Artikel Revisi
              </button>
            </div>
          )}
        </> : (
          <div className={styles.empty}>Belum ada hasil review untuk artikel ini.</div>
        )}
      </>}
    </div>
  </>;
}
