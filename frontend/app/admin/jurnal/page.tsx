"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

type JournalForm = {
  name: string;
  sinta_level: string;
  website_url: string;
  template_url: string;
  is_active: boolean;
};

const emptyForm: JournalForm = {
  name: "",
  sinta_level: "",
  website_url: "",
  template_url: "",
  is_active: true,
};

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export default function AdminJurnalPage() {
  const [journals, setJournals] = useState<any[]>([]);
  const [form, setForm] = useState<JournalForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.admin.journals();
      setJournals(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat daftar jurnal.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function edit(item: any) {
    setEditingId(Number(item.id));
    setForm({
      name: item.name || "",
      sinta_level: item.sinta_level || "",
      website_url: item.website_url || "",
      template_url: item.template_url || "",
      is_active: item.is_active !== false,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = {
        name: form.name.trim(),
        abbreviation: null,
        sinta_level: form.sinta_level.trim() || null,
        field: null,
        website_url: normalizeUrl(form.website_url),
        submission_url: null,
        template_url: normalizeUrl(form.template_url),
        apc_info: null,
        is_active: form.is_active,
      };

      if (editingId) {
        await api.admin.updateJournal(editingId, payload);
      } else {
        await api.admin.createJournal(payload);
      }

      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan jurnal.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: any) {
    if (!window.confirm(`Hapus jurnal "${item.name}"?`)) return;

    try {
      await api.admin.deleteJournal(Number(item.id));
      if (editingId === Number(item.id)) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menghapus jurnal.");
    }
  }

  return (
    <>
      <PageHeader
        title="Jurnal"
        description="Kelola jurnal tujuan yang dapat dipilih sendiri oleh peserta untuk setiap artikel."
      />

      <ErrorBanner message={error} onClose={() => setError("")} />

      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          {editingId ? "Edit Jurnal" : "Tambah Jurnal"}
        </div>

        <form className={styles.form} onSubmit={submit}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Nama Jurnal</span>
              <input
                className={styles.input}
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Contoh: Jurnal Media Informatika"
              />
            </label>

            <label className={styles.field}>
              <span>SINTA</span>
              <input
                className={styles.input}
                value={form.sinta_level}
                onChange={(e) => setForm({ ...form, sinta_level: e.target.value })}
                placeholder="Contoh: S4"
              />
            </label>

            <label className={styles.field}>
              <span>Link Website Jurnal</span>
              <input
                className={styles.input}
                value={form.website_url}
                onChange={(e) => setForm({ ...form, website_url: e.target.value })}
                placeholder="https://journal.example.ac.id"
              />
            </label>

            <label className={styles.field}>
              <span>Template Jurnal</span>
              <input
                className={styles.input}
                value={form.template_url}
                onChange={(e) => setForm({ ...form, template_url: e.target.value })}
                placeholder="https://.../TEMPLATE.zip"
              />
            </label>
          </div>

          <label
            className={styles.field}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexDirection: "row",
              marginTop: 4,
            }}
          >
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              style={{ width: 16 }}
            />
            <span>Aktif dan tampil untuk peserta</span>
          </label>

          <div className={styles.actions} style={{ justifyContent: "flex-end" }}>
            {editingId ? (
              <button
                type="button"
                className={`${styles.btn} ${styles.secondary}`}
                onClick={resetForm}
              >
                Batal
              </button>
            ) : null}

            <button
              type="submit"
              className={`${styles.btn} ${styles.primary}`}
              disabled={saving}
            >
              {saving
                ? "Menyimpan..."
                : editingId
                  ? "Simpan Perubahan"
                  : "Tambah Jurnal"}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelTitle}>Daftar Jurnal</div>

        {loading ? <div className={styles.loadingBar}>Memuat jurnal...</div> : null}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>No</th>
                <th>Nama Jurnal</th>
                <th>SINTA</th>
                <th>Link Website Jurnal</th>
                <th>Template Jurnal</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>

            <tbody>
              {journals.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td>
                  <td><strong>{item.name}</strong></td>
                  <td>{item.sinta_level || "—"}</td>
                  <td>
                    {item.website_url ? (
                      <a className={styles.link} href={item.website_url} target="_blank" rel="noreferrer">
                        Buka Website
                      </a>
                    ) : "—"}
                  </td>
                  <td>
                    {item.template_url ? (
                      <a className={styles.link} href={item.template_url} target="_blank" rel="noreferrer">
                        Buka Template
                      </a>
                    ) : "—"}
                  </td>
                  <td><Badge value={item.is_active ? "Aktif" : "Nonaktif"} /></td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className={`${styles.btn} ${styles.small} ${styles.secondary}`}
                        onClick={() => edit(item)}
                      >
                        Edit
                      </button>
                      <button
                        className={`${styles.btn} ${styles.small} ${styles.danger}`}
                        onClick={() => remove(item)}
                      >
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!journals.length && !loading ? <Empty text="Belum ada jurnal." /> : null}
      </section>
    </>
  );
}
