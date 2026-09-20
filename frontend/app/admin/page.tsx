"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import styles from "./admin.module.css";

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className={styles.card}>
      <div className={styles.num}>{value}</div>
      <div className={styles.label}>{label}</div>
    </div>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className={styles.progressBar}>
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}


export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      const results = await Promise.allSettled([
        api.admin.dashboard(),
        api.admin.reportSummary(),
        api.admin.projects(),
        api.admin.auditLogs(),
      ]);

      if (!active) return;

      const [dashboardResult, reportResult, projectsResult, auditResult] = results;

      if (dashboardResult.status === "fulfilled") {
        setDashboard(dashboardResult.value);
      }
      if (reportResult.status === "fulfilled") {
        setReport(reportResult.value);
      }
      if (projectsResult.status === "fulfilled") {
        const value: any = projectsResult.value;
        setProjects(Array.isArray(value) ? value : value?.items ?? []);
      }
      if (auditResult.status === "fulfilled") {
        const value: any = auditResult.value;
        setAuditLogs(Array.isArray(value) ? value : value?.items ?? []);
      }

      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (rejected) {
        setError(
          rejected.reason instanceof Error
            ? rejected.reason.message
            : "Sebagian data dashboard gagal dimuat."
        );
      }

      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const totalProjects = Number(report?.total_projects ?? dashboard?.total_projects ?? 0);
  const selectedProjects = Number(report?.selected_projects ?? 0);
  const totalArticles = Number(report?.total_articles ?? dashboard?.total_articles ?? 0);
  const totalReviewAssignments = Number(report?.total_review_assignments ?? 0);
  const completedReviewAssignments = Number(report?.completed_review_assignments ?? 0);
  const articlesFinalized = Number(report?.articles_finalized ?? 0);

  const selectedProgress = totalProjects
    ? Math.round((selectedProjects / totalProjects) * 100)
    : 0;
  const mentorshipProgress = Number(report?.mentorship_progress ?? 0);
  const reviewProgress = totalReviewAssignments
    ? Math.round((completedReviewAssignments / totalReviewAssignments) * 100)
    : 0;
  const finalProgress = totalArticles
    ? Math.round((articlesFinalized / totalArticles) * 100)
    : 0;

  const recentActivities = auditLogs.slice(0, 5);

  const formatDateTime = (value?: string) => {
  if (!value) return "";

  const hasTimezone = /Z|[+-]\d{2}:\d{2}$/.test(value);

  const date = new Date(
    hasTimezone ? value : `${value}Z`
  );

  return date.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

  const auditActionLabel = (action: string | undefined) => {
    const labels: Record<string, string> = {
      "reviewer_assignment.create": "Reviewer ditugaskan",
      "reviewer_assignment.update": "Assignment reviewer diperbarui",
      "reviewer_assignment.delete": "Assignment reviewer dihapus",
      "project_selection.create": "Status seleksi proyek diperbarui",
      "project_selection.update": "Status seleksi proyek diperbarui",
      "project.update": "Proyek diperbarui",
      "project.delete": "Proyek dihapus",
      "article.create": "Artikel ditambahkan",
      "article.update": "Artikel diperbarui",
      "article.delete": "Artikel dihapus",
      "mentorship_assignment.create": "Pendamping ditugaskan",
      "mentorship_assignment.update": "Pendamping diperbarui",
      "mentorship_assignment.delete": "Pendamping dihapus",
    };
    return labels[action || ""] || "Aktivitas diperbarui";
  };

  async function exportReport() {
    try {
      const blob = await api.admin.exportReport();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "pilar-admin-summary.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengekspor laporan.");
    }
  }

  return (
    <>
      <div className={styles.titleRow}>
        <div>
          <h1>Dashboard Monitoring</h1>
          <p>Monitoring terintegrasi Program PILAR PTIK 2026.</p>
        </div>
        <button className={`${styles.btn} ${styles.secondary}`} onClick={exportReport}>
          Export Laporan
        </button>
      </div>

      {loading && <div className={styles.loadingBar}>Memperbarui data dashboard...</div>}
      {error && (
        <div className={styles.error}>
          <span>{error}</span>
          <button className={styles.btn} onClick={() => setError("")}>×</button>
        </div>
      )}

      <div className={`${styles.cards} ${styles.six}`}>
        <Metric value={dashboard?.total_projects ?? 0} label="Usulan Proyek" />
        <Metric value={selectedProjects} label="Proyek Terpilih" />
        <Metric value={dashboard?.total_peserta ?? 0} label="Peserta" />
        <Metric value={dashboard?.total_articles ?? 0} label="Artikel Masuk" />
        <Metric value={report?.articles_waiting_assignment ?? 0} label="Belum Di-assign" />
        <Metric value={report?.articles_in_review ?? 0} label="Sedang Direview" />
      </div>

      <div className={styles.grid2}>
        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>Progress Tahapan PILAR</h3>
          <Progress label="Inventarisasi Hasil Proyek" value={projects.length ? 100 : 0} />
          <Progress label="Seleksi Hasil Proyek" value={selectedProgress} />
          <Progress label="Review Internal" value={reviewProgress} />
          <Progress label="Finalisasi Artikel" value={finalProgress} />
        </section>

        <section className={styles.panel}>
          <h3 className={styles.panelTitle}>Perlu Perhatian</h3>
          <div className={styles.alert}>
            <strong>{report?.articles_waiting_assignment ?? 0} artikel</strong> belum memiliki reviewer.
          </div>
          <div className={styles.alert}>
            <strong>{report?.articles_in_revision ?? 0} artikel</strong> sedang dalam revisi.
          </div>
          <a className={`${styles.btn} ${styles.primary}`} href="/admin/assignment-reviewer">
            Kelola Assignment
          </a>
        </section>
      </div>

      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>Aktivitas Terbaru</h3>
        <div className={styles.activity}>
          {recentActivities.map((activity: any) => (
            <div className={styles.activityItem} key={activity.id}>
              <strong>{auditActionLabel(activity.action)}</strong>
              {activity.description ? ` — ${activity.description}` : ""}
              <small>
                {formatDateTime(activity.created_at)}
                {/* {activity.created_at
                  ? new Date(activity.created_at).toLocaleString("id-ID")
                  : ""} */}
              </small>
            </div>
          ))}

          {!recentActivities.length && (
            <div className={styles.empty}>Belum ada aktivitas tercatat.</div>
          )}
        </div>
      </section>

    </>
  );
}
