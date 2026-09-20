"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

function displayStatus(item: any): string {
  return item.review_selection_status || "Belum Terpilih";
}

export default function AdminProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await api.admin.projects();
      setProjects(Array.isArray(result) ? result : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat proyek");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleArticleAction(projectId: number, action: "view" | "download") {
    const popup = action === "view" ? window.open("", "_blank") : null;
    setActionLoading(projectId);
    setError("");
    try {
      const result = await api.admin.projectArticleAccess(projectId);
      const url = action === "download" ? result.download_url : result.view_url;
      if (!url) throw new Error("Link artikel tidak tersedia");

      if (action === "view") {
        if (popup) popup.location.href = url;
        else window.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (e) {
      if (popup) popup.close();
      setError(e instanceof Error ? e.message : "Gagal membuka artikel");
    } finally {
      setActionLoading(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((item) => {
      const text = `${item.submitter?.full_name || ""} ${item.title || ""} ${item.course?.name || ""} ${item.pendamping?.full_name || ""}`.toLowerCase();
      return (!q || text.includes(q)) && (!status || displayStatus(item).toLowerCase() === status.toLowerCase());
    });
  }, [projects, search, status]);

  return (
    <>
      <PageHeader title="Monitoring Proyek" description="Inventarisasi dan status proyek PjBL mahasiswa." />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        <div className={styles.filter}>
          <input className={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari mahasiswa/judul..." />
          <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua Status</option>
            <option value="Terpilih">Terpilih</option>
            <option value="Belum Terpilih">Belum Terpilih</option>
          </select>
        </div>
        {loading ? <div className={styles.loadingBar}>Memuat proyek...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>No</th><th>Mahasiswa</th><th>Judul Proyek</th><th>Mata Kuliah</th><th>Status</th><th>Pendamping</th><th>Aksi</th></tr></thead>
            <tbody>
              {filtered.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td>
                  <td>{item.submitter?.full_name || "—"}</td>
                  <td>{item.title}</td>
                  <td>{item.course?.name || "—"}</td>
                  <td><Badge value={displayStatus(item)} /></td>
                  <td>{item.pendamping?.full_name || "—"}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.secondary}`}
                        onClick={() => handleArticleAction(item.id, "view")}
                        disabled={actionLoading === item.id || !item.article?.current_version?.has_file}
                      >
                        Lihat
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.small} ${styles.primary}`}
                        onClick={() => handleArticleAction(item.id, "download")}
                        disabled={actionLoading === item.id || !item.article?.current_version?.has_file}
                      >
                        Download
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && !loading ? <Empty text="Belum ada proyek yang sesuai." /> : null}
      </section>
    </>
  );
}
