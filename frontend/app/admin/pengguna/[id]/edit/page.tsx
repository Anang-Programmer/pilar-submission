"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "../../../../../lib/api"
import { ErrorBanner, Field, PageHeader } from "../../../../../components/admin/AdminUI"
import styles from "../../../admin.module.css";

function mentorLabel(item: any) {
  const p = item?.mentor;
  return p ? `${p.full_name}${p.academic_title ? `, ${p.academic_title}` : ""}` : "—";
}

export default function EditUserPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);
  const [user, setUser] = useState<any>(null);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [form, setForm] = useState<any>(null);
  const [newAssignment, setNewAssignment] = useState({ course_id: "", lecturer_id: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const data = await api.admin.user(id);
      const role = String(data?.roles?.[0] || "").toLowerCase();
      setUser(data);
      setForm({
        username: data.username || "",
        email: data.email || "",
        role,
        is_active: Boolean(data.is_active),
        full_name: data.student_profile?.full_name || data.lecturer_profile?.full_name || "",
        nim: data.student_profile?.nim || "",
        study_program: data.student_profile?.study_program || "",
        class_name: data.student_profile?.class_name || "",
        phone: data.student_profile?.phone || "",
        nidn: data.lecturer_profile?.nidn || "",
        nip: data.lecturer_profile?.nip || "",
        academic_title: data.lecturer_profile?.academic_title || "",
      });
      if (role === "peserta") {
        const [courseData, reviewerData, assignmentData] = await Promise.all([
          api.admin.courses(), api.admin.reviewers(), api.admin.participantAssignments(id),
        ]);
        setCourses(Array.isArray(courseData) ? courseData : []);
        setReviewers(Array.isArray(reviewerData) ? reviewerData : []);
        setAssignments(Array.isArray(assignmentData) ? assignmentData : []);
      } else {
        setAssignments([]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Gagal memuat pengguna");
    } finally { setLoading(false); }
  }

  useEffect(() => { if (Number.isFinite(id)) load(); }, [id]);

  function setField(key: string, value: string | boolean) { setForm((current: any) => ({ ...current, [key]: value })); }

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!form) return;
    setSaving(true); setError("");
    try {
      await api.admin.updateUser(id, {
        username: form.username,
        email: form.email,
        role: form.role,
        is_active: form.is_active,
        full_name: form.full_name || null,
        nim: form.nim || null,
        study_program: form.study_program || null,
        class_name: form.class_name || null,
        phone: form.phone || null,
        nidn: form.nidn || null,
        nip: form.nip || null,
        academic_title: form.academic_title || null,
      });
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Gagal memperbarui pengguna"); }
    finally { setSaving(false); }
  }

  async function addAssignment(e: FormEvent) {
    e.preventDefault();
    if (!newAssignment.course_id || !newAssignment.lecturer_id) {
      setError("Mata Kuliah dan Dosen Pendamping wajib dipilih."); return;
    }
    setAssignmentSaving(true); setError("");
    try {
      await api.admin.createParticipantAssignment(id, {
        course_id: Number(newAssignment.course_id),
        lecturer_id: Number(newAssignment.lecturer_id),
      });
      setNewAssignment({ course_id: "", lecturer_id: "" });
      const data = await api.admin.participantAssignments(id);
      setAssignments(Array.isArray(data) ? data : []);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Gagal menambah Mata Kuliah peserta"); }
    finally { setAssignmentSaving(false); }
  }

  async function removeAssignment(assignment: any) {
    if (!window.confirm(`Hapus Mata Kuliah ${assignment.course?.name || "ini"} dari peserta?`)) return;
    try {
      await api.admin.deleteParticipantAssignment(id, assignment.id);
      setAssignments((current) => current.filter((item) => item.id !== assignment.id));
    } catch (e) { setError(e instanceof ApiError ? e.message : "Gagal menghapus assignment peserta"); }
  }

  if (loading) return <div className={styles.loadingBar}>Memuat pengguna...</div>;
  if (!user || !form) return <ErrorBanner message={error || "Pengguna tidak ditemukan"} onClose={() => setError("")} />;

  return <>
    <PageHeader title="Edit Pengguna" description={`Perbarui data akun ${user.username}.`} />
    <ErrorBanner message={error} onClose={() => setError("")} />
    <section className={styles.panel}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.formGrid}>
          <Field label="Username"><input className={styles.input} required minLength={3} value={form.username} onChange={(e) => setField("username", e.target.value)} /></Field>
          <Field label="Email"><input className={styles.input} required type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} /></Field>
          <Field label="Role"><select className={styles.select} value={form.role} onChange={(e) => setField("role", e.target.value)}><option value="admin">Admin</option><option value="reviewer">Reviewer</option><option value="peserta">Peserta</option></select></Field>
          <Field label="Status"><select className={styles.select} value={form.is_active ? "active" : "inactive"} onChange={(e) => setField("is_active", e.target.value === "active")}><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></Field>
        </div>

        {form.role === "reviewer" ? <div className={styles.formSection}><h3>Profil Reviewer</h3><div className={styles.formGrid}>
          <Field label="Nama Lengkap"><input className={styles.input} required value={form.full_name} onChange={(e) => setField("full_name", e.target.value)} /></Field>
          <Field label="NIDN"><input className={styles.input} value={form.nidn} onChange={(e) => setField("nidn", e.target.value)} /></Field>
          <Field label="NIP"><input className={styles.input} value={form.nip} onChange={(e) => setField("nip", e.target.value)} /></Field>
          <Field label="Gelar Akademik"><input className={styles.input} value={form.academic_title} onChange={(e) => setField("academic_title", e.target.value)} /></Field>
        </div></div> : null}

        {form.role === "peserta" ? <div className={styles.formSection}><h3>Profil Peserta</h3><div className={styles.formGrid}>
          <Field label="Nama Lengkap"><input className={styles.input} required value={form.full_name} onChange={(e) => setField("full_name", e.target.value)} /></Field>
          <Field label="NIM"><input className={styles.input} required value={form.nim} onChange={(e) => setField("nim", e.target.value)} /></Field>
          <Field label="Program Studi"><input className={styles.input} value={form.study_program} onChange={(e) => setField("study_program", e.target.value)} /></Field>
          <Field label="Kelas"><input className={styles.input} value={form.class_name} onChange={(e) => setField("class_name", e.target.value)} /></Field>
          <Field label="No. HP"><input className={styles.input} value={form.phone} onChange={(e) => setField("phone", e.target.value)} /></Field>
        </div></div> : null}

        <div className={styles.actions} style={{ justifyContent: "flex-end" }}><Link href="/admin/pengguna" className={`${styles.btn} ${styles.secondary}`}>Kembali</Link><button className={`${styles.btn} ${styles.primary}`} disabled={saving}>{saving ? "Menyimpan..." : "Simpan Perubahan"}</button></div>
      </form>
    </section>

    {form.role === "peserta" ? <section className={styles.panel}>
      <div className={styles.panelTitle}>Mata Kuliah & Dosen Pendamping Peserta</div>
      <div className={styles.fieldHint} style={{ marginBottom: 16 }}>Satu peserta dapat memiliki banyak Mata Kuliah. Setiap Mata Kuliah memiliki Dosen Pendamping tersendiri.</div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>No</th><th>Mata Kuliah</th><th>Dosen Pendamping</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>{assignments.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td><strong>{item.course?.name || "—"}</strong></td><td>{mentorLabel(item)}</td><td>{item.status || "active"}</td><td><button className={`${styles.btn} ${styles.small} ${styles.danger}`} onClick={() => removeAssignment(item)}>Hapus</button></td></tr>)}</tbody>
      </table></div>
      {!assignments.length ? <div className={styles.fieldHint} style={{ marginTop: 12 }}>Belum ada Mata Kuliah yang didaftarkan untuk peserta ini.</div> : null}

      <form className={styles.form} onSubmit={addAssignment} style={{ marginTop: 20 }}>
        <h4 style={{ margin: 0 }}>Tambah Mata Kuliah</h4>
        <div className={styles.formGrid}>
          <Field label="Mata Kuliah"><select className={styles.select} value={newAssignment.course_id} onChange={(e) => setNewAssignment({ ...newAssignment, course_id: e.target.value })}><option value="">Pilih mata kuliah</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code ? `${c.code} — ` : ""}{c.name}</option>)}</select></Field>
          <Field label="Dosen Pendamping"><select className={styles.select} value={newAssignment.lecturer_id} onChange={(e) => setNewAssignment({ ...newAssignment, lecturer_id: e.target.value })}><option value="">Pilih Reviewer sebagai Pendamping</option>{reviewers.map((r) => { const p = r.lecturer_profile || {}; return <option key={p.id || r.id} value={p.id}>{p.full_name || r.username}{p.academic_title ? `, ${p.academic_title}` : ""}</option>; })}</select></Field>
        </div>
        <div className={styles.actions} style={{ justifyContent: "flex-end" }}><button className={`${styles.btn} ${styles.primary}`} disabled={assignmentSaving}>{assignmentSaving ? "Menambah..." : "Tambah Assignment"}</button></div>
      </form>
    </section> : null}
  </>;
}
