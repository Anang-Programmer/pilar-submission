"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../../admin/admin.module.css";

function normalizeStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function articleProgress(status: unknown): number {
  const value = normalizeStatus(status);

  if ([
    "final",
    "finalized",
    "selesai",
    "published",
    "submitted_ke_jurnal",
    "submitted_to_journal",
  ].includes(value)) return 100;

  if (["accepted", "accept", "diterima"].includes(value)) return 80;
  if (value.includes("revision") || value.includes("revisi")) return 65;
  if (value.includes("review")) return 50;
  if (["terpilih", "selected", "select", "assigned"].includes(value)) return 35;
  if (["submitted", "submit", "artikel_masuk"].includes(value)) return 25;
  return value ? 15 : 0;
}

export default function DashboardUserMentorshipPage() {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true); setError("");
      try {
        const result = await api.admin.mentorshipAssignments();
        setAssignments(Array.isArray(result) ? result : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Pendamping gagal dimuat");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<number, any>();

    for (const assignment of assignments) {
      const reviewerId = Number(assignment.lecturer_id);
      if (!Number.isFinite(reviewerId)) continue;

      const current = map.get(reviewerId) || {
        reviewer: assignment.reviewer,
        participants: new Set<number>(),
        articles: new Map<number, string>(),
      };

      if (assignment.student_id != null) {
        current.participants.add(Number(assignment.student_id));
      }

      if (assignment.article_id != null) {
        current.articles.set(
          Number(assignment.article_id),
          String(assignment.article?.status || ""),
        );
      }

      map.set(reviewerId, current);
    }

    return Array.from(map.values()).map((row) => {
      const articleStatuses = Array.from(row.articles.values());
      const progress = articleStatuses.length
        ? Math.round(
          articleStatuses.reduce<number>(
            (sum, status) => sum + articleProgress(status as string),
            0,
          ) / articleStatuses.length,
        )
        : 0;

      return {
        ...row,
        participantCount: row.participants.size,
        articleCount: row.articles.size,
        progress,
      };
    });
  }, [assignments]);

  return (
    <>
      <PageHeader
        title="Monitoring Pendamping"
        description="Distribusi peserta dan progres artikel pendamping. Progress dihitung dari tahap artikel, bukan jumlah sesi pendampingan."
      />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        {loading ? <div className={styles.loadingBar}>Memuat pendamping...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Reviewer Pendamping</th><th>Peserta</th><th>Artikel</th><th>Progress</th></tr></thead>
            <tbody>
              {grouped.map((row, index) => (
                <tr key={row.reviewer?.id || index}>
                  <td>{row.reviewer?.full_name || "—"}</td>
                  <td>{row.participantCount}</td>
                  <td>{row.articleCount}</td>
                  <td>{row.progress}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!grouped.length && !loading ? <Empty text="Belum ada assignment pendamping." /> : null}
      </section>
    </>
  );
}
