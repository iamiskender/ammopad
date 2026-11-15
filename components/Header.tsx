"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";
import { ConnectButton } from "./ConnectButton";

const links = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Launch a token" },
  { href: "/swap", label: "Swap" },
  { href: "/admin", label: "Launchpad Config" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <Logo />
          <span>AmmoPad</span>
          <small>on Ammora</small>
        </Link>
        <nav className="nav">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : ""}>
              {link.label}
            </Link>
          ))}
        </nav>
        <ConnectButton />
      </div>
    </header>
  );
}
