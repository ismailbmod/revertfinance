import ccxt from 'ccxt';
import { fetchTopPools } from './subgraph';
import { calculateATR } from './indicators';
import { normalizeSymbol } from './bot-engine';

export interface HighYieldResult {
    symbol: string;
    chainId: number;
    poolAddress: string;
    feeTier: number;
    tvl: number;
    dailyVolume: number;
    volumeRatio: number;
    expectedDailyYield: number;
    expectedAPR: number;
    yieldTier: 'Tier 1 - Extreme' | 'Tier 2 - Very High' | 'Tier 3 - High';
    volatilityRatio?: number;
    volatilityScore?: number;
}

export async function detectHighYieldPools(chainIds: number[]): Promise<HighYieldResult[]> {
    const exchange = new ccxt.binance();
    const allCandidates: HighYieldResult[] = [];

    for (const chainId of chainIds) {
        try {
            const pools = await fetchTopPools(chainId);

            // Filter: TVL >= 5,000,000
            const candidates = pools.filter(p => parseFloat(p.totalValueLockedUSD) >= 5000000);

            for (const pool of candidates) {
                const tvl = parseFloat(pool.totalValueLockedUSD);
                const pool24hVolObj = pool.poolDayData?.[0];
                if (!pool24hVolObj) continue;

                const poolSymbol = `${pool.token0.symbol}/${pool.token1.symbol}`;
                const dailyVolume = parseFloat(pool24hVolObj.volumeUSD);
                const feeTierDecimal = parseInt(pool.feeTier) / 1000000;

                // volume_ratio = daily_volume / TVL
                const volumeRatio = dailyVolume / tvl;
                if (volumeRatio < 0.5) continue; // Filter: volume_ratio >= 0.5

                // formula: expected_daily_yield = (daily_volume × fee_tier) / TVL
                const expectedDailyYield = (dailyVolume * feeTierDecimal) / tvl;

                // Yield Tiers
                let yieldTier: HighYieldResult['yieldTier'] | null = null;
                if (expectedDailyYield >= 0.006) {
                    yieldTier = 'Tier 1 - Extreme';
                } else if (expectedDailyYield >= 0.003) {
                    yieldTier = 'Tier 2 - Very High';
                } else if (expectedDailyYield >= 0.0015) {
                    yieldTier = 'Tier 3 - High';
                }

                if (!yieldTier) continue;

                // For Tier 1 and 2, we can collect volatility info if symbol is on Binance
                // but for ranking strictly by expectedDailyYield, it's optional now
                let volatilityRatio = undefined;
                let volatilityScore = undefined;

                try {
                    const normalizedSymbol = await normalizeSymbol(exchange, poolSymbol);
                    if (normalizedSymbol) {
                        const ohlcv = await exchange.fetchOHLCV(normalizedSymbol, '1h', undefined, 100);
                        if (ohlcv.length >= 24) {
                            const closes = ohlcv.map(o => o[4] as number);
                            const highs = ohlcv.map(o => o[2] as number);
                            const lows = ohlcv.map(o => o[1] as number);
                            const currentPrice = closes[closes.length - 1];
                            const atrs = calculateATR(highs, lows, closes, 24);
                            const currentATR = atrs[atrs.length - 1];
                            volatilityRatio = currentATR / currentPrice;

                            const volP = volatilityRatio * 100;
                            volatilityScore = volP < 0.5 ? 0.6 : (volP > 2 ? 0.7 : 1.0);
                        }
                    }
                } catch (e) {
                    // Binance fetch failed, ignore but keep candidate
                }

                allCandidates.push({
                    symbol: poolSymbol,
                    chainId,
                    poolAddress: pool.id,
                    feeTier: parseInt(pool.feeTier),
                    tvl,
                    dailyVolume,
                    volumeRatio,
                    expectedDailyYield,
                    expectedAPR: expectedDailyYield * 365 * 100,
                    yieldTier,
                    volatilityRatio,
                    volatilityScore
                });
            }
        } catch (error) {
            console.error(`High Yield Scan failed for chain ${chainId}:`, error);
        }
    }

    // Sort by expectedDailyYield desc
    const sorted = allCandidates.sort((a, b) => b.expectedDailyYield - a.expectedDailyYield);

    // Filter logic: If no Tier 2 or Tier 1 pools exist, return Tier 3 opportunities.
    const tier12 = sorted.filter(p => p.yieldTier === 'Tier 1 - Extreme' || p.yieldTier === 'Tier 2 - Very High');

    const finalSelection = tier12.length > 0 ? tier12 : sorted;

    // Return the top 10
    return finalSelection.slice(0, 10);
}
