"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LaunchRow } from "@/lib/launches";
import { TradePanel } from "@/components/TradePanel";
import { TokenAvatar } from "@/components/LaunchCard";
import { fmt, statusLabel } from "@/lib/format";

export default function SwapPage() {
  const [launches, setLaunches] = useState<LaunchRow[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => fetch("/api/launches").then((r) => r.json()).then((body) => {
    if (body.error) return setError(body.error);
    const tradable = (body.launches as LaunchRow[]).filter((row) => row.status === 1 || row.status === 2 || (row.status === 3 && row.canonicalPool));
    setLaunches(tradable);
    setSelected((current) => current || tradable[0]?.token || "");
  }).catch(() => setError("Could not reach the server.")), []);

  useEffect(() => { load(); }, [load]);

  const launch = useMemo(() => launches?.find((row) => row.token === selected) ?? null, [launches, selected]);

  return (
    <div className="container page">
      <div className="two-col">
        <div>
          <div className="panel">
            <h3>Swap any Ammora token on GIWA</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              AmmoPad routes each trade to the right Ammora venue: the bonding curve while a token is live, and its concentrated ARL pool after graduation.
            </p>
            {error && <div className="status error">{error}</div>}
            {!launches && !error && <div className="muted">Loading markets...</div>}
            {launches && launches.length === 0 && <div className="muted">No tradable tokens yet. <Link className="link" href="/create">Launch one.</Link></div>}
            {launches && launches.length > 0 && (
              <table className="table">
                <thead><tr><th>Token</th><th>Venue</th><th>Raised</th><th></th></tr></thead>
                <tbody>
                  {launches.map((row) => {
                    const status = statusLabel(row.status);
                    return (
                      <tr key={row.curve} style={{ cursor: "pointer", background: row.token === selected ? "var(--panel-2)" : undefined }} onClick={() => setSelected(row.token)}>
                        <td><div className="row"><TokenAvatar launch={row} size={28} /><b>{row.symbol}</b><span className="muted">{row.name}</span></div></td>
                        <td><span className={`badge ${status.cls}`}>{row.status === 3 ? "ARL pool" : status.text}</span></td>
                        <td>{row.status === 3 ? "Graduated" : `${fmt(row.quoteReserve, 18)} WETH`}</td>
                        <td><Link className="link" href={`/token/${row.token}`} onClick={(event) => event.stopPropagation()}>Details</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div>{launch ? <TradePanel key={launch.token} launch={launch} onTraded={load} /> : <div className="panel muted">Select a token to trade.</div>}</div>
      </div>
    </div>
  );
}
