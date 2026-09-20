"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import Sidebar from "../../components/Sidebar";
import Protected from "../../components/Protected";
export default function Articles() {
  const [a, setA] = useState<any[]>([]);
  useEffect(() => {
    api
      .articles()
      .then((d) => setA(Array.isArray(d) ? d : d.items || d.articles || []))
      .catch(console.error);
  }, []);
  return (
    <Protected>
      <Sidebar />
      <main className="ml-64 p-8">
        <h1 className="text-2xl font-bold">Articles</h1>
        <div className="mt-7 overflow-hidden rounded-2xl bg-white border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="p-4">Judul</th>
                <th className="p-4">Status</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {a.map((x) => (
                <tr key={x.id} className="border-t">
                  <td className="p-4 font-medium">
                    {x.title || x.judul || "-"}
                  </td>
                  <td className="p-4">{x.status || "Pending"}</td>
                  <td className="p-4 text-right">
                    <Link href={`/reviews/${x.id}`} className="font-semibold">
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!a.length && (
            <div className="p-8 text-center text-slate-500">
              Belum ada artikel.
            </div>
          )}
        </div>
      </main>
    </Protected>
  );
}
