"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../../admin/admin.module.css";

export default function DashboardUserReviewersPage() {
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.admin.reviewers()
      .then((data) => active && setReviewers(Array.isArray(data) ? data : []))
      .catch((e) => active && setError(e instanceof ApiError ? e.message : "Gagal memuat reviewer"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reviewers;
    return reviewers.filter((item) => {
      const profile = item.lecturer_profile || {};
      return [profile.full_name, profile.nidn, profile.nip, profile.academic_title, item.username, item.email]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [reviewers, search]);

  return (
    <>
      <PageHeader title="Monitoring Reviewer" description="Daftar reviewer yang terdaftar pada sistem PILAR." />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        <div className={styles.filter}>
          <input className={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama/NIDN/email..." />
        </div>
        {loading ? <div className={styles.loadingBar}>Memuat reviewer...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>No</th><th>Nama</th><th>NIDN/NIP</th><th>Gelar</th><th>Email</th><th>Status</th></tr></thead>
            <tbody>{filtered.map((item, index) => {
              const profile = item.lecturer_profile || {};
              return <tr key={item.id}><td>{index + 1}</td><td><strong>{profile.full_name || item.username || "—"}</strong></td><td>{profile.nidn || profile.nip || "—"}</td><td>{profile.academic_title || "—"}</td><td>{item.email || "—"}</td><td><Badge value={item.is_active ? "Aktif" : "Nonaktif"} /></td></tr>;
            })}</tbody>
          </table>
        </div>
        {!filtered.length && !loading ? <Empty text="Belum ada reviewer yang sesuai." /> : null}
      </section>
    </>
  );
}
