"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import styles from "./reviewer.module.css";

const menu = [
  ["/reviewer", "Dashboard", "▣"],
  ["/reviewer/artikel", "Artikel Saya", "▤"],
  ["/reviewer/review", "Form Review", "✎"],
  ["/reviewer/riwayat", "Riwayat Review", "◷"],
  ["/reviewer/profil", "Profil", "◎"],
] as const;

export default function ReviewerLayout({ children }: { children: React.ReactNode }) {
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
        if (role !== "reviewer") {
          router.replace(role === "admin" ? "/admin" : "/dashboard");
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

        // Jangan logout hanya karena backend/Supabase sedang transient error.
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

  useEffect(() => {
    if (!ready) return;

    const prefetchTargets: Record<string, string[]> = {
      "/reviewer": [
        "/api/reviewer/assignments",
        "/api/reviewer/history",
      ],
      "/reviewer/artikel": [
        "/api/reviewer/history",
      ],
      "/reviewer/riwayat": [
        "/api/reviewer/assignments",
      ],
      "/reviewer/profil": [
        "/api/reviewer/assignments",
      ],
    };

    const targets = prefetchTargets[pathname] || [
      "/api/reviewer/assignments",
    ];

    const timer = window.setTimeout(() => {
      void api.prefetch(targets);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [pathname, ready]);

  if (!ready) {
    return <div className={styles.loading}>Memuat Reviewer PILAR...</div>;
  }

  const profileName = user?.lecturer_profile?.full_name || user?.username || user?.email || "Reviewer";

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div suppressHydrationWarning className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.logo}>P</div>
          <strong>PILAR Review System</strong>
        </div>
        <div className={styles.topUser}>
          Reviewer: <strong>{profileName}</strong> · PTIK UNIMED
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sideTitle}>Menu Reviewer</div>
          {menu.map(([href, label, icon]) => {
            const active = href === "/reviewer"
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={active ? `${styles.nav} ${styles.navActive}` : styles.nav}
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
          <div className={styles.footer}>PILAR PTIK 2026 · Reviewer Article Review</div>
        </main>
      </div>
    </div>
  );
}
