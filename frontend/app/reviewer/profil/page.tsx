"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "../../../lib/api";
import { supabase } from "../../../lib/supabase";
import styles from "../reviewer.module.css";

type ReviewerProfileData = {
  reviewer?: {
    id?: number;
    user_id?: number;
    nidn?: string | null;
    nip?: string | null;
    full_name?: string | null;
    academic_title?: string | null;
    email?: string | null;
  } | null;
};

export default function ReviewerProfilePage() {
  const [data, setData] = useState<ReviewerProfileData | null>(null);
  const [account, setAccount] = useState<any>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [dashboard, me] = await Promise.all([
          api.reviewer.dashboard(),
          api.getMe(),
        ]);
        if (!active) return;
        setData(dashboard || null);
        setAccount(me || null);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Gagal memuat profil reviewer."
        );
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

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
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;

      setPassword("");
      setConfirmation("");
      setPasswordMessage("Password berhasil diganti.");
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Gagal mengganti password."
      );
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return <div className={styles.panel}>Memuat profil reviewer...</div>;
  }

  const reviewer = data?.reviewer;
  const profileName = reviewer?.full_name || account?.username || "Reviewer";
  const initials = profileName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part : any ) => part[0])
    .join("")
    .toUpperCase();

  return (
    <>
      <div className={styles.titleRow}>
        <div>
          <h1>Profil</h1>
          <p>Kelola informasi akun, profil akademik, dan keamanan akun Anda.</p>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.profileHero}>
        <div className={styles.profileAvatar}>{initials || "R"}</div>
        <div className={styles.profileHeroContent}>
          <div className={styles.profileEyebrow}>REVIEWER PILAR PTIK 2026</div>
          <h2>{profileName}</h2>
          <div className={styles.profileHeroMeta}>
            <span className={styles.profileRoleBadge}>Reviewer</span>
            <span>{account?.email || reviewer?.email || "Email belum tersedia"}</span>
          </div>
        </div>
      </section>

      <section className={styles.profilePanel}>
        <div className={styles.profileSectionHead}>
          <div>
            <div className={styles.profileKicker}>AKUN</div>
            <h3>Informasi Akun</h3>
            <p>Informasi dasar yang digunakan untuk mengakses sistem.</p>
          </div>
        </div>

        <div className={styles.profileFieldGrid}>
          <div className={styles.profileField}>
            <span className={styles.profileFieldLabel}>Username</span>
            <strong>{account?.username || "-"}</strong>
          </div>
          <div className={styles.profileField}>
            <span className={styles.profileFieldLabel}>Email</span>
            <strong>{account?.email || reviewer?.email || "-"}</strong>
          </div>
          <div className={styles.profileField}>
            <span className={styles.profileFieldLabel}>Role</span>
            <strong>Reviewer</strong>
          </div>
          <div className={styles.profileField}>
            <span className={styles.profileFieldLabel}>Status</span>
            <strong className={styles.profileStatus}>● Aktif</strong>
          </div>
        </div>
      </section>

      <section className={styles.profilePanel}>
        <div className={styles.profileSectionHead}>
          <div>
            <div className={styles.profileKicker}>AKADEMIK</div>
            <h3>Profil Akademik</h3>
            <p>Data akademik reviewer yang digunakan dalam proses review.</p>
          </div>
        </div>

        <div className={styles.profileFieldGrid}>
          <div className={`${styles.profileField} ${styles.profileFieldWide}`}>
            <span className={styles.profileFieldLabel}>Nama Lengkap</span>
            <strong>{reviewer?.full_name || "-"}</strong>
          </div>
          <div className={styles.profileField}>
            <span className={styles.profileFieldLabel}>Gelar Akademik</span>
            <strong>{reviewer?.academic_title || "-"}</strong>
          </div>
          <div className={styles.profileField}>
            <span className={styles.profileFieldLabel}>NIP</span>
            <strong>{reviewer?.nip || "-"}</strong>
          </div>
          <div className={styles.profileField}>
            <span className={styles.profileFieldLabel}>NIDN</span>
            <strong>{reviewer?.nidn || "-"}</strong>
          </div>
        </div>
      </section>

      <section className={styles.securityPanel}>
        <div className={styles.securityHeader}>
          <div>
            <div className={styles.profileKicker}>KEAMANAN</div>
            <h3>Ganti Password</h3>
            <p>Gunakan password baru untuk menjaga keamanan akun reviewer.</p>
          </div>
        </div>

        {passwordError && <div className={styles.error}>{passwordError}</div>}
        {passwordMessage && <div className={styles.notice}>{passwordMessage}</div>}

        <div className={styles.passwordGrid}>
          <div className={styles.passwordField}>
            <label htmlFor="reviewerPassword">Password Baru</label>
            <div className={styles.passwordInputWrap}>
              <input
                id="reviewerPassword"
                className={styles.input}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimal 8 karakter"
                autoComplete="new-password"
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              >
                {showPassword ? "Sembunyikan" : "Lihat"}
              </button>
            </div>
          </div>

          <div className={styles.passwordField}>
            <label htmlFor="reviewerPasswordConfirm">Konfirmasi Password Baru</label>
            <div className={styles.passwordInputWrap}>
              <input
                id="reviewerPasswordConfirm"
                className={styles.input}
                type={showConfirmation ? "text" : "password"}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="Ulangi password baru"
                autoComplete="new-password"
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowConfirmation((value) => !value)}
                aria-label={showConfirmation ? "Sembunyikan konfirmasi password" : "Tampilkan konfirmasi password"}
              >
                {showConfirmation ? "Sembunyikan" : "Lihat"}
              </button>
            </div>
          </div>
        </div>

        <div className={styles.securityActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={() => void changePassword()}
            disabled={savingPassword}
          >
            {savingPassword ? "Menyimpan..." : "Ganti Password"}
          </button>
        </div>
      </section>
    </>
  );
}
