"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../../lib/api";
import { Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../../admin/admin.module.css";

export default function DashboardUserCoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.admin.courses()
      .then((data) => active && setCourses(Array.isArray(data) ? data : []))
      .catch((e) => active && setError(e instanceof ApiError ? e.message : "Gagal memuat mata kuliah"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courses.filter((item) => !q || `${item.code || ""} ${item.name || ""} ${item.study_program || ""} ${item.semester || ""}`.toLowerCase().includes(q));
  }, [courses, search]);

  return (
    <>
      <PageHeader title="Monitoring Mata Kuliah" description="Daftar mata kuliah yang digunakan dalam program PILAR." />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        <div className={styles.filter}>
          <input className={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari kode/nama mata kuliah..." />
        </div>
        {loading ? <div className={styles.loadingBar}>Memuat mata kuliah...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>No</th><th>Kode</th><th>Nama Mata Kuliah</th><th>Semester</th><th>Program Studi</th></tr></thead>
            <tbody>{filtered.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td>{item.code || "—"}</td><td><strong>{item.name || "—"}</strong></td><td>{item.semester ?? "—"}</td><td>{item.study_program || "—"}</td></tr>)}</tbody>
          </table>
        </div>
        {!filtered.length && !loading ? <Empty text="Belum ada mata kuliah yang sesuai." /> : null}
      </section>
    </>
  );
}
