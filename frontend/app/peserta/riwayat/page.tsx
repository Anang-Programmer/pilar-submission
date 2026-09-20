"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "../../../lib/api";
import type { HistoryRow } from "../types";
import styles from "../peserta.module.css";

function formatDate(value?: string | null): string { if(!value)return "-"; const d=new Date(value); return Number.isNaN(d.getTime())?value:d.toLocaleDateString("id-ID",{day:"2-digit",month:"short",year:"numeric"}); }
function badgeClass(value:string):string{const v=value.toLowerCase();if(v.includes("revision")||v.includes("revisi"))return styles.revision;if(v.includes("accept")||v.includes("selesai")||v.includes("submitted"))return styles.done;if(v.includes("review"))return styles.review;return styles.pending;}

export default function HistoryPage(){const [rows,setRows]=useState<HistoryRow[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");useEffect(()=>{api.peserta.history().then(setRows).catch((err)=>setError(err instanceof ApiError?err.message:"Gagal memuat riwayat artikel.")).finally(()=>setLoading(false));},[]);return <><div className={styles.title}><div><h1>Riwayat Artikel</h1><p>Riwayat pengiriman dan proses review artikel.</p></div></div>{error&&<div className={styles.error}>{error}</div>}<div className={styles.panel}><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Versi</th><th>Tanggal</th><th>Status</th><th>Keterangan</th><th>Aksi</th></tr></thead><tbody>{loading?<tr><td colSpan={5} className={styles.empty}>Memuat riwayat...</td></tr>:rows.length===0?<tr><td colSpan={5} className={styles.empty}>Belum ada riwayat artikel.</td></tr>:rows.map((row)=><tr key={`${row.article_id}-${row.version.id}`}><td>v{row.version.version_number}</td><td>{formatDate(row.version.uploaded_at)}</td><td><span className={`${styles.badge} ${badgeClass(row.status)}`}>{row.status}</span></td><td>{row.description||row.version.submission_note||"-"}</td><td><Link href={`/peserta/artikel/${row.article_id}`} className={`${styles.btn} ${styles.secondary} ${styles.small}`}>Detail</Link></td></tr>)}</tbody></table></div></div></>;}
