"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

function progressFor(status: string) {
  const s = status.toLowerCase();
  if (s.includes("final")) return 100;
  if (s.includes("revisi")) return 75;
  if (s.includes("review")) return 60;
  if (s.includes("terpilih")) return 40;
  return 20;
}

export default function AdminParticipantsPage() {
  const [participants, setParticipants] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [mentors, setMentors] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true); setError("");
      const [p, pr, a, m] = await Promise.allSettled([
        api.admin.participants(), api.admin.projects(), api.admin.articlesAdmin(), api.admin.mentorshipAssignments(),
      ]);
      const errors: string[] = [];
      if (p.status === "fulfilled") setParticipants(Array.isArray(p.value) ? p.value : []); else errors.push(p.reason?.message || "Peserta gagal dimuat");
      if (pr.status === "fulfilled") setProjects(Array.isArray(pr.value) ? pr.value : []); else errors.push(pr.reason?.message || "Proyek gagal dimuat");
      if (a.status === "fulfilled") setArticles(Array.isArray(a.value) ? a.value : []); else errors.push(a.reason?.message || "Artikel gagal dimuat");
      if (m.status === "fulfilled") setMentors(Array.isArray(m.value) ? m.value : []); else errors.push(m.reason?.message || "Pendamping gagal dimuat");
      setError(errors[0] || ""); setLoading(false);
    }
    load();
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return participants.filter((user) => {
      const student = user.student_profile || {};
      const matches = `${student.full_name || ""} ${student.nim || ""} ${user.email || ""}`.toLowerCase().includes(q);
      return !q || matches;
    }).map((user) => {
      const student = user.student_profile || {};
      const myProjects = projects.filter((p) => p.submitter?.id === student.id || p.submitted_by === student.id);
      const myArticles = articles.filter((a) => (a.authors || []).some((author: any) => author.student_id === student.id));
      const myMentors = mentors.filter((m: any) => m.student_id === student.id);
      const registrations = user.participant_assignments || [];
      const status = myArticles[0]?.status || myProjects[0]?.selection?.status || myProjects[0]?.status || "Belum Terdaftar";
      const mentor = registrations.map((a: any) => a.mentor?.full_name).filter(Boolean).join(", ") || myMentors.map((m: any) => m.reviewer?.full_name || m.lecturer?.full_name).filter(Boolean).join(", ") || "—";
      const course = registrations.map((a: any) => a.course?.name).filter(Boolean).join(", ") || myProjects.map((p: any) => p.course?.name).filter(Boolean).join(", ") || "—";
      return { user, student, articleCount: myArticles.length, mentor, course, progress: progressFor(status), status };
    });
  }, [articles, mentors, participants, projects, search]);

  return (
    <>
      <PageHeader title="Peserta PILAR" description="Monitoring peserta dan progres artikel." />
      <ErrorBanner message={error} onClose={() => setError("")} />
      <section className={styles.panel}>
        <div className={styles.filter}><input className={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama/NIM/email..." /></div>
        {loading ? <div className={styles.loadingBar}>Memuat peserta...</div> : null}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Nama</th><th>NIM</th><th>Mata Kuliah</th><th>Artikel</th><th>Pendamping</th><th>Progress</th><th>Status</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.user.id}><td>{row.student.full_name || row.user.username}</td><td>{row.student.nim || "—"}</td><td>{row.course}</td><td>{row.articleCount}</td><td>{row.mentor}</td><td>{row.progress}%</td><td><Badge value={row.status} /></td></tr>)}</tbody>
          </table>
        </div>
        {!rows.length && !loading ? <Empty text="Belum ada peserta." /> : null}
      </section>
    </>
  );
}
