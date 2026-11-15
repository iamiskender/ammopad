import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getCurveTrades } from "@/lib/launches";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const curve = new URL(request.url).searchParams.get("curve");
  if (!curve || !/^0x[0-9a-fA-F]{40}$/.test(curve)) return NextResponse.json({ error: "invalid curve" }, { status: 400 });
  try {
    return NextResponse.json({ trades: await getCurveTrades(getAddress(curve)) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ trades: [], error: "Trade history unavailable." }, { status: 200 });
  }
}
