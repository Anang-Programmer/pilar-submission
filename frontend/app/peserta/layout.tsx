"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import styles from "./peserta.module.css";

const menu = [
  ["/peserta", "Dashboard", "▣"],
  ["/peserta/artikel", "Artikel Saya", "▤"],
  ["/peserta/upload-artikel", "Upload Artikel", "↥"],
  ["/peserta/hasil-review", "Hasil Review", "✎"],
  ["/peserta/upload-revisi", "Upload Revisi", "↻"],
  ["/peserta/riwayat", "Riwayat", "◷"],
  ["/peserta/profil", "Profil", "◎"],
] as const;

export default function PesertaLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;

      if (!data.session) {
        router.replace(`/login?next=${encodeURIComponent(pathnameRef.current)}`);
        return;
      }

      try {
        const me = await api.getMe();
        if (!active) return;
        const role = String(me?.role || me?.roles?.[0] || "").toLowerCase();
        if (role !== "peserta") {
          router.replace(role === "admin" ? "/admin" : role === "reviewer" ? "/reviewer" : "/dashboard");
          return;
        }
        setUser(me);
        setReady(true);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          await supabase.auth.signOut().catch(() => undefined);
          router.replace(`/login?next=${encodeURIComponent(pathnameRef.current)}`);
          return;
        }
        setUser({ username: data.session.user.email, email: data.session.user.email });
        setReady(true);
      }
    }

    load();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        router.replace(`/login?next=${encodeURIComponent(pathnameRef.current)}`);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [router]);



  if (!ready) return <div className={styles.loading}>Memuat Portal Peserta PILAR...</div>;

  const profileName = user?.student_profile?.full_name || user?.username || user?.email || "Peserta";

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}><div className={styles.logo}>P</div><strong>PILAR PTIK 2026</strong></div>
        <div className={styles.topUser}>Peserta: <strong>{profileName}</strong> · PTIK UNIMED</div>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sideTitle}>Menu Peserta</div>
          {menu.map(([href, label, icon]) => {
            const active = href === "/peserta" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
            return <Link key={href} href={href} className={active ? `${styles.nav} ${styles.navActive}` : styles.nav}>
              <span className={styles.navIcon}>{icon}</span><span className={styles.navLabel}>{label}</span>
            </Link>;
          })}
          <button className={styles.logout} onClick={logout}><span className={styles.navIcon}>↪</span><span className={styles.logoutLabel}>Keluar</span></button>
        </aside>
        <main className={styles.main}>
          <div className={styles.container}>{children}</div>
          <div className={styles.footer}>PILAR PTIK 2026 · Portal Peserta</div>
        </main>
      </div>
    </div>
  );
}
