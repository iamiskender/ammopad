"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";
import type { LaunchRow } from "@/lib/launches";
import { useWallet } from "@/lib/wallet";
import { WETH, txUrl } from "@/lib/chain";
import { fmt } from "@/lib/format";
import { graduate, preparePoolSwap, quoteCurve, readBalances, swapOnCurve, unwrapWeth, wrapEth } from "@/lib/ammora";

type Side = "buy" | "sell";
type Notice = { kind: "info" | "error" | "ok"; text: string; hash?: string };

const errorText = (error: unknown): string => {
  const value = error as { shortMessage?: string; message?: string };
  const text = value?.shortMessage ?? value?.message ?? String(error);
  if (/User rejected|denied/i.test(text)) return "Transaction rejected in wallet.";
  return text.split("\n")[0]!.slice(0, 300);
};

export function TradePanel({ launch, onTraded }: { launch: LaunchRow; onTraded?: () => void }) {
  const { account, wrongChain, connect, switchChain, walletClient } = useWallet();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("1");
  const [balances, setBalances] = useState<{ eth: bigint; weth: bigint; token: bigint } | null>(null);
  const [preview, setPreview] = useState<{ out: bigint; min: bigint; note?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const onCurve = launch.status === 1;
  const readyToGraduate = launch.status === 2;
  const onPool = launch.status === 3 && launch.canonicalPool !== null;
  const inDecimals = side === "buy" ? 18 : launch.decimals;
  const outDecimals = side === "buy" ? launch.decimals : 18;
  const inSymbol = side === "buy" ? "ETH" : launch.symbol;
  const outSymbol = side === "buy" ? launch.symbol : "WETH";
  const slippageBps = Math.round(Math.min(Math.max(Number(slippage) || 0, 0.1), 10) * 100);

  const amountIn = useMemo(() => {
    try {
      if (!amount || Number(amount) <= 0) return 0n;
      return parseUnits(amount, inDecimals);
    } catch {
      return 0n;
    }
  }, [amount, inDecimals]);

  const refreshBalances = useCallback(async () => {
    if (!account) return setBalances(null);
    setBalances(await readBalances(account, launch.token).catch(() => null));
  }, [account, launch.token]);

  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  // Live quote (debounced). Buys are quoted in WETH; ETH is wrapped 1:1 before the swap.
  useEffect(() => {
    setPreview(null);
    if (amountIn === 0n || (!onCurve && !onPool)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (onCurve) {
          const { quote, fill } = await quoteCurve(launch.curve, amountIn, side === "sell");
          if (cancelled) return;
          const note = fill.kind === "graduation-boundary"
            ? `This buy completes the curve. Only ${fmt(quote.amountIn, 18)} WETH is used, the rest is refunded.`
            : fill.kind === "terminal-dust" ? "The curve is at its graduation boundary." : undefined;
          setPreview({ out: quote.amountOut, min: (quote.amountOut * BigInt(10_000 - slippageBps)) / 10_000n, note });
        } else if (onPool && account) {
          const prepared = await preparePoolSwap(launch.canonicalPool!, side === "buy" ? WETH : launch.token, amountIn, account, slippageBps);
          if (cancelled) return;
          setPreview({ out: prepared.quote.expectedAmountOut, min: prepared.quote.minimumAmountOut });
        }
      } catch (error) {
        if (!cancelled) setPreview({ out: 0n, min: 0n, note: errorText(error) });
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [amountIn, side, onCurve, onPool, launch.curve, launch.canonicalPool, launch.token, account, slippageBps]);

  const status = (text: string) => setNotice({ kind: "info", text });

  const ensureWeth = async () => {
    if (side !== "buy" || !account) return;
    const current = await readBalances(account);
    if (current.weth >= amountIn) return;
    const missing = amountIn - current.weth;
    if (current.eth < missing) throw new Error("Not enough ETH. Get test ETH from the GIWA faucet.");
    await wrapEth(walletClient(), missing, status);
  };

  const execute = async () => {
    if (!account) return connect().catch((error) => setNotice({ kind: "error", text: errorText(error) }));
    if (wrongChain) return switchChain().catch((error) => setNotice({ kind: "error", text: errorText(error) }));
    if (amountIn === 0n) return setNotice({ kind: "error", text: "Enter an amount." });
    setBusy(true);
    try {
      await ensureWeth();
      let hash: string;
      if (onCurve) {
        const result = await swapOnCurve(walletClient(), launch.curve, amountIn, side === "sell", slippageBps, status);
        hash = result.hash;
        if (result.graduationFill) setNotice({ kind: "ok", text: "Curve completed. Graduate it to open pool trading.", hash });
      } else if (onPool) {
        const prepared = await preparePoolSwap(launch.canonicalPool!, side === "buy" ? WETH : launch.token, amountIn, account, slippageBps);
        status("Confirm the approval and swap in your wallet");
        const labels: Record<string, string> = {
          "quote-refreshed": "Quote refreshed",
          "approval-requested": "Confirm the exact approval in your wallet",
          "approval-submitted": "Approval sent, waiting for confirmation",
          "approval-confirmed": "Approval confirmed",
          "swap-requested": "Confirm the swap in your wallet",
          "swap-submitted": "Swap sent, waiting for confirmation",
          "swap-confirmed": "Swap confirmed",
        };
        const result = await prepared.execute(walletClient(), { autoRefresh: true, exactApproval: true, onStatus: (s) => status(labels[s.type] ?? "Working...") });
        hash = result.hash;
      } else {
        throw new Error("Trading is not open for this token yet.");
      }
      setNotice((current) => current?.kind === "ok" ? current : { kind: "ok", text: side === "buy" ? "Bought successfully." : "Sold successfully.", hash });
      setAmount("");
      await refreshBalances();
      onTraded?.();
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const runGraduate = async () => {
    if (!account) return connect();
    setBusy(true);
    try {
      const { hash } = await graduate(walletClient(), launch.curve, status);
      setNotice({ kind: "ok", text: "Graduated. The token now trades on its concentrated liquidity pool.", hash });
      onTraded?.();
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const runUnwrap = async () => {
    if (!balances || balances.weth === 0n) return;
    setBusy(true);
    try {
      const { hash } = await unwrapWeth(walletClient(), balances.weth, status);
      setNotice({ kind: "ok", text: "WETH unwrapped to ETH.", hash });
      await refreshBalances();
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const setFraction = (fraction: number) => {
    if (!balances) return;
    const source = side === "buy" ? balances.eth + balances.weth : balances.token;
    const reserve = side === "buy" ? parseUnits("0.0002", 18) : 0n; // keep a little ETH for gas
    const usable = source > reserve ? source - reserve : 0n;
    const value = (usable * BigInt(Math.round(fraction * 100))) / 100n;
    const text = (Number(value) / 10 ** inDecimals).toFixed(Math.min(inDecimals, 8)).replace(/\.?0+$/, "");
    setAmount(text === "" ? "0" : text);
  };

  if (readyToGraduate) {
    return (
      <div className="panel">
        <h3>Ready to graduate</h3>
        <p className="muted" style={{ marginTop: 0 }}>The bonding curve is complete. Anyone can move it into its concentrated liquidity pool. After that, trading continues on the pool.</p>
        <button className="btn btn-primary btn-block" disabled={busy} onClick={runGraduate}>{busy ? "Working..." : "Graduate to pool"}</button>
        {notice && <NoticeBox notice={notice} />}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="row-between" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Trade ${launch.symbol}</h3>
        <span className="badge badge-live">{onCurve ? "Bonding curve" : onPool ? "ARL pool" : "Closed"}</span>
      </div>
      <div className="trade-tabs">
        <button className={`buy ${side === "buy" ? "active" : ""}`} onClick={() => { setSide("buy"); setAmount(""); }}>Buy</button>
        <button className={`sell ${side === "sell" ? "active" : ""}`} onClick={() => { setSide("sell"); setAmount(""); }}>Sell</button>
      </div>
      <div className="field">
        <div className="row-between">
          <label>You pay ({inSymbol})</label>
          {balances && (
            <span className="hint">
              Balance: {side === "buy" ? `${fmt(balances.eth, 18)} ETH + ${fmt(balances.weth, 18)} WETH` : `${fmt(balances.token, launch.decimals)} ${launch.symbol}`}
            </span>
          )}
        </div>
        <input className="input" inputMode="decimal" placeholder="0.0" value={amount} onChange={(event) => setAmount(event.target.value.replace(",", "."))} />
        <div className="quick">
          {side === "buy"
            ? ["0.001", "0.005", "0.01"].map((value) => <button key={value} className="btn btn-sm" onClick={() => setAmount(value)}>{value} ETH</button>)
            : [0.25, 0.5, 1].map((value) => <button key={value} className="btn btn-sm" onClick={() => setFraction(value)}>{value === 1 ? "Max" : `${value * 100}%`}</button>)}
        </div>
      </div>
      <div className="field">
        <label>You receive (estimated)</label>
        <div className="input mono">{preview ? `${fmt(preview.out, outDecimals)} ${outSymbol}` : "..."}</div>
        {preview && preview.out > 0n && <span className="hint">Minimum after {slippage}% slippage: {fmt(preview.min, outDecimals)} {outSymbol}</span>}
        {preview?.note && <span className="hint">{preview.note}</span>}
      </div>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <span className="hint">Slippage tolerance (%)</span>
        <input className="input" style={{ width: 90, padding: "6px 10px" }} value={slippage} onChange={(event) => setSlippage(event.target.value)} />
      </div>
      <button className={`btn btn-block ${side === "buy" ? "btn-green" : "btn-red"}`} disabled={busy || (!onCurve && !onPool)} onClick={execute}>
        {!account ? "Connect wallet" : wrongChain ? "Switch to GIWA" : busy ? "Working..." : side === "buy" ? `Buy ${launch.symbol}` : `Sell ${launch.symbol}`}
      </button>
      {side === "buy" && <p className="hint" style={{ marginBottom: 0 }}>ETH is wrapped to WETH automatically. Approvals are always for the exact amount.</p>}
      {balances && balances.weth > 0n && (
        <div className="row-between" style={{ marginTop: 12 }}>
          <span className="hint">You hold {fmt(balances.weth, 18)} WETH</span>
          <button className="btn btn-sm" disabled={busy} onClick={runUnwrap}>Unwrap to ETH</button>
        </div>
      )}
      {notice && <NoticeBox notice={notice} />}
    </div>
  );
}

export function NoticeBox({ notice }: { notice: Notice }) {
  return (
    <div className={`status ${notice.kind === "error" ? "error" : notice.kind === "ok" ? "ok" : ""}`}>
      {notice.text}{" "}
      {notice.hash && <a className="link" href={txUrl(notice.hash)} target="_blank" rel="noreferrer">View transaction</a>}
    </div>
  );
}

export type { Notice };
export const formatError = errorText;
