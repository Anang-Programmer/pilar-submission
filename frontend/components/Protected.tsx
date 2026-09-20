"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError } from "../lib/api";
import { supabase } from "../lib/supabase";

interface UserContextType {
  user: any;
  role: string;
}

export const AuthContext = createContext<UserContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within Protected");
  return context;
};

export default function Protected({
  children,
  requiredRole,
}: {
  children: ReactNode;
  requiredRole?: "admin" | "reviewer" | "peserta";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [role, setRole] = useState("peserta");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!active) return;

      if (!sessionData.session) {
        router.replace(
          `/login?next=${encodeURIComponent(pathname)}`,
        );
        return;
      }

      try {
        const me = await api.getMe();
        if (!active) return;

        const roles = Array.isArray(me.roles)
          ? me.roles
          : me.role
            ? [me.role]
            : [];
        const normalized = roles.map((x: string) => x.toLowerCase());
        const primary = normalized.includes("admin")
          ? "admin"
          : normalized.includes("reviewer")
            ? "reviewer"
            : "peserta";

        if (requiredRole && primary !== requiredRole) {
          router.replace(primary === "admin" ? "/admin" : "/dashboard");
          return;
        }

        setUser(me);
        setRole(primary);
        setLoading(false);
      } catch (error) {
        console.error("Auth error:", error);

        const status = error instanceof ApiError ? error.status : 0;
        if (status === 401 || status === 403) {
          await supabase.auth.signOut().catch(() => undefined);
          if (active) {
            router.replace(
              `/login?next=${encodeURIComponent(pathname)}`,
            );
          }
          return;
        }

        // Backend/upstream error: keep the Auth session.
        if (active) setLoading(false);
      }
    }

    load();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT" || !session) {
        router.replace(
          `/login?next=${encodeURIComponent(pathname)}`,
        );
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [pathname, requiredRole, router]);

  if (loading) {
    return <div className="pilar-loading">Memuat sesi...</div>;
  }

  return (
    <AuthContext.Provider value={{ user, role }}>
      {children}
    </AuthContext.Provider>
  );
}
