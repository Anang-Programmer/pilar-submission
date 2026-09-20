"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import Sidebar from "../../components/Sidebar";
import Protected, { useAuth } from "../../components/Protected";

function AdminDashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.admin.dashboard()
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>
      <p className="text-sm text-slate-500">Ringkasan sistem secara keseluruhan.</p>
      {error && <p className="mt-5 text-red-600">{error}</p>}
      <div className="mt-8 grid md:grid-cols-2 gap-5">
        <div className="rounded-2xl bg-white border p-6">
          <p className="text-sm text-slate-500">Total Users</p>
          <p className="mt-2 text-3xl font-bold">{data?.total_users ?? "-"}</p>
        </div>
        <div className="rounded-2xl bg-white border p-6">
          <p className="text-sm text-slate-500">Total Articles</p>
          <p className="mt-2 text-3xl font-bold">{data?.total_articles ?? "-"}</p>
        </div>
      </div>
    </div>
  );
}

function ReviewerDashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.reviewer.dashboard()
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold">Reviewer Dashboard</h1>
      <p className="text-sm text-slate-500">Ringkasan tugas bimbingan & review kamu.</p>
      {error && <p className="mt-5 text-red-600">{error}</p>}
      <div className="mt-8 grid md:grid-cols-3 gap-5">
        <div className="rounded-2xl bg-white border p-6">
          <p className="text-sm text-slate-500">Total Assigned</p>
          <p className="mt-2 text-3xl font-bold">{data?.total_assigned ?? "-"}</p>
        </div>
      </div>
    </div>
  );
}

function PesertaDashboard() {
  // Peserta just sees their articles basically, or a welcome screen
  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard Peserta</h1>
      <p className="text-sm text-slate-500">Selamat datang di panel peserta PILAR PTIK.</p>
      <div className="mt-8 p-6 bg-blue-50 text-blue-800 rounded-2xl">
        <p>Silakan navigasi ke <b>My Articles</b> di sidebar untuk melihat progres artikel kamu.</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <Protected>
      <div className="flex">
        <Sidebar />
        <main className="ml-64 p-8 w-full min-h-screen bg-slate-50">
          <DashboardRouter />
        </main>
      </div>
    </Protected>
  );
}

function DashboardRouter() {
  const { role } = useAuth();

  if (role === "admin") return <AdminDashboard />;
  if (role === "reviewer") return <ReviewerDashboard />;
  return <PesertaDashboard />;
}
