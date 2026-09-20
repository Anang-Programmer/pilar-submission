"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.admin.users({ role: role || undefined });
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat pengguna");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [role]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((item: any) => {
      const profile = item.lecturer_profile || item.student_profile || {};
      return `${item.username} ${item.email} ${(item.roles || []).join(" ")} ${profile.full_name || ""} ${profile.nim || ""} ${profile.nip || ""}`.toLowerCase().includes(q);
    });
  }, [search, users]);

  async function toggleUser(item: any) {
    try {
      await api.admin.updateUser(item.id, { is_active: !item.is_active });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengubah status user");
    }
  }

  async function removeUser(item: any) {
    if (!window.confirm(`Yakin ingin menghapus pengguna "${item.username}"? Data yang terkait dengan akun ini juga akan dihapus. Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await api.admin.deleteUser(item.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menghapus user");
    }
  }

  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Kelola seluruh akun Admin, Reviewer, dan Peserta."
        actions={<Link href="/admin/pengguna/tambah" className={`${styles.btn} ${styles.primary}`}>+ Tambah Pengguna</Link>}
      />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        <div className={styles.filter}>
          <input className={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari username, nama, email, NIM/NIP..." />
          <select className={styles.select} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Semua Role</option>
            <option value="admin">Admin</option>
            <option value="reviewer">Reviewer</option>
            <option value="peserta">Peserta</option>
          </select>
        </div>
        {loading ? <div className={styles.loadingBar}>Memuat pengguna...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Username</th><th>Nama</th><th>Email</th><th>Role</th><th>Mata Kuliah</th><th>Pendamping</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {filtered.map((item: any) => {
                const profile = item.lecturer_profile || item.student_profile || {};
                return (
                  <tr key={item.id}>
                    <td><strong>{item.username}</strong></td>
                    <td>{profile.full_name || "—"}</td>
                    <td>{item.email}</td>
                    <td><div className={styles.roleStack}>{(item.roles || []).map((r: string) => <span className={styles.rolePill} key={r}>{r}</span>)}</div></td>
                    <td>{(item.participant_assignments || []).length ? item.participant_assignments.map((a: any) => a.course?.name).filter(Boolean).join(", ") : "—"}</td>
                    <td>{(item.participant_assignments || []).length ? item.participant_assignments.map((a: any) => a.mentor?.full_name).filter(Boolean).join(", ") : "—"}</td>
                    <td><Badge value={item.is_active ? "Aktif" : "Nonaktif"} /></td>
                    <td>
                      <div className={styles.actions}>
                        <Link href={`/admin/pengguna/${item.id}/edit`} className={`${styles.btn} ${styles.small} ${styles.secondary}`}>Edit</Link>
                        <button className={`${styles.btn} ${styles.small} ${styles.secondary}`} onClick={() => toggleUser(item)}>{item.is_active ? "Nonaktifkan" : "Aktifkan"}</button>
                        <button className={`${styles.btn} ${styles.small} ${styles.danger}`} onClick={() => removeUser(item)}>Hapus</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filtered.length && !loading ? <Empty text="Belum ada pengguna yang sesuai." /> : null}
      </section>
    </>
  );
}
