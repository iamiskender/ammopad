"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import type { LaunchRow, TradeRow } from "@/lib/launches";
import { TokenAvatar } from "@/components/LaunchCard";
import { TradePanel } from "@/components/TradePanel";
import { LAUNCHPAD_CONFIG_ID, addrUrl, txUrl } from "@/lib/chain";
import { fmt, shortAddress, statusLabel, timeAgo } from "@/lib/format";

export default function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [launch, setLaunch] = useState<LaunchRow | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/launches?address=${address}`);
    const body = await response.json();
    if (!response.ok) return setError(body.error === "not found" ? "This token was not launched through Ammora on GIWA." : body.error);
    setLaunch(body);
    setError(null);
    const tradeBody = await fetch(`/api/trades?curve=${body.curve}`).then((r) => r.json()).catch(() => ({ trades: [] }));
    setTrades(tradeBody.trades ?? []);
  }, [address]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) return <div className="container page"><div className="status error">{error}</div></div>;
  if (!launch) return <div className="container page"><div className="empty">Loading token...</div></div>;

  const status = statusLabel(launch.status);
  const shareText = encodeURIComponent(`I just found $${launch.symbol} on AmmoPad, a launchpad built with the @AmmoraHQ SDK on GIWA.`);
  const pageUrl = typeof window !== "undefined" ? window.location.href : "";

  return (
    <div className="container page">
      <div className="two-col">
        <div>
          <div className="panel">
            <div className="card-top">
              <TokenAvatar launch={launch} size={64} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="card-title" style={{ fontSize: 22 }}>
                  {launch.name} <span className="muted" style={{ fontWeight: 600, fontSize: 16 }}>${launch.symbol}</span>
                </div>
                <div className="row" style={{ marginTop: 4, flexWrap: "wrap" }}>
                  <span className={`badge ${status.cls}`}>{status.text}</span>
                  {launch.configId === LAUNCHPAD_CONFIG_ID.toString() && <span className="badge badge-ours">Launched on AmmoPad</span>}
                  <span className="card-sub">created {timeAgo(launch.createdAt)} by <a className="link" href={addrUrl(launch.creator)} target="_blank" rel="noreferrer">{shortAddress(launch.creator)}</a></span>
                </div>
              </div>
            </div>
            {launch.metadata?.description && <p style={{ marginBottom: 0 }}>{launch.metadata.description}</p>}
            <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
              {launch.metadata?.website && <a className="btn btn-sm" href={launch.metadata.website} target="_blank" rel="noreferrer">Website</a>}
              {launch.metadata?.x && <a className="btn btn-sm" href={launch.metadata.x} target="_blank" rel="noreferrer">X</a>}
              {launch.metadata?.telegram && <a className="btn btn-sm" href={launch.metadata.telegram} target="_blank" rel="noreferrer">Telegram</a>}
              <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(launch.token); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy token address"}</button>
              <a className="btn btn-sm" href={`https://x.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(pageUrl)}`} target="_blank" rel="noreferrer">Share on X</a>
            </div>
          </div>

          <div className="panel">
            <h3>Bonding curve progress</h3>
            <div className="progress" style={{ height: 12 }}><div style={{ width: `${launch.progressBps / 100}%` }} /></div>
            <div className="progress-row">
              <span>{launch.status === 3
                ? `Graduated. Curve target was ${fmt(launch.migrationQuoteThreshold, 18)} WETH`
                : `${fmt(launch.quoteReserve, 18)} WETH raised of ${fmt(launch.migrationQuoteThreshold, 18)} WETH`}</span>
              <span>{(launch.progressBps / 100).toFixed(2)}%</span>
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              When the curve reaches its target, anyone can graduate it. Liquidity then moves into an Ammora concentrated (ARL) pool and trading continues there.
            </p>
          </div>

          <div className="panel">
            <h3>Recent curve trades</h3>
            {trades.length === 0 ? <div className="muted">No trades yet. Be the first buyer.</div> : (
              <table className="table">
                <thead><tr><th>Type</th><th>Paid</th><th>Received</th><th>Trader</th><th>When</th></tr></thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={`${trade.txHash}-${trade.amountIn}`}>
                      <td className={trade.side === "buy" ? "buy-text" : "sell-text"}>{trade.side === "buy" ? "Buy" : "Sell"}</td>
                      <td>{trade.side === "buy" ? `${fmt(trade.amountIn, 18)} WETH` : `${fmt(trade.amountIn, launch.decimals)} ${launch.symbol}`}</td>
                      <td>{trade.side === "buy" ? `${fmt(trade.amountOut, launch.decimals)} ${launch.symbol}` : `${fmt(trade.amountOut, 18)} WETH`}</td>
                      <td className="mono"><a className="link" href={addrUrl(trade.trader)} target="_blank" rel="noreferrer">{shortAddress(trade.trader)}</a></td>
                      <td><a className="link" href={txUrl(trade.txHash)} target="_blank" rel="noreferrer">{timeAgo(trade.time) || "tx"}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <TradePanel launch={launch} onTraded={load} />
          <div className="panel">
            <h3>Contract details</h3>
            <dl className="kv">
              <dt>Token</dt><dd className="mono"><a className="link" href={addrUrl(launch.token)} target="_blank" rel="noreferrer">{shortAddress(launch.token)}</a></dd>
              <dt>Curve</dt><dd className="mono"><a className="link" href={addrUrl(launch.curve)} target="_blank" rel="noreferrer">{shortAddress(launch.curve)}</a></dd>
              {launch.canonicalPool && <><dt>ARL pool</dt><dd className="mono"><a className="link" href={addrUrl(launch.canonicalPool)} target="_blank" rel="noreferrer">{shortAddress(launch.canonicalPool)}</a></dd></>}
              <dt>Config</dt><dd>#{launch.configId}</dd>
              <dt>Curve fee</dt><dd>{(launch.feeBps / 100).toFixed(2)}%</dd>
              <dt>Decimals</dt><dd>{launch.decimals}</dd>
              <dt>Launch tx</dt><dd className="mono"><a className="link" href={txUrl(launch.txHash)} target="_blank" rel="noreferrer">{shortAddress(launch.txHash)}</a></dd>
            </dl>
          </div>
          <p className="hint"><Link className="link" href="/">Back to all tokens</Link></p>
        </div>
      </div>
    </div>
  );
}
