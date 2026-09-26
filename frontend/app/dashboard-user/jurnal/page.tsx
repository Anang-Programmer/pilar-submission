"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../../lib/api";
import { Badge, Empty, ErrorBanner, PageHeader } from "../../../components/admin/AdminUI";
import styles from "../../admin/admin.module.css";

export default function DashboardUserJournalsPage() {
  const [journals, setJournals] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    api.admin.journals()
      .then((data) => active && setJournals(Array.isArray(data) ? data : []))
      .catch((e) =>
        active &&
        setError(e instanceof ApiError ? e.message : "Gagal memuat jurnal")
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return journals.filter(
      (item) =>
        !q ||
        `${item.name || ""} ${item.abbreviation || ""} ${
          item.template_url || ""
        }`
          .toLowerCase()
          .includes(q)
    );
  }, [journals, search]);

  return (
    <>
      <PageHeader
        title="Monitoring Jurnal"
        description="Daftar jurnal tujuan publikasi artikel PILAR."
      />

      <ErrorBanner message={error} onClose={() => setError("")} />

      <section className={styles.panel}>
        <div className={styles.filter}>
          <input
            className={styles.input}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama/akronim jurnal..."
          />
        </div>

        {loading ? (
          <div className={styles.loadingBar}>Memuat jurnal...</div>
        ) : null}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>No</th>
                <th>Nama Jurnal</th>
                <th>SINTA</th>
                <th>Template Jurnal</th>
                <th>Website</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((item, index) => (
                <tr key={item.id}>
                  <td>{index + 1}</td>

                  <td>
                    <strong>{item.name || "—"}</strong>
                    <div
                      style={{
                        color: "#64748b",
                        fontSize: 12,
                      }}
                    >
                      {item.abbreviation || ""}
                    </div>
                  </td>

                  <td>{item.sinta_level || "—"}</td>

                  <td>
                    {item.template_url ? (
                      <a
                        className={styles.link}
                        href={item.template_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Buka Template
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td>
                    {item.website_url ? (
                      <a
                        className={styles.link}
                        href={item.website_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Buka Website
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td>
                    <Badge value={item.is_active ? "Aktif" : "Nonaktif"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!filtered.length && !loading ? (
          <Empty text="Belum ada jurnal yang sesuai." />
        ) : null}
      </section>
    </>
  );
}