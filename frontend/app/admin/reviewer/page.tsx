"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

export default function AdminReviewersPage() {
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { const data = await api.admin.reviewers(); setReviewers(Array.isArray(data) ? data : []); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Gagal memuat reviewer"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return <>
    <PageHeader title="Daftar Reviewer" description="Daftar Reviewer yang dapat ditugaskan sebagai Reviewer artikel maupun Dosen Pendamping peserta." actions={<Link href="/admin/pengguna/tambah?role=reviewer" className={`${styles.btn} ${styles.primary}`}>+ Tambah Reviewer</Link>} />
    <ErrorBanner message={error} onClose={() => setError("")} />
    <section className={styles.panel}>
      {loading ? <div className={styles.loadingBar}>Memuat reviewer...</div> : null}
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>No</th><th>Nama</th><th>Username</th><th>NIDN/NIP</th><th>Gelar</th><th>Email</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>{reviewers.map((item, index) => { const p = item.lecturer_profile || {}; return <tr key={item.id}><td>{index + 1}</td><td><strong>{p.full_name || item.username}</strong></td><td>{item.username}</td><td>{p.nidn || p.nip || "—"}</td><td>{p.academic_title || "—"}</td><td>{item.email}</td><td><Badge value={item.is_active ? "Aktif" : "Nonaktif"} /></td><td><Link href={`/admin/pengguna/${item.id}/edit`} className={`${styles.btn} ${styles.small} ${styles.secondary}`}>Edit</Link></td></tr>; })}</tbody>
      </table></div>
      {!reviewers.length && !loading ? <Empty text="Belum ada Reviewer." /> : null}
    </section>
  </>;
}
