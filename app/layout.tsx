import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "AmmoPad | Launch & trade tokens on GIWA with Ammora",
  description: "A token launchpad and exchange built on the Ammora SDK. Launch on a bonding curve, trade, and graduate to a concentrated liquidity pool on GIWA Sepolia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Header />
          <main>{children}</main>
          <footer className="footer">
            <div className="container row-between">
              <span>AmmoPad runs on GIWA Sepolia testnet. Test assets only. Independent community build, not an official Ammora product.</span>
              <span>
                Built with <a className="link" href="https://www.npmjs.com/package/@ammora-protocol/sdk" target="_blank" rel="noreferrer">@ammora-protocol/sdk</a>
              </span>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
