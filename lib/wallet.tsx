"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, getAddress, numberToHex, type Address, type EIP1193Provider, type WalletClient } from "viem";
import { EXPLORER, RPC_URL, giwaSepolia } from "./chain";

type WalletState = {
  account: Address | null;
  chainId: number | null;
  wrongChain: boolean;
  hasProvider: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  walletClient: () => WalletClient;
};

const WalletContext = createContext<WalletState | null>(null);

const provider = (): EIP1193Provider | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { ethereum?: EIP1193Provider }).ethereum;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [hasProvider, setHasProvider] = useState(false);

  useEffect(() => {
    const eth = provider();
    setHasProvider(Boolean(eth));
    if (!eth) return;
    const onAccounts = (accounts: unknown) => {
      const list = accounts as string[];
      setAccount(list[0] ? getAddress(list[0]) : null);
    };
    const onChain = (id: unknown) => setChainId(Number(id as string));
    eth.request({ method: "eth_accounts" }).then(onAccounts).catch(() => undefined);
    eth.request({ method: "eth_chainId" }).then(onChain).catch(() => undefined);
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const switchChain = useCallback(async () => {
    const eth = provider();
    if (!eth) throw new Error("No wallet found. Install MetaMask or another EVM wallet.");
    const hexId = numberToHex(giwaSepolia.id);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== 4902 && code !== -32603) throw error;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexId,
          chainName: giwaSepolia.name,
          nativeCurrency: giwaSepolia.nativeCurrency,
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER],
        }],
      });
    }
    setChainId(giwaSepolia.id);
  }, []);

  const connect = useCallback(async () => {
    const eth = provider();
    if (!eth) throw new Error("No wallet found. Install MetaMask or another EVM wallet.");
    setConnecting(true);
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0] ? getAddress(accounts[0]) : null);
      const id = Number(await eth.request({ method: "eth_chainId" }));
      setChainId(id);
      if (id !== giwaSepolia.id) await switchChain();
    } finally {
      setConnecting(false);
    }
  }, [switchChain]);

  const walletClient = useCallback((): WalletClient => {
    const eth = provider();
    if (!eth || !account) throw new Error("Connect your wallet first.");
    return createWalletClient({ account, chain: giwaSepolia, transport: custom(eth) });
  }, [account]);

  const value = useMemo<WalletState>(() => ({
    account,
    chainId,
    wrongChain: account !== null && chainId !== null && chainId !== giwaSepolia.id,
    hasProvider,
    connecting,
    connect,
    disconnect: () => setAccount(null),
    switchChain,
    walletClient,
  }), [account, chainId, hasProvider, connecting, connect, switchChain, walletClient]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export const useWallet = (): WalletState => {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
};
