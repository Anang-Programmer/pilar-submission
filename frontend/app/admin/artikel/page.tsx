"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

function normalizeStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function statusFilterLabel(value: unknown): string {
  const status = normalizeStatus(value);

  if (["final", "finalized", "selesai", "completed"].includes(status)) {
    return "Final";
  }
  if (["revision", "revisi", "revision_requested", "revision_required", "major_revision", "minor_revision"].includes(status)) {
    return "Revisi";
  }
  if (["under_review", "in_review", "review", "reviewing", "assigned", "assigned_to_reviewer"].includes(status)) {
    return "Sedang Direview";
  }
  if (["rejected", "ditolak", "tolak"].includes(status)) {
    return "Ditolak";
  }
  if (["submitted", "pending", "menunggu_assignment", "waiting_assignment", "draft", ""].includes(status)) {
    return "Menunggu Assignment";
  }

  return String(value || "Menunggu Assignment");
}

export default function AdminArticlesPage() {
  const router = useRouter();
  const [articles, setArticles] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await api.admin.articlesAdmin();
      setArticles(Array.isArray(result) ? result : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat artikel");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return articles.filter((item) => {
      const authors = (item.authors || [])
        .map((a: any) => [a.student?.full_name || "", a.student?.nim || ""].join(" "))
        .join(" ");
      const displayStatus = statusFilterLabel(item.status);
      const haystack = [
        item.title,
        authors,
        item.journal?.name,
        item.journal?.abbreviation,
        item.project?.title,
        item.status,
        displayStatus,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !q || haystack.includes(q);
      const matchesStatus = !statusFilter || displayStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [articles, search, statusFilter]);

  async function openVersions(article: any) {
    setSelected(article);
    setVersions([]);
    try {
      const result = await api.admin.articleVersions(article.id);
      setVersions(Array.isArray(result) ? result : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat versi artikel");
    }
  }

  return (
    <>
      <PageHeader title="Monitoring Artikel" description="Pantau artikel dari pengiriman sampai finalisasi." />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        <div className={styles.filter}>
          <input
            className={styles.input}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari artikel/penulis..."
          />
          <select
            className={styles.select}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Semua Status</option>
            <option value="Menunggu Assignment">Menunggu Assignment</option>
            <option value="Sedang Direview">Sedang Direview</option>
            <option value="Revisi">Revisi</option>
            <option value="Final">Final</option>
            <option value="Ditolak">Ditolak</option>
          </select>
        </div>

        {loading ? <div className={styles.loadingBar}>Memuat artikel...</div> : null}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>No</th>
                <th>Penulis</th>
                <th>Artikel</th>
                <th>Jurnal</th>
                <th>Versi</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td>
                  <td>{(item.authors || []).map((a: any) => a.student?.full_name).filter(Boolean).join(", ") || "—"}</td>
                  <td>{item.title}</td>
                  <td>{item.journal?.name || "—"}</td>
                  <td>{item.current_version ? `v${item.current_version.version_number}` : "—"}</td>
                  <td><Badge value={item.status || "Menunggu Assignment"} /></td>
                  <td>
                    <button
                      className={`${styles.btn} ${styles.small} ${styles.secondary}`}
                      onClick={() => openVersions(item)}
                    >
                      Detail Versi
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!filtered.length && !loading ? <Empty text="Belum ada artikel yang sesuai." /> : null}
      </section>

      {selected ? (
        <div
          className={styles.modalBackdrop}
          onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div>
                <h2>Detail Artikel</h2>
                <p>{selected.title}</p>
              </div>
              <button className={styles.iconButton} onClick={() => setSelected(null)}>×</button>
            </div>

            <div className={styles.detailGrid}>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>Jurnal</div>
                <div className={styles.detailValue}>{selected.journal?.name || "—"}</div>
              </div>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>Status</div>
                <div className={styles.detailValue}><Badge value={selected.status} /></div>
              </div>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>Current Version</div>
                <div className={styles.detailValue}>{selected.current_version ? `v${selected.current_version.version_number}` : "Belum ada"}</div>
              </div>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>Penulis</div>
                <div className={styles.detailValue}>{(selected.authors || []).map((a: any) => a.student?.full_name).filter(Boolean).join(", ") || "—"}</div>
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <h3 className={styles.panelTitle}>Riwayat Versi</h3>
              {versions.length ? versions.map((version: any) => (
                <div key={version.id} className={styles.detailItem} style={{ marginBottom: 8 }}>
                  <strong>v{version.version_number}</strong> · {version.file_name || "Tanpa nama file"} · {version.version_status || "—"}
                </div>
              )) : <Empty text="Belum ada versi artikel." />}
            </div>

            <div className={styles.actions} style={{ marginTop: 18, justifyContent: "flex-end" }}>
              <button
                type="button"
                className={`${styles.btn} ${styles.primary}`}
                onClick={() => router.push(`/admin/assignment-reviewer?article_id=${selected.id}`)}
              >
                Assignment Reviewer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
