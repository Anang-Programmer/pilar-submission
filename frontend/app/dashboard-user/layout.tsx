"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Protected, { useAuth } from "../../components/Protected";
import { supabase } from "../../lib/supabase";
import { Icon, type IconName } from "../../components/Icon";
import styles from "../admin/admin.module.css";

const menu: ReadonlyArray<readonly [string, string, IconName]> = [
  ["/dashboard-user", "Dashboard Monitoring", "dashboard"],
  ["/dashboard-user/reviewer", "Reviewer", "review"],
  ["/dashboard-user/mata-kuliah", "Mata Kuliah", "articles"],
  ["/dashboard-user/jurnal", "Jurnal", "articles"],
  ["/dashboard-user/proyek", "Proyek", "project"],
  ["/dashboard-user/artikel", "Artikel", "articles"],
  ["/dashboard-user/monitoring-review", "Monitoring Review", "history"],
  ["/dashboard-user/reviewer-history", "Reviewers History", "history"],
  ["/dashboard-user/peserta", "Peserta", "participants"],
  ["/dashboard-user/pendamping", "Pendamping", "profile"],
];

function DashboardUserShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const displayName =
    user?.student_profile?.full_name ||
    user?.lecturer_profile?.full_name ||
    user?.username ||
    user?.email ||
    "Dashboard User";

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
          Role: <strong>Dashboard Monitoring</strong> · {displayName}
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sideTitle}>Monitoring Panel</div>

          {menu.map(([href, label, icon]) => {
            const active =
              href === "/dashboard-user"
                ? pathname === href
                : pathname === href || pathname.startsWith(`${href}/`);

            return (
              <Link
                key={href}
                href={href}
                className={active ? `${styles.nav} ${styles.navActive}` : styles.nav}
              >
                <span className={styles.navIcon}>
                  <Icon name={icon} />
                </span>
                <span className={styles.navLabel}>{label}</span>
              </Link>
            );
          })}

          <button className={styles.logout} onClick={logout}>
            <span className={styles.navIcon}>
              <Icon name="logout" />
            </span>
            <span className={styles.logoutLabel}>Keluar</span>
          </button>
        </aside>

        <main className={styles.main}>
          <div className={styles.container}>{children}</div>
          <div className={styles.footer}>
            PILAR PTIK 2026 · Dashboard Monitoring (Read Only)
          </div>
        </main>
      </div>
    </div>
  );
}

export default function DashboardUserLayout({ children }: { children: React.ReactNode }) {
  return (
    <Protected requiredRole="dashboard">
      <DashboardUserShell>{children}</DashboardUserShell>
    </Protected>
  );
}
