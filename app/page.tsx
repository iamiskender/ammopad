"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LaunchRow } from "@/lib/launches";
import { LaunchCard } from "@/components/LaunchCard";
import { LAUNCHPAD_CONFIG_ID } from "@/lib/chain";

type Filter = "all" | "live" | "graduated" | "ammopad";

export default function ExplorePage() {
  const [launches, setLaunches] = useState<LaunchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/launches")
      .then((response) => response.json())
      .then((body) => { if (alive) { if (body.error) setError(body.error); else { setLaunches(body.launches); setError(null); } } })
      .catch(() => alive && setError("Could not reach the server."));
    load();
    const timer = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const ourConfig = LAUNCHPAD_CONFIG_ID.toString();
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (launches ?? []).filter((launch) => {
      if (filter === "live" && launch.status !== 1) return false;
      if (filter === "graduated" && launch.status < 2) return false;
      if (filter === "ammopad" && launch.configId !== ourConfig) return false;
      if (!q) return true;
      return [launch.name, launch.symbol, launch.token, launch.creator].some((field) => field.toLowerCase().includes(q));
    });
  }, [launches, filter, query, ourConfig]);

  const stats = useMemo(() => {
    const rows = launches ?? [];
    return {
      total: rows.length,
      live: rows.filter((row) => row.status === 1).length,
      graduated: rows.filter((row) => row.status === 3).length,
      ours: rows.filter((row) => row.configId === ourConfig).length,
    };
  }, [launches, ourConfig]);

  return (
    <div className="container">
      <section className="hero">
        <div>
          <h1>Launch a token in one click. <span>Trade it until it graduates.</span></h1>
          <p>
            AmmoPad is a launchpad and exchange on GIWA, powered by the Ammora SDK. Every token starts on an
            Ammora bonding curve, trades instantly, and moves into a concentrated liquidity pool once it hits its target.
          </p>
          <div className="hero-actions">
            <Link href="/create" className="btn btn-primary">Launch a token</Link>
            <Link href="/swap" className="btn">Open swap</Link>
          </div>
        </div>
        <div className="stats">
          <div className="stat"><b>{launches ? stats.total : "..."}</b><span>Tokens on Ammora</span></div>
          <div className="stat"><b>{launches ? stats.live : "..."}</b><span>Live on curve</span></div>
          <div className="stat"><b>{launches ? stats.graduated : "..."}</b><span>Graduated to pool</span></div>
          <div className="stat"><b>{launches ? stats.ours : "..."}</b><span>Launched on AmmoPad</span></div>
        </div>
      </section>

      <div className="section-head">
        <h2>Explore tokens</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <div className="tabs">
            {(["all", "live", "graduated", "ammopad"] as Filter[]).map((key) => (
              <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
                {key === "all" ? "All" : key === "live" ? "Live" : key === "graduated" ? "Graduated" : "AmmoPad"}
              </button>
            ))}
          </div>
          <input className="search" placeholder="Search name, symbol, address" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      {error && !launches && <div className="status error">{error}</div>}
      {!launches && !error && <div className="empty">Loading tokens from GIWA...</div>}
      {launches && visible.length === 0 && (
        <div className="empty">
          No tokens here yet. <Link className="link" href="/create">Launch the first one.</Link>
        </div>
      )}
      <div className="grid">
        {visible.map((launch) => <LaunchCard key={launch.curve} launch={launch} ours={launch.configId === ourConfig} />)}
      </div>
    </div>
  );
}
