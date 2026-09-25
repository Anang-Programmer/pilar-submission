"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { ErrorBanner, Field, PageHeader } from "../../../../components/admin/AdminUI";
import styles from "../../admin.module.css";

const defaultForm = {
  username: "",
  email: "",
  password: "",
  role: "reviewer",
  is_active: true,
  full_name: "",
  nidn: "",
  nip: "",
  academic_title: "",
  nim: "",
  study_program: "Pendidikan Teknologi Informatika dan Komputer",
  class_name: "",
  phone: "",
  course_id: "",
  mentor_lecturer_id: "",
};

export default function AddUserPage() {
  const router = useRouter();
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [courses, setCourses] = useState<any[]>([]);
  const [reviewers, setReviewers] = useState<any[]>([]);

  useEffect(() => {
    if (form.role !== "peserta") return;
    Promise.all([api.admin.courses(), api.admin.reviewers()])
      .then(([courseData, reviewerData]) => {
        setCourses(Array.isArray(courseData) ? courseData : []);
        setReviewers(Array.isArray(reviewerData) ? reviewerData : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat data mata kuliah/reviewer"));
  }, [form.role]);

  const roleLabel = useMemo(() => form.role === "reviewer" ? "Profil Reviewer" : form.role === "peserta" ? "Profil Peserta" : form.role === "dashboard" ? "-" : "Data Akun Admin", [form.role]);

  function setField(key: string, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.admin.createUser({
        ...form,
        nidn: form.nidn || null,
        nip: form.nip || null,
        academic_title: form.academic_title || null,
        nim: form.nim || null,
        study_program: form.study_program || null,
        class_name: form.class_name || null,
        phone: form.phone || null,
        full_name: form.full_name || null,
        course_id: form.role === "peserta" && form.course_id ? Number(form.course_id) : null,
        mentor_lecturer_id: form.role === "peserta" && form.mentor_lecturer_id ? Number(form.mentor_lecturer_id) : null,
      });
      router.push("/admin/pengguna");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat pengguna");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Tambah Pengguna" description="Buat akun baru dan, bila diperlukan, buat profil akademik Reviewer atau Peserta." />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            <Field label="Username"><input className={styles.input} required minLength={3} value={form.username} onChange={(e) => setField("username", e.target.value)} /></Field>
            <Field label="Email"><input className={styles.input} required type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} /></Field>
            <Field label="Password" hint="Minimal 8 karakter."><input className={styles.input} required minLength={8} type="password" value={form.password} onChange={(e) => setField("password", e.target.value)} /></Field>
            <Field label="Role"><select className={styles.select} value={form.role} onChange={(e) => setField("role", e.target.value)}><option value="admin">Admin</option><option value="reviewer">Reviewer</option><option value="peserta">Peserta</option><option value="dashboard">Dashboard</option></select></Field>
          </div>

          <div className={styles.formSection}>
            <h3>{roleLabel}</h3>
            {form.role === "reviewer" ? (
              <div className={styles.formGrid}>
                <Field label="Nama Lengkap"><input className={styles.input} required value={form.full_name} onChange={(e) => setField("full_name", e.target.value)} /></Field>
                <Field label="NIDN"><input className={styles.input} value={form.nidn} onChange={(e) => setField("nidn", e.target.value)} /></Field>
                <Field label="NIP"><input className={styles.input} value={form.nip} onChange={(e) => setField("nip", e.target.value)} /></Field>
                <Field label="Gelar Akademik"><input className={styles.input} value={form.academic_title} onChange={(e) => setField("academic_title", e.target.value)} /></Field>
              </div>
            ) : form.role === "peserta" ? (
              <div className={styles.formGrid}>
                <Field label="Nama Lengkap"><input className={styles.input} required value={form.full_name} onChange={(e) => setField("full_name", e.target.value)} /></Field>
                <Field label="NIM"><input className={styles.input} required value={form.nim} onChange={(e) => setField("nim", e.target.value)} /></Field>
                <Field label="Program Studi"><input className={styles.input} value={form.study_program} onChange={(e) => setField("study_program", e.target.value)} /></Field>
                <Field label="Kelas"><input className={styles.input} value={form.class_name} onChange={(e) => setField("class_name", e.target.value)} /></Field>
                <Field label="No. HP"><input className={styles.input} value={form.phone} onChange={(e) => setField("phone", e.target.value)} /></Field>
                <Field label="Mata Kuliah">
                  <select className={styles.select} value={form.course_id} onChange={(e) => setField("course_id", e.target.value)}>
                    <option value="">Pilih mata kuliah</option>
                    {courses.map((course) => <option key={course.id} value={course.id}>{course.code ? `${course.code} — ` : ""}{course.name}</option>)}
                  </select>
                  {!courses.length ? <span className={styles.fieldHint}>Belum ada mata kuliah. Tambahkan dari menu Mata Kuliah.</span> : null}
                </Field>
                <Field label="Dosen Pendamping">
                  <select className={styles.select} value={form.mentor_lecturer_id} onChange={(e) => setField("mentor_lecturer_id", e.target.value)}>
                    <option value="">Pilih dosen pendamping</option>
                    {reviewers.map((item) => { const p = item.lecturer_profile || {}; return <option key={p.id || item.id} value={p.id}>{p.full_name || item.username}{p.academic_title ? `, ${p.academic_title}` : ""}</option>; })}
                  </select>
                  {!reviewers.length ? <span className={styles.fieldHint}>Belum ada Reviewer. Tambahkan Reviewer dari menu Reviewer/Pengguna.</span> : null}
                </Field>
              </div>
            ) : (
              <p className={styles.fieldHint}>{form.role === "dashboard" ? "-" : "-"}</p>
            )}
          </div>

          <div className={styles.actions} style={{ justifyContent: "flex-end" }}>
            <Link href="/admin/pengguna" className={`${styles.btn} ${styles.secondary}`}>Batal</Link>
            <button className={`${styles.btn} ${styles.primary}`} disabled={saving}>{saving ? "Menyimpan..." : "Simpan Pengguna"}</button>
          </div>
        </form>
      </section>
    </>
  );
}
