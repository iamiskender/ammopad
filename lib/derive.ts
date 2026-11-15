import {
  AmmoraV4MigrationMode,
  assertAmmoraV4Config,
  buildSingleSegmentCurve,
  concentratedDepositQuote,
  type AmmoraV4Config,
  type AmmoraV4ConfigSnapshot,
  type AmmoraV4Segment,
} from "@ammora-protocol/sdk";
import type { Address } from "viem";

/**
 * Derives a registry-valid Config from a reviewed template (adapted from the MIT-licensed
 * ammora-examples `deriveConfigFromTemplate`). Only supply, graduation target and recipients change.
 */
export const deriveLaunchpadConfig = (
  template: AmmoraV4ConfigSnapshot,
  saleSupply: bigint,
  migrationQuoteThreshold: bigint,
  recipient: Address,
): { config: AmmoraV4Config; curve: readonly AmmoraV4Segment[] } => {
  if (template.config.migrationMode !== AmmoraV4MigrationMode.Concentrated) throw new Error("Template must use concentrated graduation.");
  const curve = buildSingleSegmentCurve(template.config.startSqrtPrice, saleSupply, migrationQuoteThreshold);
  const segment = curve[0];
  if (!segment) throw new Error("Curve construction returned no segment.");
  const range = { sqrtPriceX64: segment.upperSqrtPrice, sqrtMinPriceX64: segment.lowerSqrtPrice, sqrtMaxPriceX64: segment.upperSqrtPrice * 2n };
  const quoteFee = (migrationQuoteThreshold * BigInt(template.config.migrationQuoteFeeBps)) / 10_000n;
  const destination = concentratedDepositQuote(range, { quoteAmount: migrationQuoteThreshold - quoteFee });
  const vesting = template.config.lockedBaseVesting;
  const lockedBase = vesting.cliffUnlockAmount + vesting.amountPerPeriod * BigInt(vesting.numberOfPeriods);
  const config: AmmoraV4Config = {
    ...template.config,
    totalSupply: saleSupply + destination.baseAmount + lockedBase,
    migrationQuoteThreshold,
    migrationBaseThreshold: destination.baseAmount,
    postMigrationSqrtMinPrice: range.sqrtMinPriceX64,
    postMigrationSqrtMaxPrice: range.sqrtMaxPriceX64,
    postMigrationLiquidity: destination.liquidity,
    partnerRecipient: recipient,
    leftoverReceiver: recipient,
    liquidityDistribution: { ...template.config.liquidityDistribution, partner: recipient },
  };
  assertAmmoraV4Config(config, curve);
  return { config, curve };
};
