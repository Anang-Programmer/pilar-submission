"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "../../../lib/api";
import { supabase } from "../../../lib/supabase";
import type { ParticipantProfile } from "../types";
import styles from "../peserta.module.css";

function mentorLabel(assignment: ParticipantProfile["participant_assignments"][number]) {
  const mentor = assignment.mentor;
  if (!mentor) return "Belum ditetapkan";

  return `${mentor.full_name}${mentor.academic_title ? `, ${mentor.academic_title}` : ""}`;
}

function PasswordSection() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");

  async function changePassword() {
    setPasswordError("");
    setPasswordMessage("");

    if (password.length < 8) {
      setPasswordError("Password baru minimal 8 karakter.");
      return;
    }

    if (password !== confirmation) {
      setPasswordError("Konfirmasi password tidak sama.");
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setPassword("");
      setConfirmation("");
      setPasswordMessage("Password berhasil diganti.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Gagal mengganti password.");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className={styles.panel}>
      <h3>Keamanan Akun</h3>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>
        Ganti password akun peserta secara berkala untuk menjaga keamanan akun.
      </p>

      {passwordError && <div className={styles.error}>{passwordError}</div>}
      {passwordMessage && <div className={styles.notice}>{passwordMessage}</div>}

      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label>Password Baru</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
            autoComplete="new-password"
          />
        </div>

        <div className={styles.field}>
          <label>Konfirmasi Password Baru</label>
          <input
            type="password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="Ulangi password baru"
            autoComplete="new-password"
          />
        </div>
      </div>

      <div className={styles.actionRow}>
        <button
          className={`${styles.btn} ${styles.primary}`}
          onClick={() => void changePassword()}
          disabled={savingPassword}
        >
          {savingPassword ? "Mengganti Password..." : "Ganti Password"}
        </button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const [data, setData] = useState<ParticipantProfile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.peserta
      .profile()
      .then((value) => {
        setData(value);
        setName(value.student.full_name);
        setPhone(value.student.phone || "");
      })
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : "Gagal memuat profil peserta."
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setError("");
    setMessage("");
    setSaving(true);

    try {
      const value = await api.peserta.updateProfile({
        full_name: name,
        phone,
      });

      setName(value.full_name || name);
      setMessage("Profil berhasil disimpan.");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Gagal menyimpan profil."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className={styles.panel}>Memuat profil peserta...</div>;
  }

  const assignments = data?.participant_assignments ?? [];

  return (
    <>
      <div className={styles.title}>
        <div>
          <h1>Profil Peserta</h1>
          <p>Informasi peserta Program PILAR PTIK 2026.</p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {message && <div className={styles.notice}>{message}</div>}

      <div className={styles.panel}>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label>Nama Lengkap</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label>NIM</label>
            <input value={data?.student.nim || ""} readOnly />
          </div>
        </div>

        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label>Email</label>
            <input value={data?.user.email || ""} readOnly />
          </div>

          <div className={styles.field}>
            <label>No. HP</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <h3 style={{ marginBottom: 8 }}>Mata Kuliah & Dosen Pendamping</h3>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
            Daftar penetapan Mata Kuliah dan Dosen Pendamping peserta.
          </p>

          {assignments.length === 0 ? (
            <div className={styles.empty}>
              Belum ada Mata Kuliah dan Dosen Pendamping yang ditetapkan.
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Mata Kuliah</th>
                    <th>Dosen Pendamping</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {assignments.map((assignment, index) => (
                    <tr key={assignment.id}>
                      <td>{index + 1}</td>
                      <td>
                        <strong>
                          {assignment.course?.name ||
                            `Mata Kuliah #${assignment.course_id}`}
                        </strong>
                        {assignment.course?.code && (
                          <div
                            style={{
                              color: "var(--muted)",
                              fontSize: 12,
                              marginTop: 3,
                            }}
                          >
                            {assignment.course.code}
                          </div>
                        )}
                      </td>
                      <td>{mentorLabel(assignment)}</td>
                      <td>
                        <span className={`${styles.badge} ${styles.done}`}>
                          {assignment.status || "active"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={styles.actionRow}>
          <button
            className={`${styles.btn} ${styles.primary}`}
            onClick={save}
            disabled={saving}
          >
            {saving ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </div>
      </div>

      <PasswordSection />
    </>
  );
}
