import Link from "next/link";
import type { LaunchRow } from "@/lib/launches";
import { avatarStyle, fmt, shortAddress, statusLabel, timeAgo } from "@/lib/format";
import { safeImage } from "@/lib/metadata";

export function TokenAvatar({ launch, size = 48 }: { launch: Pick<LaunchRow, "token" | "symbol" | "metadata">; size?: number }) {
  const image = safeImage(launch.metadata?.image);
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="avatar" src={image} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  }
  return <div className="avatar" style={{ ...avatarStyle(launch.token), width: size, height: size }}>{launch.symbol.slice(0, 2).toUpperCase()}</div>;
}

export function LaunchCard({ launch, ours }: { launch: LaunchRow; ours: boolean }) {
  const status = statusLabel(launch.status);
  return (
    <Link href={`/token/${launch.token}`} className="card">
      <div className="card-top">
        <TokenAvatar launch={launch} />
        <div style={{ minWidth: 0 }}>
          <div className="card-title">
            <span>{launch.name}</span>
            <span className={`badge ${status.cls}`}>{status.text}</span>
            {ours && <span className="badge badge-ours">AmmoPad</span>}
          </div>
          <div className="card-sub">${launch.symbol} · by {shortAddress(launch.creator)} · {timeAgo(launch.createdAt)}</div>
        </div>
      </div>
      <div className="card-desc">{launch.metadata?.description || "No description provided."}</div>
      <div className="progress"><div style={{ width: `${launch.progressBps / 100}%` }} /></div>
      <div className="progress-row">
        <span>{launch.status >= 2 ? "Bonding curve complete" : `${fmt(launch.quoteReserve, 18)} / ${fmt(launch.migrationQuoteThreshold, 18)} WETH`}</span>
        <span>{(launch.progressBps / 100).toFixed(1)}%</span>
      </div>
    </Link>
  );
}
