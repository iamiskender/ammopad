# AmmoPad: launchpad + exchange on Ammora

AmmoPad is a token launchpad and exchange on GIWA Sepolia, built with the [Ammora SDK](https://www.npmjs.com/package/@ammora-protocol/sdk) (`@ammora-protocol/sdk@0.3.9`).

## Features

- **Launch a token**: one transaction through the Ammora V4 launch factory (`buildCreateAmmoraV4Launch`). Metadata is stored inline as a `data:` URI.
- **Bonding curve trading**: buy and sell on the Ammora ALC curve with `AmmoraV4LaunchCurveClient.planSwapExactInput`. ETH is wrapped to WETH automatically and approvals use the exact amount.
- **Graduation**: a buy that completes the curve is filled partially (`classifyAmmoraV4ExactInputFill`). Anyone can then graduate the curve into its concentrated ARL pool (`planMigrate`).
- **Pool trading after graduation**: swaps go through `AmmoraSwapClient.prepareExactIn` (model `concentrated`).
- **Explore and Swap pages**: every Ammora launch on GIWA, with live status, curve progress and recent trades.
- **Launchpad Config**: `/admin` derives your own immutable Ammora Config from reviewed template #6 (`planCreateAmmoraV4Config`). Your wallet becomes owner, partner fee recipient and partner LP recipient.

## Stack

Next.js (App Router), viem, Ammora SDK. Wallet access goes through any injected EIP-1193 wallet (MetaMask, Rabby, OKX). Launch discovery reads `LaunchCreated` events from the GIWA explorer index, falls back to a bounded RPC log scan, and reads live curve state over RPC.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_LAUNCHPAD_CONFIG_ID` | Config used by the Launch page. Defaults to `6`. Set this to your own Config ID after creating one on `/admin`. |
| `NEXT_PUBLIC_RPC_URL` | Optional RPC override. Defaults to the public GIWA Sepolia RPC. |

## Network

- Chain: GIWA Sepolia (91342)
- Ammora generation: `v4-auto-route-20260917` (`giwaSepoliaAutoRouteDeployment`)
- Faucet: https://www.alchemy.com/faucets/giwa-sepolia

Testnet software. Do not use with real funds.

AmmoPad is an independent community build for the Ammora Builder mission. It is not an official Ammora product.

## License

MIT
