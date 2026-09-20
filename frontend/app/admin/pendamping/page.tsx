"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

export default function AdminMentorshipPage() {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true); setError("");
      const [a, s] = await Promise.allSettled([api.admin.mentorshipAssignments(), api.admin.mentorshipSessions()]);
      const errors: string[] = [];
      if (a.status === "fulfilled") setAssignments(Array.isArray(a.value) ? a.value : []); else errors.push(a.reason?.message || "Pendamping gagal dimuat");
      if (s.status === "fulfilled") setSessions(Array.isArray(s.value) ? s.value : []); else errors.push(s.reason?.message || "Sesi gagal dimuat");
      setError(errors[0] || ""); setLoading(false);
    }
    load();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<number, any>();
    for (const assignment of assignments) {
      const reviewerId = Number(assignment.lecturer_id);
      const current = map.get(reviewerId) || { reviewer: assignment.reviewer, participants: new Set<number>(), articles: new Set<number>(), assignmentIds: new Set<number>() };
      current.participants.add(Number(assignment.student_id));
      current.articles.add(Number(assignment.article_id));
      current.assignmentIds.add(Number(assignment.id));
      map.set(reviewerId, current);
    }
    return Array.from(map.values()).map((row) => ({ ...row, sessionCount: sessions.filter((s: any) => row.assignmentIds.has(Number(s.assignment_id))).length }));
  }, [assignments, sessions]);

  return (
    <>
      <PageHeader title="Monitoring Pendamping" description="Distribusi peserta dan progres pendampingan Reviewer." />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        {loading ? <div className={styles.loadingBar}>Memuat pendamping...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Reviewer Pendamping</th><th>Peserta</th><th>Artikel</th><th>Sesi</th><th>Progress</th></tr></thead>
            <tbody>{grouped.map((row, index) => {
              const progress = row.articles.size ? Math.min(100, 40 + row.sessionCount * 10) : 0;
              return <tr key={row.reviewer?.id || index}><td>{row.reviewer?.full_name || "—"}</td><td>{row.participants.size}</td><td>{row.articles.size}</td><td>{row.sessionCount}</td><td>{progress}%</td></tr>;
            })}</tbody>
          </table>
        </div>
        {!grouped.length && !loading ? <Empty text="Belum ada assignment pendamping." /> : null}
      </section>
    </>
  );
}
