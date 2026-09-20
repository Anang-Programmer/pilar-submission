"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { api, ApiError } from "../../lib/api";
import styles from "./login.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

async function resolveUsername(username: string): Promise<string> {
  const response = await fetch(
    `${API_URL}/api/auth/resolve-username?username=${encodeURIComponent(username)}`,
  );

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    // Keep a generic message below if the response is not JSON.
  }

  if (!response.ok) {
    throw new Error(payload?.detail || "Username atau password salah.");
  }

  if (!payload?.email) {
    throw new Error("Username atau password salah.");
  }

  return payload.email;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function routeByRole(role: string | undefined) {
    const normalized = String(role || "").toLowerCase();
    if (normalized === "admin") router.replace("/admin");
    else if (normalized === "reviewer") router.replace(next.startsWith("/reviewer") ? next : "/reviewer");
    else if (normalized === "peserta") router.replace(next.startsWith("/peserta") ? next : "/peserta");
    else router.replace(next.startsWith("/dashboard") ? next : "/dashboard");
  }

  useEffect(() => {
    let active = true;

    async function loadExistingSession() {
      const { data } = await supabase.auth.getSession();
      if (!active || !data.session) return;

      try {
        const me = await api.getMe();
        if (active) routeByRole(me?.role);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          await supabase.auth.signOut().catch(() => undefined);
        }
      }
    }

    void loadExistingSession();
    return () => {
      active = false;
    };
  }, [next]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      setError("Masukkan username terlebih dahulu.");
      setLoading(false);
      return;
    }

    try {
      const email = await resolveUsername(normalizedUsername);
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) throw authError;

      const me = await api.getMe();
      routeByRole(me?.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal. Periksa username dan password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.brandPanel}>
          <div className={styles.brandMark}>P</div>
          <span className={styles.eyebrow}>PILAR PTIK 2026</span>
          <h1>Portal Review Artikel</h1>
          <p>
            Satu portal untuk peserta, reviewer, dan admin dalam mengelola artikel
            dari pengiriman sampai finalisasi.
          </p>
          <div className={styles.roles}>
            <span>Peserta</span>
            <span>Reviewer</span>
            <span>Admin</span>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.mobileBrand}>
            <div className={styles.mobileLogo}>P</div>
            <div>
              <strong>PILAR PTIK 2026</strong>
              <span>Review System</span>
            </div>
          </div>

          <div className={styles.heading}>
            <span>Selamat datang</span>
            <h2>Masuk ke akunmu</h2>
            <p>Gunakan username dan password yang diberikan oleh Koordinator PILAR.</p>
          </div>

          <form onSubmit={submit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="username">Username</label>
              <input
                id="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Masukkan username"
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="password">Password</label>
              <div className={styles.passwordWrap}>
                <input
                  id="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Masukkan password"
                  required
                />
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? "Sembunyikan" : "Tampilkan"}
                </button>
              </div>
            </div>

            <button className={styles.submit} type="submit" disabled={loading}>
              {loading ? "Memproses..." : "Masuk"}
            </button>

            {error && <div className={styles.error}>{error}</div>}
          </form>

          <div className={styles.footer}>
            <span>© 2026 PILAR PTIK</span>
            <span>PTIK UNIMED</span>
          </div>
        </section>
      </div>
    </main>
  );
}


export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
