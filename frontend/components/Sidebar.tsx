"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./Protected";
import { supabase } from "../lib/supabase";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, role } = useAuth();

  const name =
    user?.student_profile?.full_name ||
    user?.lecturer_profile?.full_name ||
    user?.username ||
    "User";

  const menus: [string, string][] =
    role === "admin"
      ? [["/admin", "Admin Monitoring"]]
      : role === "reviewer"
        ? [
            ["/dashboard", "Reviewer Dashboard"],
            ["/assignments", "My Assignments"],
            ["/history", "Review History"],
          ]
        : [
            ["/dashboard", "Dashboard Peserta"],
            ["/articles", "My Articles"],
          ];

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <aside className="pilar-sidebar">
      <div className="pilar-sidebar-brand">
        <div className="pilar-logo">P</div>
        <div>
          <strong>PILAR PTIK</strong>
          <small>{role} panel</small>
        </div>
      </div>

      <div className="pilar-sidebar-user">
        <span>Masuk sebagai</span>
        <strong>{name}</strong>
      </div>

      <nav className="pilar-sidebar-nav">
        {menus.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? "active" : ""}
          >
            {label}
          </Link>
        ))}
      </nav>

      <button className="pilar-sidebar-logout" onClick={logout}>
        Keluar
      </button>
    </aside>
  );
}
