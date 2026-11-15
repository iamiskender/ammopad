import { formatUnits } from "viem";

export const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

/** Human number with up to `max` significant decimals, no scientific notation. */
export const fmt = (value: bigint | string, decimals: number, max = 6): string => {
  const raw = formatUnits(typeof value === "string" ? BigInt(value) : value, decimals);
  const [whole, fraction = ""] = raw.split(".");
  const wholeFormatted = BigInt(whole!).toLocaleString("en-US");
  if (!fraction || /^0+$/.test(fraction)) return wholeFormatted;
  if (whole !== "0") return `${wholeFormatted}.${fraction.slice(0, 4).replace(/0+$/, "")}`.replace(/\.$/, "");
  const firstNonZero = fraction.search(/[1-9]/);
  return `0.${fraction.slice(0, Math.min(fraction.length, firstNonZero + max)).replace(/0+$/, "")}`;
};

export const timeAgo = (iso: string | null): string => {
  if (!iso) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export const statusLabel = (status: number) =>
  status === 1 ? { text: "Live", cls: "badge-live" }
    : status === 2 ? { text: "Ready to graduate", cls: "badge-ready" }
      : status === 3 ? { text: "Graduated", cls: "badge-grad" }
        : { text: "Pending", cls: "badge-ready" };

/** Deterministic gradient avatar for tokens without an image. */
export const avatarStyle = (seed: string) => {
  let hash = 0;
  for (const char of seed.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return { background: `linear-gradient(135deg, hsl(${hue} 80% 55%), hsl(${(hue + 50) % 360} 80% 45%))` };
};
