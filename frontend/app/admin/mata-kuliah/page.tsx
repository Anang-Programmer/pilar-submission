"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

const emptyForm = { code: "", name: "", semester: "", study_program: "" };

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { const data = await api.admin.courses(); setCourses(Array.isArray(data) ? data : []); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Gagal memuat mata kuliah"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function resetForm() { setForm(emptyForm); setEditingId(null); }
  function edit(item: any) { setEditingId(Number(item.id)); setForm({ code: item.code || "", name: item.name || "", semester: item.semester ? String(item.semester) : "", study_program: item.study_program || "" }); }

  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const payload = { code: form.code || null, name: form.name.trim(), semester: form.semester ? Number(form.semester) : null, study_program: form.study_program || null };
      if (editingId) await api.admin.updateCourse(editingId, payload); else await api.admin.createCourse(payload);
      resetForm(); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Gagal menyimpan mata kuliah"); }
    finally { setSaving(false); }
  }

  async function remove(item: any) {
    if (!window.confirm(`Hapus mata kuliah ${item.name}?`)) return;
    try { await api.admin.deleteCourse(Number(item.id)); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Gagal menghapus mata kuliah"); }
  }

  return <>
    <PageHeader title="Mata Kuliah" description="Kelola daftar mata kuliah yang dapat didaftarkan kepada peserta PILAR." />
    <ErrorBanner message={error} onClose={() => setError("")} />
    <section className={styles.panel}>
      <div className={styles.panelTitle}>{editingId ? "Edit Mata Kuliah" : "Tambah Mata Kuliah"}</div>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.formGrid}>
          <label className={styles.field}><span>Nama Mata Kuliah</span><input className={styles.input} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className={styles.field}><span>Kode</span><input className={styles.input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Opsional" /></label>
          <label className={styles.field}><span>Semester</span><input className={styles.input} type="number" min={1} max={20} value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })} /></label>
          <label className={styles.field}><span>Program Studi</span><input className={styles.input} value={form.study_program} onChange={(e) => setForm({ ...form, study_program: e.target.value })} placeholder="PTIK" /></label>
        </div>
        <div className={styles.actions} style={{ justifyContent: "flex-end" }}>
          {editingId ? <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={resetForm}>Batal</button> : null}
          <button className={`${styles.btn} ${styles.primary}`} disabled={saving}>{saving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Tambah Mata Kuliah"}</button>
        </div>
      </form>
    </section>
    <section className={styles.panel}>
      <div className={styles.panelTitle}>Daftar Mata Kuliah</div>
      {loading ? <div className={styles.loadingBar}>Memuat mata kuliah...</div> : null}
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>No</th><th>Kode</th><th>Nama Mata Kuliah</th><th>Semester</th><th>Program Studi</th><th>Aksi</th></tr></thead>
        <tbody>{courses.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td>{item.code || "—"}</td><td><strong>{item.name}</strong></td><td>{item.semester || "—"}</td><td>{item.study_program || "—"}</td><td><div className={styles.actions}><button className={`${styles.btn} ${styles.small} ${styles.secondary}`} onClick={() => edit(item)}>Edit</button><button className={`${styles.btn} ${styles.small} ${styles.danger}`} onClick={() => remove(item)}>Hapus</button></div></td></tr>)}</tbody>
      </table></div>
      {!courses.length && !loading ? <Empty text="Belum ada mata kuliah." /> : null}
    </section>
  </>;
}
