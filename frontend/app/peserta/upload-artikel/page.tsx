"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import type { ParticipantCourseAssignment, UploadContext } from "../types";
import styles from "../peserta.module.css";

function journalLabel(journal: any): string {
  return `${journal.name}${journal.abbreviation ? ` — ${journal.abbreviation}` : ""}${journal.sinta_level ? ` — ${journal.sinta_level}` : ""}`;
}

function mentorLabel(item?: ParticipantCourseAssignment | null): string {
  const mentor = item?.mentor;
  if (!mentor) return "Belum ditetapkan";
  return `${mentor.full_name}${mentor.academic_title ? `, ${mentor.academic_title}` : ""}`;
}

export default function UploadArtikelPage() {
  const router = useRouter();
  const [context, setContext] = useState<UploadContext | null>(null);
  const [assignmentId, setAssignmentId] = useState("");
  const [title, setTitle] = useState("");
  const [journalId, setJournalId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.peserta.uploadContext()
      .then((data) => setContext(data as UploadContext))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Gagal memuat data Upload Artikel."))
      .finally(() => setLoading(false));
  }, []);

  const assignments =
    context?.participant_assignments ??
    context?.assignments ??
    [];

  const selected =
    assignments.find((item) => String(item.id) === assignmentId) || null;

  const selectedJournal =
    (context?.journals || []).find((journal) => String(journal.id) === journalId) || null;

  async function submit() {
    setError("");
    setMessage("");
    if (!assignmentId || !title.trim() || !journalId || !file) {
      setError("Mata kuliah, judul artikel, jurnal tujuan, dan file artikel wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append("participant_assignment_id", assignmentId);
      form.append("title", title.trim());
      form.append("journal_id", journalId);
      form.append("submission_note", note.trim());
      form.append("file", file);
      await api.peserta.uploadInitialArticle(form);
      setMessage("Artikel berhasil dikirim.");
      setTimeout(() => router.push("/peserta/artikel"), 500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengunggah artikel.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.loading}>Memuat data Upload Artikel...</div>;

  return <>
    <div className={styles.title}>
      <div><h1>Upload Artikel</h1><p>Kirim naskah artikel untuk diproses dalam review internal PILAR.</p></div>
    </div>
    {error && <div className={styles.error}>{error}</div>}
    {message && <div className={styles.notice}>{message}</div>}

    <div className={styles.panel}>
      <div className={styles.articleHead}>
        <h2>Informasi Artikel</h2>
        <div className={styles.meta}>Data mata kuliah dan dosen pendamping berasal dari pendaftaran PILAR oleh Admin.</div>
      </div>

      <div className={styles.formGrid}>
        <div className={styles.field}><label>Nama Penulis</label><input value={context?.student.full_name || ""} readOnly /></div>
        <div className={styles.field}><label>NIM</label><input value={context?.student.nim || ""} readOnly /></div>
      </div>

      <div className={styles.field}>
        <label>Mata Kuliah</label>
        <select value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
          <option value="">Pilih mata kuliah</option>
          {assignments.map((item) => (
            <option key={item.id} value={item.id}>{item.course?.name || "Mata kuliah"}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label>Judul Artikel</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Masukkan judul artikel" />
      </div>

      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label>Jurnal Tujuan</label>
          <select value={journalId} onChange={(e) => setJournalId(e.target.value)}>
            <option value="">Pilih jurnal tujuan</option>
            {(context?.journals || []).map((journal) => <option key={journal.id} value={journal.id}>{journalLabel(journal)}</option>)}
          </select>

          <div className={styles.journalLinks}>
            <div className={styles.journalLinksTitle}>Akses Jurnal</div>
            <div className={styles.journalLinksGrid}>
              {selectedJournal?.website_url ? (
                <a
                  className={styles.journalLink}
                  href={selectedJournal.website_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>Website Jurnal</span>
                  <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <div className={styles.journalLinkDisabled}>Website jurnal belum tersedia</div>
              )}

              {selectedJournal?.template_url ? (
                <a
                  className={styles.journalLink}
                  href={selectedJournal.template_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>Template Jurnal</span>
                  <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <div className={styles.journalLinkDisabled}>Template jurnal belum tersedia</div>
              )}
            </div>
            {!selectedJournal && (
              <div className={styles.journalLinksHint}>Pilih jurnal terlebih dahulu untuk melihat website dan template jurnal.</div>
            )}
          </div>
        </div>
        <div className={styles.field}>
          <label>Dosen Pendamping</label>
          <input value={mentorLabel(selected)} readOnly />
        </div>
      </div>

      <div className={styles.field}>
        <label>File Artikel</label>
        <div className={styles.fileBox}>
          <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <div className={styles.fileName}>{file ? `${file.name} · ${Math.round(file.size / 1024)} KB` : "PDF/DOC/DOCX · Maks. 10 MB"}</div>
        </div>
      </div>

      <div className={styles.field}>
        <label>Catatan untuk Koordinator</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tuliskan informasi tambahan terkait artikel..." />
      </div>

      <div className={styles.actionRow}>
        <button className={`${styles.btn} ${styles.primary}`} onClick={submit} disabled={saving || !assignments.length}>
          {saving ? "Mengirim..." : "Kirim Artikel"}
        </button>
      </div>

      {!assignments.length && (
        <div className={styles.notice} style={{ marginTop: 14 }}>
          Belum ada mata kuliah yang didaftarkan oleh Admin. Silakan hubungi Admin untuk menambahkan Mata Kuliah dan Dosen Pendamping.
        </div>
      )}
    </div>
  </>;
}
