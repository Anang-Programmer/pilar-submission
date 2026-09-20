"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import Sidebar from "../../components/Sidebar";
import Protected from "../../components/Protected";
export default function History() {
  const [a, setA] = useState<any[]>([]);
  useEffect(() => {
    api
      .history()
      .then((d) => setA(Array.isArray(d) ? d : d.items || d.reviews || []))
      .catch(console.error);
  }, []);
  return (
    <Protected>
      <Sidebar />
      <main className="ml-64 p-8">
        <h1 className="text-2xl font-bold">Review History</h1>
        <div className="mt-7 rounded-2xl bg-white border">
          {a.map((x, i) => (
            <div key={x.id || i} className="border-b p-5">
              <b>{x.article_title || x.title || "Review"}</b>
              <div className="text-sm text-slate-500">
                {x.recommendation || "-"} · {x.created_at || ""}
              </div>
            </div>
          ))}
          {!a.length && (
            <div className="p-8 text-center text-slate-500">
              Belum ada riwayat review.
            </div>
          )}
        </div>
      </main>
    </Protected>
  );
}
