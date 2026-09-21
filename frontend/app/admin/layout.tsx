"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import styles from "./admin.module.css";

const menu = [
  ["/admin", "Dashboard Monitoring", "▣"],
  ["/admin/pengguna", "Pengguna", "◎"],
  ["/admin/reviewer", "Reviewer", "♟"],
  ["/admin/mata-kuliah", "Mata Kuliah", "▦"],
  ["/admin/jurnal", "Jurnal", "▤"],
  ["/admin/proyek", "Proyek", "▤"],
  ["/admin/artikel", "Artikel", "▥"],
  ["/admin/assignment-reviewer", "Assignment Reviewer", "⚑"],
  ["/admin/monitoring-review", "Monitoring Review", "✎"],
  ["/admin/peserta", "Peserta", "◉"],
  ["/admin/pendamping", "Pendamping", "♙"],
  ["/admin/laporan", "Laporan", "▦"],
  ["/admin/pengaturan", "Pengaturan", "⚙"],
] as const;

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!active) return;

      if (!sessionData.session) {
        router.replace(
          `/login?next=${encodeURIComponent(pathnameRef.current)}`,
        );
        return;
      }

      try {
        const me = await api.getMe();
        if (!active) return;

        const role = String(
          me?.role || me?.roles?.[0] || "",
        ).toLowerCase();

        if (role !== "admin") {
          router.replace("/dashboard");
          return;
        }

        setUser(me);
        setReady(true);
      } catch (error) {
        if (!active) return;

        const status = error instanceof ApiError ? error.status : 0;
        console.error("Admin auth check failed:", error);

        // Authentication/authorization failure = really end the session.
        if (status === 401 || status === 403) {
          await supabase.auth.signOut().catch(() => undefined);
          router.replace(
            `/login?next=${encodeURIComponent(pathnameRef.current)}`,
          );
          return;
        }

        // 500/502/503/504 is a backend/upstream problem, NOT a logout.
        // Keep the persisted Supabase session alive.
        setUser({
          username:
            sessionData.session.user.user_metadata?.username ||
            sessionData.session.user.email ||
            "Admin",
          email: sessionData.session.user.email,
        });
        setReady(true);
      }
    }

    load();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT" || !session) {
        router.replace(
          `/login?next=${encodeURIComponent(pathnameRef.current)}`,
        );
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // Intentionally run only once for the mounted Admin layout.
    // Navigating /admin/* must not re-run auth and sign out the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!ready) return;

    const timer = window.setTimeout(() => {
      void api.prefetch([
        "/api/admin/users",
        "/api/admin/reviewers",
        "/api/admin/participants",
        "/api/admin/courses",
        "/api/admin/journals",
        "/api/admin/projects",
        "/api/admin/articles",
        "/api/admin/reviewer-assignments",
        "/api/admin/reviews",
        "/api/admin/mentorship-assignments",
        "/api/admin/reports/summary",
      ]);
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [ready]);

  if (!ready) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "#64748b",
        }}
      >
        Memuat Admin PILAR...
      </div>
    );
  }

  const displayName = user?.username || user?.email || "Admin";

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className={styles.adminShell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.logo}>P</div>
          <strong>PILAR PTIK 2026</strong>
        </div>
        <div className={styles.topUser}>
          Role: <strong>Admin / Koordinator PILAR</strong> · {displayName}
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sideTitle}>Admin Panel</div>

          {menu.map(([href, label, icon]) => {
            const active =
              href === "/admin"
                ? pathname === href
                : pathname === href || pathname.startsWith(`${href}/`);

            return (
              <Link
                key={href}
                href={href}
                className={
                  active
                    ? `${styles.nav} ${styles.navActive}`
                    : styles.nav
                }
              >
                <span className={styles.navIcon}>{icon}</span>
                <span className={styles.navLabel}>{label}</span>
              </Link>
            );
          })}

          <button className={styles.logout} onClick={logout}>
            <span className={styles.navIcon}>↪</span>
            <span className={styles.logoutLabel}>Keluar</span>
          </button>
        </aside>

        <main className={styles.main}>
          <div className={styles.container}>{children}</div>
          <div className={styles.footer}>
            PILAR PTIK 2026 · Admin Monitoring & Review Management
          </div>
        </main>
      </div>
    </div>
  );
}
