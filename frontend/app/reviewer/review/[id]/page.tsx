"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import styles from "../../reviewer.module.css";
import type { ReviewerAssignment } from "../../types";
import { authorNames, badgeClass, formatDate, formatDateTime } from "../../types";

const recommendations = [
  "Accept",
  "Minor Revision",
  "Major Revision",
  "Review Ulang",
  "Rejected",
] as const;

export default function ReviewDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<ReviewerAssignment | null>(null);
  const [recommendation, setRecommendation] = useState("");
  const [authorComment, setAuthorComment] = useState("");
  const [coordinatorComment, setCoordinatorComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!params?.id) return;
    api.reviewer.assignment(params.id)
      .then((data) => {
        setItem(data);
        const latest = data?.latest_review;
        if (latest) {
          setRecommendation(latest.recommendation || "");
          setAuthorComment(latest.comments_for_author || "");
          setCoordinatorComment(latest.comments_for_coordinator || "");
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat detail review."))
      .finally(() => setLoading(false));
  }, [params?.id]);

  const alreadySubmitted = useMemo(
    () => Boolean(item?.latest_review?.status === "submitted" || item?.latest_review?.submitted_at),
    [item],
  );

  async function save(status: "draft" | "submitted") {
    if (!item) return;
    setError("");
    setMessage("");

    if (status === "submitted" && !recommendation) {
      setError("Pilih rekomendasi hasil review terlebih dahulu.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        recommendation: recommendation || null,
        comments_for_author: authorComment,
        comments_for_coordinator: coordinatorComment,
        status,
      };
      const response = await api.reviewer.saveReview(item.id, payload);
      setMessage(response?.message || (status === "draft" ? "Draft review berhasil disimpan." : "Review berhasil disubmit."));

      const refreshed = await api.reviewer.assignment(item.id);
      setItem(refreshed);

      if (status === "submitted") {
        router.push("/reviewer/riwayat");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan review.");
    } finally {
      setSaving(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save("submitted");
  }

  if (loading) return <div className={styles.notice}>Memuat artikel review...</div>;
  if (error && !item) return <div className={styles.error}>{error}</div>;
  if (!item) return null;

  const mentor = item.pendamping?.lecturer;

  return (
    <>
      <div className={styles.titleRow}>
        <div>
          <h1>Form Review</h1>
          <p>Format review artikel internal PILAR PTIK 2026.</p>
        </div>
        <div className={styles.actions}>
          <Link href="/reviewer/artikel" className={`${styles.btn} ${styles.secondary}`}>Kembali ke Artikel</Link>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {message && <div className={styles.notice}>{message}</div>}

      <div className={styles.panel}>
        <div className={styles.articleHead}>
          <h2>{item.article?.title || "Artikel"}</h2>
          <div className={styles.meta}>
            Penulis: <strong>{authorNames(item)}</strong><br />
            Dosen Pendamping: <strong>{mentor?.full_name || "Belum ada pendamping"}</strong><br />
            Jurnal: <strong>{item.journal?.name || "-"}</strong><br />
            {item.journal?.template_url ? (
              <>
                <a
                  className={styles.pdfLink}
                  href={item.journal.template_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  ↗ Lihat Template Jurnal
                </a>
                <br />
              </>
            ) : null}
            Versi naskah: <strong>v{item.version?.version_number ?? "-"}</strong><br />
            {item.version?.submission_note ? (
              <>
                <strong>Ringkasan Perbaikan:</strong>{" "}
                {item.version.submission_note}
                <br />
              </>
            ) : null}
            Deadline: <strong>{formatDate(item.deadline)}</strong><br />
            Status: <span className={`${styles.badge} ${styles[badgeClass(item.display_status) as keyof typeof styles]}`}>{item.display_status}</span>
            {item.version?.file_url ? (
              <><br /><a className={styles.pdfLink} href={item.version.file_url} target="_blank" rel="noreferrer">↗ Buka file artikel</a></>
            ) : null}
          </div>
        </div>

        {alreadySubmitted ? (
          <div className={styles.notice}>
            Review ini sudah disubmit pada {formatDateTime(item.latest_review?.submitted_at)}.
          </div>
        ) : (
          <form className={styles.form} onSubmit={onSubmit}>
            {/* <div className={styles.notice}>
              Komentar untuk penulis berisi masukan yang perlu ditindaklanjuti mahasiswa. Catatan koordinator bersifat internal.
            </div> */}

            <div className={styles.field}>
              <label htmlFor="authorComment">Komentar untuk Penulis</label>
              <textarea
                id="authorComment"
                className={styles.textarea}
                value={authorComment}
                onChange={(event) => setAuthorComment(event.target.value)}
                placeholder="Tuliskan komentar spesifik terhadap naskah..."
              />
            </div>

            {/* <div className={styles.field}>
              <label htmlFor="coordinatorComment">Catatan untuk Koordinator / Editor</label>
              <textarea
                id="coordinatorComment"
                className={styles.textarea}
                value={coordinatorComment}
                onChange={(event) => setCoordinatorComment(event.target.value)}
                placeholder="Catatan internal reviewer..."
              />
            </div> */}

            <div className={styles.field}>
              <label>Rekomendasi Hasil Review</label>
              <div className={styles.choice}>
                {recommendations.map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="recommendation"
                      value={value}
                      checked={recommendation === value}
                      onChange={() => setRecommendation(value)}
                    />
                    {value === "Accept"
                      ? "Diterima"
                      : value === "Minor Revision"
                        ? "Perlu Perbaikan Ringan"
                        : value === "Major Revision"
                          ? "Perlu Banyak Perbaikan"
                          : value === "Review Ulang"
                            ? "Perlu Dicek Lagi"
                            : "Ditolak"}
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.actions}>
              <button type="button" className={`${styles.btn} ${styles.secondary}`} disabled={saving} onClick={() => void save("draft")}>
                {saving ? "Menyimpan..." : "Simpan Draft"}
              </button>
              <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={saving}>
                {saving ? "Mengirim..." : "Submit Review"}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
