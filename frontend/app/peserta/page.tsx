"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../lib/api";
import type { Article, ParticipantDashboard, TimelineStep } from "./types";
import styles from "./peserta.module.css";


function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}
function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function statusLabel(article: any): string {
  const revision = String(
    article?.latest_revision_request?.status || ""
  ).toLowerCase();

  const recommendation = String(
    article?.latest_review?.recommendation || ""
  ).toLowerCase();

  const raw = String(
    article?.status || ""
  ).toLowerCase();

  // Sudah diterima reviewer
  if (
    ["accept", "accepted", "diterima"].includes(recommendation) ||
    article?.finalized_at ||
    ["selesai", "selesai review", "finalized", "final"].includes(raw)
  ) {
    return "Selesai";
  }

  // Masih membutuhkan revisi
  if (
    ["open", "pending", "requested", "revision_required"].includes(revision) ||
    recommendation === "major revision" ||
    recommendation === "minor revision"
  ) {
    return "Revisi Diperlukan";
  }

  // Sedang dalam proses review
  if (raw.includes("review")) {
    return "Sedang Direview";
  }

  if (article?.current_version) {
    return "Artikel Dikirim";
  }

  return "Belum Dikirim";
}
function badgeClass(label: string): string {
  const value = label.toLowerCase();
  if (value.includes("selesai") || value.includes("accept") || value.includes("submitted")) return styles.done;
  if (value.includes("revisi") || value.includes("revision")) return styles.revision;
  if (value.includes("review")) return styles.review;
  return styles.pending;
}

function Step({ step }: { step: TimelineStep }) {
  const cls = step.state === "done" ? styles.stepDone : step.state === "current" ? styles.stepCurrent : "";
  return <div className={`${styles.step} ${cls}`}><div className={styles.dot}/><div><strong>{step.label}</strong><small>{step.detail}</small></div></div>;
}

export default function PesertaDashboardPage() {
  const [data, setData] = useState<ParticipantDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.peserta.dashboard().then((result) => { if (active) setData(result); }).catch((err) => {
      if (!active) return;
      setError(err instanceof ApiError ? err.message : "Gagal memuat dashboard peserta.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <div className={styles.loading}>Memuat dashboard peserta...</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (!data) return null;

  const article = data.active_article;
  const project = data.active_project;
  const mentor = article?.pendamping?.lecturer;
  const journal = article?.journal;

  return <>
    <div className={styles.title}><div><h1>Dashboard Peserta</h1><p>Monitoring proses pengembangan artikel ilmiah PILAR PTIK 2026.</p></div></div>
    <div className={styles.cards}>
      <div className={styles.card}><div className={styles.num}>{data.summary.articles_count}</div><div className={styles.lbl}>Artikel Saya</div></div>
      <div className={styles.card}><div className={styles.num}>{data.summary.reviews_count}</div><div className={styles.lbl}>Review Masuk</div></div>
      <div className={styles.card}><div className={styles.num}>{data.summary.revisions_required}</div><div className={styles.lbl}>Revisi Diperlukan</div></div>
      <div className={styles.card}><div className={styles.num}>{data.summary.progress}%</div><div className={styles.lbl}>Progress Artikel</div></div>
    </div>

    <div className={styles.panel}><h3>Status Artikel</h3>
      {article ? <>
        <div className={styles.articleHead}>
          <h2>{article.title}</h2>
          <div className={styles.meta}>Jurnal Tujuan: {journal?.abbreviation || journal?.name || "Belum dipilih"}{journal?.sinta_level ? ` — ${journal.sinta_level}` : ""}<br/>Dosen Pendamping: {mentor ? `${mentor.full_name}${mentor.academic_title ? `, ${mentor.academic_title}` : ""}` : "Belum ditetapkan"}</div>
          <div className={styles.progressHeader}><span>Progress</span><b>{article.progress}%</b></div>
          <div className={styles.progress}><div className={styles.progressFill} style={{ width: `${article.progress}%` }}/></div>
        </div>
        <div className={styles.timeline}>{data.timeline.map((step) => <Step key={step.key} step={step}/>)}</div>
      </> : <div className={styles.empty}>Belum ada artikel yang terhubung dengan akun peserta ini.</div>}
    </div>

    <div className={styles.panel}><h3>Catatan Terbaru</h3>
      {data.latest_note ? <div className={styles.notice}><b>{data.latest_note.title}.</b> {data.latest_note.message}<div className={styles.meta} style={{ marginTop: 6 }}>{formatDate(data.latest_note.created_at)}</div></div> : <div className={styles.empty}>Belum ada catatan review atau revisi terbaru.</div>}
    </div>

    {data.recent_articles.length > 0 && <div className={styles.panel}><div className={styles.title} style={{ marginBottom: 12 }}><div><h3 style={{ marginBottom: 0 }}>Artikel Terbaru</h3></div><Link href="/peserta/artikel" className={`${styles.btn} ${styles.secondary} ${styles.small}`}>Lihat Semua</Link></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Judul</th><th>Versi</th><th>Status</th><th>Update</th></tr></thead><tbody>{data.recent_articles.map((item: Article) => { const s = statusLabel(item); return <tr key={item.id}><td><b>{item.title}</b></td><td>{item.current_version_number ? `v${item.current_version_number}` : "-"}</td><td><span className={`${styles.badge} ${badgeClass(s)}`}>{s}</span></td><td>{formatDate(item.updated_at || item.created_at)}</td></tr>; })}</tbody></table></div></div>}
  </>;
}
