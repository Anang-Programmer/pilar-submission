"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import type { Article } from "../types";
import styles from "../peserta.module.css";

function needsRevision(article: Article): boolean {
  const requestStatus = String(article.latest_revision_request?.status || "").trim().toLowerCase();
  if (["open", "pending", "requested", "revision_required"].includes(requestStatus)) return true;

  const recommendation = String(article.latest_review?.recommendation || "").trim().toLowerCase();
  if (!["minor revision", "major revision"].includes(recommendation)) return false;

  const reviewedVersionId = article.latest_review?.article_version_id;
  if (reviewedVersionId != null && article.current_version?.id != null) {
    return Number(reviewedVersionId) === Number(article.current_version.id);
  }

  const reviewedAt = article.latest_review?.submitted_at || article.latest_review?.created_at;
  const uploadedAt = article.current_version?.uploaded_at;
  if (!reviewedAt || !uploadedAt) return true;
  return new Date(reviewedAt).getTime() >= new Date(uploadedAt).getTime();
}

function recommendationLabel(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "accept" || normalized === "accepted") return "Diterima";
  if (normalized === "minor revision") return "Perlu Perbaikan Ringan";
  if (normalized === "major revision") return "Perlu Banyak Perbaikan";
  if (normalized === "review ulang" || normalized === "review again") return "Perlu Dicek Lagi";
  if (normalized === "rejected" || normalized === "reject") return "Ditolak";
  return value || "Revisi";
}

export default function UploadRevisiPage() {
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>([]); const [selectedId, setSelectedId] = useState(""); const [file, setFile] = useState<File | null>(null); const [note, setNote] = useState(""); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => {
    api.peserta.articles().then((value) => {
      setArticles(value);
      const eligible = value.filter(needsRevision);
      const requestedId = new URLSearchParams(window.location.search).get("article_id");
      const requested = requestedId
        ? eligible.find((a: Article) => String(a.id) === requestedId)
        : null;
      const first = requested || eligible[0];
      setSelectedId(first ? String(first.id) : "");
    }).catch((err) => setError(err instanceof ApiError ? err.message : "Gagal memuat artikel revisi.")).finally(() => setLoading(false));
  }, []);
  const revisionArticles = articles.filter(needsRevision);
  const article = revisionArticles.find((a) => String(a.id) === selectedId) || null;
  const previous = article?.current_version;
  const hasRevision = Boolean(article && needsRevision(article));
  async function submit() { setError(""); setMessage(""); if (!article || !file || !note.trim()) { setError("Artikel, file revisi, dan ringkasan perbaikan wajib diisi."); return; } setSaving(true); try { const form = new FormData(); form.append("revision_note", note.trim()); form.append("file", file); await api.peserta.uploadRevision(article.id, form); setMessage("Artikel revisi berhasil dikirim."); setTimeout(() => router.push("/peserta/riwayat"), 600); } catch (err) { setError(err instanceof ApiError ? err.message : "Gagal mengunggah revisi."); } finally { setSaving(false); } }
  if (loading) return <div className={styles.panel}>Memuat data revisi...</div>;
  return <><div className={styles.title}><div><h1>Upload Revisi</h1><p>Kirim versi artikel setelah menindaklanjuti catatan reviewer.</p></div></div>{error && <div className={styles.error}>{error}</div>}{message && <div className={styles.notice}>{message}</div>}<div className={styles.panel}>{articles.length === 0 ? <div className={styles.empty}>Belum ada artikel.</div> : <>
    {revisionArticles.length > 1 && <div className={styles.field}><label>Pilih Artikel</label><select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>{revisionArticles.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select></div>}
    {!article ? <><div className={styles.empty}>Belum ada artikel yang memerlukan revisi.</div><div className={styles.actionRow}><button className={`${styles.btn} ${styles.primary}`} disabled>Belum Ada Revisi</button></div></> : <><div className={styles.field} style={{ marginTop: 18 }}><label>File Artikel Revisi</label><div className={styles.fileBox}><input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} /><div className={styles.fileName}>{file ? `${file.name} · ${Math.round(file.size / 1024)} KB` : "PDF/DOC/DOCX · Maks. 15 MB"}</div></div></div><div className={styles.field}><label>Ringkasan Perbaikan</label><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: memperbaiki pendahuluan, menambahkan tabel hasil pengujian, dan memperjelas metode penelitian." /></div><div className={styles.actionRow}><button className={`${styles.btn} ${styles.primary}`} onClick={submit} disabled={saving || !hasRevision}>{saving ? "Mengirim..." : hasRevision ? "Kirim Revisi" : "Belum Ada Revisi"}</button></div></>}</>}</div></>;
}
