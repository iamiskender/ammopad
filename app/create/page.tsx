"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { LAUNCHPAD_CONFIG_ID, txUrl } from "@/lib/chain";
import { createLaunch, readConfig } from "@/lib/ammora";
import { buildMetadataUri, safeImage } from "@/lib/metadata";
import { avatarStyle, fmt } from "@/lib/format";
import { formatError } from "@/components/TradePanel";

type ConfigInfo = { enabled: boolean; fee: bigint; threshold: bigint; decimals: number; supply: bigint };

export default function CreatePage() {
  const router = useRouter();
  const { account, wrongChain, connect, switchChain, walletClient } = useWallet();
  const [form, setForm] = useState({ name: "", symbol: "", description: "", image: "", website: "", x: "", telegram: "" });
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "info" | "error" | "ok"; text: string; hash?: string } | null>(null);

  useEffect(() => {
    readConfig(LAUNCHPAD_CONFIG_ID)
      .then((snapshot) => setConfig({
        enabled: snapshot.enabled,
        fee: snapshot.config.poolCreationFee,
        threshold: snapshot.config.migrationQuoteThreshold,
        decimals: snapshot.config.tokenDecimals,
        supply: snapshot.config.totalSupply,
      }))
      .catch((error) => setNotice({ kind: "error", text: `Could not read launchpad Config: ${formatError(error)}` }));
  }, []);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: key === "symbol" ? event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") : event.target.value }));

  const valid = form.name.trim().length >= 2 && form.name.trim().length <= 32 && form.symbol.length >= 2 && form.symbol.length <= 10;

  const submit = async () => {
    if (!account) return connect().catch((error) => setNotice({ kind: "error", text: formatError(error) }));
    if (wrongChain) return switchChain().catch((error) => setNotice({ kind: "error", text: formatError(error) }));
    if (!valid) return setNotice({ kind: "error", text: "Name needs 2 to 32 characters and symbol 2 to 10 letters or numbers." });
    setBusy(true);
    try {
      const metadataURI = buildMetadataUri({
        name: form.name.trim(),
        symbol: form.symbol,
        description: form.description,
        image: safeImage(form.image) ?? "",
        website: form.website,
        x: form.x,
        telegram: form.telegram,
        launchedBy: "AmmoPad (Ammora SDK)",
      });
      const result = await createLaunch(walletClient(), LAUNCHPAD_CONFIG_ID, { name: form.name.trim(), symbol: form.symbol, metadataURI }, (text) => setNotice({ kind: "info", text }));
      setNotice({ kind: "ok", text: `${form.symbol} is live on its bonding curve. Opening the token page...`, hash: result.hash });
      setTimeout(() => router.push(`/token/${result.token}`), 2500);
    } catch (error) {
      setNotice({ kind: "error", text: formatError(error) });
    } finally {
      setBusy(false);
    }
  };

  const image = safeImage(form.image);

  return (
    <div className="container page">
      <div className="two-col">
        <div className="panel">
          <h3>Launch a new token</h3>
          <div className="field"><label>Token name</label><input className="input" maxLength={32} placeholder="Tulip Coin" value={form.name} onChange={update("name")} /></div>
          <div className="field"><label>Symbol</label><input className="input" maxLength={10} placeholder="TULIP" value={form.symbol} onChange={update("symbol")} /></div>
          <div className="field"><label>Description</label><textarea className="textarea" maxLength={280} placeholder="What is this token about?" value={form.description} onChange={update("description")} /></div>
          <div className="field"><label>Image URL (https)</label><input className="input" placeholder="https://..." value={form.image} onChange={update("image")} /></div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}><label>Website</label><input className="input" placeholder="https://" value={form.website} onChange={update("website")} /></div>
            <div className="field" style={{ flex: 1 }}><label>X</label><input className="input" placeholder="https://x.com/..." value={form.x} onChange={update("x")} /></div>
          </div>
          <div className="field"><label>Telegram</label><input className="input" placeholder="https://t.me/..." value={form.telegram} onChange={update("telegram")} /></div>
          <button className="btn btn-primary btn-block" disabled={busy || (config !== null && !config.enabled)} onClick={submit}>
            {!account ? "Connect wallet" : wrongChain ? "Switch to GIWA" : busy ? "Launching..." : "Launch token"}
          </button>
          {notice && (
            <div className={`status ${notice.kind === "error" ? "error" : notice.kind === "ok" ? "ok" : ""}`}>
              {notice.text} {notice.hash && <a className="link" href={txUrl(notice.hash)} target="_blank" rel="noreferrer">View transaction</a>}
            </div>
          )}
        </div>

        <div>
          <div className="panel">
            <h3>Preview</h3>
            <div className="card-top">
              {image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className="avatar" src={image} alt="" />
                : <div className="avatar" style={avatarStyle(form.symbol || "ammopad")}>{(form.symbol || "AP").slice(0, 2)}</div>}
              <div>
                <div className="card-title">{form.name || "Token name"}</div>
                <div className="card-sub">${form.symbol || "SYMBOL"}</div>
              </div>
            </div>
            <p className="card-desc">{form.description || "Your description appears here."}</p>
          </div>
          <div className="panel">
            <h3>Launch terms</h3>
            {config ? (
              <dl className="kv">
                <dt>Launchpad Config</dt><dd>#{LAUNCHPAD_CONFIG_ID.toString()}</dd>
                <dt>Total supply</dt><dd>{fmt(config.supply, config.decimals)}</dd>
                <dt>Graduation target</dt><dd>{fmt(config.threshold, 18)} WETH</dd>
                <dt>Creation fee</dt><dd>{config.fee === 0n ? "Free (gas only)" : `${fmt(config.fee, 18)} ETH`}</dd>
              </dl>
            ) : <div className="muted">Reading Config from GIWA...</div>}
          </div>
          <div className="panel">
            <h3>How it works</h3>
            <ol className="steps">
              <li>Your token is minted by the Ammora launch factory with a fixed supply.</li>
              <li>It trades right away on an Ammora bonding curve, paired with WETH.</li>
              <li>At the graduation target, liquidity moves into an Ammora concentrated pool.</li>
            </ol>
            <p className="hint" style={{ marginBottom: 0 }}>Need test ETH? Use the <a className="link" href="https://www.alchemy.com/faucets/giwa-sepolia" target="_blank" rel="noreferrer">GIWA Sepolia faucet</a>. <Link className="link" href="/">Browse tokens</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
}
