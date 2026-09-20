"use client";

import type { ReactNode } from "react";
import styles from "../../app/admin/admin.module.css";

export function cn(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.titleRow}>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Metric({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className={styles.card}>
      <div className={styles.num}>{value}</div>
      <div className={styles.label}>{label}</div>
    </div>
  );
}

export function Progress({ label, value }: { label: string; value: number }) {
  const safe = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <span>{label}</span>
        <strong>{safe}%</strong>
      </div>
      <div className={styles.progressBar}>
        <i style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

export function Badge({ value }: { value: string | null | undefined }) {
  const v = String(value || "—");
  const lower = v.toLowerCase();
  const variant = lower.includes("final") || lower.includes("terpilih") || lower.includes("selesai") || lower.includes("aktif")
    ? styles.done
    : lower.includes("revisi")
      ? styles.revision
      : lower.includes("review") || lower.includes("assign")
        ? styles.review
        : lower.includes("tolak") || lower.includes("nonaktif")
          ? styles.reject
          : styles.pending;

  return <span className={cn(styles.badge, variant)}>{v}</span>;
}

export function Empty({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>;
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div className={styles.error}>
      <span>{message}</span>
      {onClose ? <button className={styles.iconButton} onClick={onClose}>×</button> : null}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {hint ? <small className={styles.fieldHint}>{hint}</small> : null}
    </label>
  );
}

export function Modal({ title, description, children, onClose }: { title: string; description?: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className={styles.modalBackdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
