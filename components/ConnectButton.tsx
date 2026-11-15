"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/format";

export function ConnectButton() {
  const { account, wrongChain, connect, switchChain, connecting, hasProvider } = useWallet();
  const [error, setError] = useState<string | null>(null);

  if (account && wrongChain) {
    return <button className="btn btn-red" onClick={() => switchChain().catch((e) => setError(String(e?.message ?? e)))}>Switch to GIWA</button>;
  }
  if (account) {
    return <span className="btn mono" title={account}>{shortAddress(account)}</span>;
  }
  return (
    <button
      className="btn btn-primary"
      disabled={connecting}
      title={error ?? undefined}
      onClick={() => connect().catch((e) => setError(String(e?.shortMessage ?? e?.message ?? e)))}
    >
      {!hasProvider ? "Install a wallet" : connecting ? "Connecting..." : "Connect wallet"}
    </button>
  );
}
