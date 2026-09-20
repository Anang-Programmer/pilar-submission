"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { supabase } from "../../../lib/supabase";
import { Badge, ErrorBanner, Field, PageHeader, Panel } from "../../../components/admin/AdminUI";
import styles from "../admin.module.css";

type Me = {
  id: number;
  username: string;
  email: string;
  role?: string | null;
  roles?: string[];
  is_active: boolean;
};

export default function AdminSettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    api.getMe()
      .then((data) => setMe(data as Me))
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat akun."))
      .finally(() => setLoading(false));
  }, []);

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (newPassword.length < 8) {
      setError("Password baru minimal 8 karakter.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password tidak sama.");
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password berhasil diubah.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Pengaturan Akun"
        description="Kelola informasi akun dan keamanan login Anda."
      />

      <ErrorBanner message={error} onClose={() => setError("")} />

      {message ? <div className={styles.alert}>{message}</div> : null}

      {loading ? (
        <div className={styles.loadingBar}>Memuat informasi akun...</div>
      ) : (
        <div className={styles.grid2}>
          <Panel title="Informasi Akun">
            <div style={{ display: "grid", gap: 15 }}>
              <Field label="Username">
                <input className={styles.input} value={me?.username || "-"} readOnly />
              </Field>

              <Field label="Email">
                <input className={styles.input} value={me?.email || "-"} readOnly />
              </Field>

              <Field label="Role">
                <div style={{ paddingTop: 4 }}>
                  <Badge value={me?.role || me?.roles?.[0] || "-"} />
                </div>
              </Field>

              <Field label="Status">
                <div style={{ paddingTop: 4 }}>
                  <Badge value={me?.is_active ? "Aktif" : "Nonaktif"} />
                </div>
              </Field>
            </div>
          </Panel>

          <Panel title="Keamanan Akun">
            <form onSubmit={handlePasswordChange} style={{ display: "grid", gap: 15 }}>
              <Field
                label="Password Baru"
                hint="Gunakan minimal 8 karakter."
              >
                <input
                  className={styles.input}
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Masukkan password baru"
                  autoComplete="new-password"
                  required
                />
              </Field>

              <Field label="Konfirmasi Password Baru">
                <input
                  className={styles.input}
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Ulangi password baru"
                  autoComplete="new-password"
                  required
                />
              </Field>

              <div className={styles.actions} style={{ marginTop: 3 }}>
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.primary}`}
                  disabled={saving}
                >
                  {saving ? "Menyimpan..." : "Ganti Password"}
                </button>
              </div>
            </form>
          </Panel>
        </div>
      )}
    </>
  );
}
