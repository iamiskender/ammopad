import { NextResponse } from "next/server";
import { getLaunch, getLaunches } from "@/lib/launches";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  try {
    if (address) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
      const launch = await getLaunch(address);
      return launch ? NextResponse.json(launch) : NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ launches: await getLaunches() });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not load launches from GIWA right now." }, { status: 502 });
  }
}
