"use client";

import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { useWallet } from "@/lib/wallet";
import { LAUNCHPAD_CONFIG_ID, TEMPLATE_CONFIG_ID, txUrl } from "@/lib/chain";
import { createLaunchpadConfig, readConfig } from "@/lib/ammora";
import { fmt, shortAddress } from "@/lib/format";
import { formatError } from "@/components/TradePanel";

type Snapshot = Awaited<ReturnType<typeof readConfig>>;

export default function AdminPage() {
  const { account, wrongChain, connect, switchChain, walletClient } = useWallet();
  const [current, setCurrent] = useState<Snapshot | null>(null);
  const [template, setTemplate] = useState<Snapshot | null>(null);
  const [target, setTarget] = useState("0.01");
  const [supply, setSupply] = useState("300000000");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ configId: bigint; hash: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    readConfig(LAUNCHPAD_CONFIG_ID).then(setCurrent).catch((error) => setNotice({ kind: "error", text: formatError(error) }));
    readConfig(TEMPLATE_CONFIG_ID).then(setTemplate).catch(() => undefined);
  }, []);

  const submit = async () => {
    if (!account) return connect().catch((error) => setNotice({ kind: "error", text: formatError(error) }));
    if (wrongChain) return switchChain().catch((error) => setNotice({ kind: "error", text: formatError(error) }));
    if (!template) return setNotice({ kind: "error", text: "Template Config is still loading." });
    setBusy(true);
    try {
      const threshold = parseUnits(target, 18);
      const saleSupply = parseUnits(supply, template.config.tokenDecimals);
      if (threshold <= 0n || saleSupply <= 0n) throw new Error("Target and supply must be positive.");
      const result = await createLaunchpadConfig(walletClient(), TEMPLATE_CONFIG_ID, saleSupply, threshold, (text) => setNotice({ kind: "info", text }));
      setCreated({ configId: result.configId, hash: result.hash });
      setNotice(null);
    } catch (error) {
      setNotice({ kind: "error", text: formatError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page">
      <div className="two-col">
        <div className="panel">
          <h3>Create your launchpad Config</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            An Ammora Config fixes the economics for every token launched through this launchpad: supply, bonding curve, fees and graduation.
            Creating one is permissionless. This page derives a new Config from reviewed template #{TEMPLATE_CONFIG_ID.toString()} and sets the
            connected wallet as Config owner, partner fee recipient, partner LP recipient and leftover receiver.
          </p>
          <div className="field">
            <label>Graduation target (WETH)</label>
            <input className="input" value={target} onChange={(event) => setTarget(event.target.value.replace(",", "."))} />
            <span className="hint">The amount of WETH the curve must raise before it can graduate. A small value keeps graduation reachable with faucet ETH.</span>
          </div>
          <div className="field">
            <label>Tokens sold on the curve</label>
            <input className="input" value={supply} onChange={(event) => setSupply(event.target.value.replace(/[^0-9]/g, ""))} />
            <span className="hint">Extra tokens for the graduated pool and locked allocation are added automatically, so total supply will be higher.</span>
          </div>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={submit}>
            {!account ? "Connect wallet" : wrongChain ? "Switch to GIWA" : busy ? "Creating..." : "Create launchpad Config"}
          </button>
          {notice && <div className={`status ${notice.kind === "error" ? "error" : ""}`}>{notice.text}</div>}
          {created && (
            <div className="status ok">
              Config #{created.configId.toString()} created. <a className="link" href={txUrl(created.hash)} target="_blank" rel="noreferrer">View transaction</a>
              <br />Set <span className="mono">NEXT_PUBLIC_LAUNCHPAD_CONFIG_ID={created.configId.toString()}</span> in your hosting environment and redeploy.
              New tokens from the Launch page will then use your Config and pay partner fees to your wallet.
            </div>
          )}
        </div>
        <div>
          <div className="panel">
            <h3>Active Config</h3>
            {current ? (
              <dl className="kv">
                <dt>Config ID</dt><dd>#{current.configId.toString()}</dd>
                <dt>Enabled</dt><dd>{current.enabled ? "Yes" : "No"}</dd>
                <dt>Owner</dt><dd className="mono">{shortAddress(current.identity.owner)}</dd>
                <dt>Partner recipient</dt><dd className="mono">{shortAddress(current.config.partnerRecipient)}</dd>
                <dt>Total supply</dt><dd>{fmt(current.config.totalSupply, current.config.tokenDecimals)}</dd>
                <dt>Graduation target</dt><dd>{fmt(current.config.migrationQuoteThreshold, 18)} WETH</dd>
                <dt>Creation fee</dt><dd>{fmt(current.config.poolCreationFee, 18)} ETH</dd>
                <dt>Creator share of fees</dt><dd>{(current.config.creatorShareOfNonProtocolBps / 100).toFixed(0)}% of non-protocol fees</dd>
              </dl>
            ) : <div className="muted">Reading Config...</div>}
          </div>
          <div className="panel">
            <h3>Template #{TEMPLATE_CONFIG_ID.toString()}</h3>
            {template ? (
              <dl className="kv">
                <dt>Quote token</dt><dd className="mono">{shortAddress(template.config.quoteToken)}</dd>
                <dt>Token decimals</dt><dd>{template.config.tokenDecimals}</dd>
                <dt>Graduation target</dt><dd>{fmt(template.config.migrationQuoteThreshold, 18)} WETH</dd>
                <dt>Migration mode</dt><dd>{template.config.migrationMode === 0 ? "Concentrated" : String(template.config.migrationMode)}</dd>
              </dl>
            ) : <div className="muted">Reading template...</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
