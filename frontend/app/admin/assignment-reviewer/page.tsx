"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, Field, Modal, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

function arr(value: any): any[] { return Array.isArray(value) ? value : value?.items || []; }

export default function AssignmentReviewerPage() {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [allAssignments, setAllAssignments] = useState<any[]>([]);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [modal, setModal] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ article_id: "", reviewer_user_id: "", deadline: "", admin_note: "" });

  async function load() {
    setLoading(true);
    setError("");
    const [a, allA, r, ar] = await Promise.allSettled([
      api.admin.reviewerAssignments(status || undefined),
      api.admin.reviewerAssignments(),
      api.admin.reviewers(),
      api.admin.articlesAdmin(),
    ]);
    const errors: string[] = [];
    if (a.status === "fulfilled") setAssignments(arr(a.value)); else errors.push(a.reason?.message || "Assignment gagal dimuat");
    if (allA.status === "fulfilled") setAllAssignments(arr(allA.value)); else errors.push(allA.reason?.message || "Data assignment gagal dimuat");
    if (r.status === "fulfilled") setReviewers(arr(r.value)); else errors.push(r.reason?.message || "Reviewer gagal dimuat");
    if (ar.status === "fulfilled") setArticles(arr(ar.value)); else errors.push(ar.reason?.message || "Artikel gagal dimuat");
    setError(errors[0] || "");
    setLoading(false);
  }

  useEffect(() => { load(); }, [status]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignments.filter((item) => {
      const article = item.article?.title || "";
      const reviewer = item.reviewer?.profile?.full_name || item.reviewer?.username || "";
      return !q || `${article} ${reviewer}`.toLowerCase().includes(q);
    });
  }, [assignments, search]);

  const articlesWithoutVersion = useMemo(() => articles.filter((a) => !a.current_version), [articles]);
  const assignedArticleIds = useMemo(() => new Set(allAssignments.map((item) => Number(item.article_id ?? item.article?.id)).filter((id) => Number.isFinite(id) && id > 0)), [allAssignments]);
  const availableArticles = useMemo(() => articles.filter((a) => a.current_version && !assignedArticleIds.has(Number(a.id))), [articles, assignedArticleIds]);

  function openModal() {
    setForm({ article_id: availableArticles[0]?.id ? String(availableArticles[0].id) : "", reviewer_user_id: "", deadline: "", admin_note: "" });
    setModal(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const article = articles.find((a) => String(a.id) === form.article_id);
      if (!article?.current_version) throw new Error("Artikel belum memiliki versi. Peserta harus mengunggah artikel terlebih dahulu.");
      await api.admin.createReviewerAssignment({
        article_id: Number(form.article_id),
        reviewer_user_id: Number(form.reviewer_user_id),
        article_version_id: Number(article.current_version.id),
        deadline: form.deadline || null,
        admin_note: form.admin_note || null,
      });
      setModal(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal melakukan assignment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Assignment Reviewer" description="Tugaskan artikel kepada Reviewer dan pantau deadline review." actions={<button className={`${styles.btn} ${styles.primary}`} onClick={openModal}>+ Assign Reviewer</button>} />
      <ErrorBanner message={error} onClose={() => setError("")} />
      {articlesWithoutVersion.length ? <div className={styles.alert}><strong>{articlesWithoutVersion.length} artikel</strong> belum memiliki versi file dan belum dapat ditugaskan untuk review.</div> : null}
      <section className={styles.panel}>
        <div className={styles.filter}>
          <input className={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari artikel/reviewer..." />
          <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua Status</option><option value="assigned">Assigned</option><option value="in_review">Sedang Direview</option><option value="completed">Selesai</option></select>
        </div>
        {loading ? <div className={styles.loadingBar}>Memuat assignment...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Artikel</th><th>Penulis</th><th>Jurnal</th><th>Versi</th><th>Reviewer</th><th>Deadline</th><th>Status</th></tr></thead>
            <tbody>{filtered.map((item) => <tr key={item.id}>
              <td>{item.article?.title || "—"}</td>
              <td>{(articles.find((a) => a.id === item.article?.id)?.authors || []).map((a: any) => a.student?.full_name).filter(Boolean).join(", ") || "—"}</td>
              <td>
                {
                  articles.find(
                    (a) => String(a.id) === String(item.article?.id)
                  )?.journal?.name
                  || item.article?.journal?.name
                  || "—"
                }
              </td>
              <td>{item.article_version ? `v${item.article_version.version_number}` : "—"}</td>
              <td>{item.reviewer?.profile?.full_name || item.reviewer?.username || "—"}</td>
              <td>{item.deadline || "—"}</td>
              <td><Badge value={item.status} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!filtered.length && !loading ? <Empty text="Belum ada assignment reviewer." /> : null}
      </section>

      {modal ? <Modal title="Assign Reviewer" description="Versi aktif artikel akan digunakan untuk assignment." onClose={() => setModal(false)}>
        <form className={styles.form} onSubmit={submit}>
          <Field label="Artikel">
            <select className={styles.select} required value={form.article_id} onChange={(e) => setForm((x) => ({ ...x, article_id: e.target.value }))} disabled={!availableArticles.length}>
              <option value="">{availableArticles.length ? "-- Pilih Artikel --" : "Tidak ada artikel yang bisa di-assign"}</option>
              {availableArticles.map((a) => <option key={a.id} value={a.id}>{a.title} — v{a.current_version.version_number}</option>)}
            </select>
          </Field>
          <Field label="Reviewer">
            <select className={styles.select} required value={form.reviewer_user_id} onChange={(e) => setForm((x) => ({ ...x, reviewer_user_id: e.target.value }))}>
              <option value="">-- Pilih Reviewer --</option>
              {reviewers.map((r) => <option key={r.id} value={r.id}>{r.lecturer_profile?.full_name || r.username}</option>)}
            </select>
          </Field>
          <Field label="Deadline Review"><input className={styles.input} type="date" value={form.deadline} onChange={(e) => setForm((x) => ({ ...x, deadline: e.target.value }))} /></Field>
          <Field label="Catatan untuk Reviewer"><textarea className={styles.textarea} value={form.admin_note} onChange={(e) => setForm((x) => ({ ...x, admin_note: e.target.value }))} /></Field>
          <div className={styles.modalActions}><button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={() => setModal(false)}>Batal</button><button className={`${styles.btn} ${styles.primary}`} disabled={saving || !availableArticles.length}>{saving ? "Menyimpan..." : "Assign Reviewer"}</button></div>
        </form>
      </Modal> : null}
    </>
  );
}
