"use client";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import Sidebar from "../../../components/Sidebar";
import Protected from "../../../components/Protected";
export default function Review() {
  const { id } = useParams<{ id: string }>(),
    [a, setA] = useState<any>(null),
    [author, setAuthor] = useState(""),
    [editor, setEditor] = useState(""),
    [rec, setRec] = useState("Minor Revision"),
    [msg, setMsg] = useState("");
  useEffect(() => {
    api
      .article(id)
      .then(setA)
      .catch((e) => setMsg(e.message));
  }, [id]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.submitReview(id, {
        comments_for_author: author,
        comments_for_coordinator: editor,
        recommendation: rec,
      });
      setMsg("Review berhasil dikirim.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Gagal mengirim review.");
    }
  }
  return (
    <Protected>
      <Sidebar />
      <main className="ml-64 p-8">
        <div className="max-w-5xl">
          <h1 className="text-2xl font-bold">Review Article</h1>
          <div className="mt-6 rounded-2xl bg-white border p-6">
            <h2 className="text-lg font-semibold">
              {a?.title || a?.judul || "Memuat artikel..."}
            </h2>
            <p className="text-sm text-slate-500">
              {a?.author || a?.student_name || ""}
            </p>
          </div>
          <form onSubmit={submit} className="mt-6 space-y-5">
            <section className="rounded-2xl bg-white border p-6">
              <b>Comments for Author</b>
              <textarea
                className="mt-3 min-h-40 w-full rounded-lg border p-3"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                required
              />
            </section>
            <section className="rounded-2xl bg-white border p-6">
              <b>Comments for Coordinator / Editor</b>
              <textarea
                className="mt-3 min-h-32 w-full rounded-lg border p-3"
                value={editor}
                onChange={(e) => setEditor(e.target.value)}
              />
            </section>
            <section className="rounded-2xl bg-white border p-6">
              <b>Recommendation</b>
              <select
                className="mt-3 w-full rounded-lg border p-3"
                value={rec}
                onChange={(e) => setRec(e.target.value)}
              >
                <option>Accept</option>
                <option>Minor Revision</option>
                <option>Major Revision</option>
                <option>Review Ulang</option>
              </select>
            </section>
            <button className="rounded-lg bg-slate-950 px-6 py-3 font-semibold text-white">
              Submit Review
            </button>
            {msg && <p>{msg}</p>}
          </form>
        </div>
      </main>
    </Protected>
  );
}
