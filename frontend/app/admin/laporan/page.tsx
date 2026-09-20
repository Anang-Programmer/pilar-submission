"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { ErrorBanner, Metric, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

export default function AdminReportsPage() {
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.admin.reportSummary().then(setReport).catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat laporan")).finally(() => setLoading(false));
  }, []);

  async function exportReport() {
    setExporting(true); setError("");
    try {
      const blob = await api.admin.exportReport();
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = "pilar-admin-summary.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal export laporan"); }
    finally { setExporting(false); }
  }

  return (
    <>
      <PageHeader title="Laporan" description="Ringkasan capaian dan monitoring Program PILAR." actions={<button className={`${styles.btn} ${styles.primary}`} onClick={exportReport} disabled={exporting}>{exporting ? "Menyiapkan..." : "Generate Laporan"}</button>} />
      <ErrorBanner message={error} onClose={() => setError("")} />
      {loading ? <div className={styles.loadingBar}>Memuat ringkasan...</div> : null}
      <div className={`${styles.cards} ${styles.six}`}>
        <Metric value={report?.total_projects ?? "—"} label="Total Usulan Proyek" />
        <Metric value={report?.selected_projects ?? "—"} label="Proyek Terpilih" />
        <Metric value={report?.total_articles ?? "—"} label="Artikel Masuk" />
        <Metric value={report?.articles_waiting_assignment ?? "—"} label="Belum Di-assign" />
        <Metric value={report?.articles_in_review ?? "—"} label="Sedang Direview" />
        <Metric value={report?.articles_in_revision ?? "—"} label="Dalam Revisi" />
      </div>
    </>
  );
}
