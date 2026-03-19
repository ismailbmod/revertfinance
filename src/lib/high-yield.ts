import ccxt from 'ccxt';
import { fetchTopPools } from './subgraph';
import { calculateATR, calculateADX, calculateVolumeSpike } from './indicators';
import { normalizeSymbol } from './bot-engine';
import { sendNotification } from './telegram';
import { supabase } from './supabase';

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
    diagnostics?: { atrPct: number; lastADX: number; volumeSpike: number };
}

export async function detectHighYieldPools(chainIds: number[]): Promise<HighYieldResult[]> {
    const exchange = new ccxt.binance();
    const allCandidates: HighYieldResult[] = [];

    const chainTasks = chainIds.map(async (chainId) => {
        const results: HighYieldResult[] = [];
        try {
            console.log(`[High Yield Detector] Scanning chain ${chainId}...`);
            const pools = await fetchTopPools(chainId, 100, 1000000);

            for (const pool of pools) {
                const tvl = parseFloat(pool.totalValueLockedUSD);
                
                // Volume Stability Filter (Max today/yesterday)
                const vol0 = pool.poolDayData?.[0] ? parseFloat(pool.poolDayData[0].volumeUSD) : 0;
                const vol1 = pool.poolDayData?.[1] ? parseFloat(pool.poolDayData[1].volumeUSD) : 0;
                const vol24h = Math.max(vol0, vol1);

                // Core Filters (Consistent with Alpha Engine)
                if (tvl < 5000000) continue; 
                if (vol24h < 1000000) continue; 
                
                const volumeRatio = vol24h / tvl;
                if (volumeRatio < 0.1) continue;

                const poolSymbol = `${pool.token0.symbol}/${pool.token1.symbol}`;
                const feeTierDecimal = parseInt(pool.feeTier) / 1000000;
                let expectedDailyYield = (vol24h * feeTierDecimal) / tvl;

                // Indicator Data Validation (Bypass if data missing)
                let atrPct = 0;
                let lastADX = 0;
                let volumeSpike = 0;

                try {
                    const normalized = await normalizeSymbol(exchange, poolSymbol);
                    if (normalized) {
                        const ohlcv = await exchange.fetchOHLCV(normalized, '1h', undefined, 100);
                        if (ohlcv.length >= 24) {
                            const closes = ohlcv.map(o => o[4] as number);
                            const highs = ohlcv.map(o => o[2] as number);
                            const lows = ohlcv.map(o => o[1] as number);
                            const volumes = ohlcv.map(o => o[5] as number);
                            
                            const atrs = calculateATR(highs, lows, closes, 14);
                            atrPct = (atrs[atrs.length - 1] / closes[closes.length - 1]) * 100;
                            const { adx } = calculateADX(highs, lows, closes, 14);
                            lastADX = adx[adx.length - 1] || 0;
                            volumeSpike = calculateVolumeSpike(volumes);

                            // Skip if critical data is zero
                            if (volumeSpike < 0.5) expectedDailyYield *= 0.4;
                            if (lastADX > 30) expectedDailyYield *= 0.6;
                            if (atrPct < 0.2) expectedDailyYield *= 0.5;
                        }
                    }
                } catch (e) {
                    // Do not skip, just keep unadjusted yield for exploration
                }

                // Yield Tiers (Slightly more inclusive for exploration)
                let yieldTier: HighYieldResult['yieldTier'] | null = null;
                if (expectedDailyYield >= 0.008) {
                    yieldTier = 'Tier 1 - Extreme';
                } else if (expectedDailyYield >= 0.005) {
                    yieldTier = 'Tier 2 - Very High';
                } else if (expectedDailyYield >= 0.001) {
                    yieldTier = 'Tier 3 - High';
                }

                if (!yieldTier) continue;

                results.push({
                    symbol: poolSymbol,
                    chainId,
                    poolAddress: pool.id,
                    feeTier: parseInt(pool.feeTier),
                    tvl,
                    dailyVolume: vol24h,
                    volumeRatio,
                    expectedDailyYield,
                    expectedAPR: expectedDailyYield * 365 * 100,
                    yieldTier,
                    diagnostics: { atrPct, lastADX, volumeSpike }
                });
            }
        } catch (error) {
            console.error(`High Yield Scan failed for chain ${chainId}:`, error);
        }
        return results;
    });

    const resultsArray = await Promise.all(chainTasks);
    resultsArray.forEach(r => allCandidates.push(...r));

    const sorted = allCandidates.sort((a, b) => b.expectedDailyYield - a.expectedDailyYield).slice(0, 10);

    // STEP — Telegram Alerts (Only Tier 1 & 2)
    let chatId = undefined;
    if (!process.env.TEST_MODE) {
        const { data: settings } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();
        chatId = settings?.value;
    }

    const getNetworkName = (id: number) => id === 137 ? 'Polygon' : id === 1 ? 'Ethereum' : id === 10 ? 'Optimism' : id === 42161 ? 'Arbitrum' : id === 8453 ? 'Base' : `Chain ${id}`;

    for (const res of sorted) {
        if (chatId && (res.yieldTier === 'Tier 1 - Extreme' || res.yieldTier === 'Tier 2 - Very High')) {
            const message = `🔥 *HIGH YIELD SCANNER ALERT*
            
Pool: \`${res.symbol}\`
Tier: *${res.yieldTier}*
Chain: \`${getNetworkName(res.chainId)}\`

Daily Yield: \`${(res.expectedDailyYield * 100).toFixed(3)}%\`
Est. APR: \`${res.expectedAPR.toFixed(1)}%\`
Vol/TVL: \`${res.volumeRatio.toFixed(2)}x\`

Diagnostics:
ATR: \`${res.diagnostics?.atrPct.toFixed(2)}%\`
ADX: \`${res.diagnostics?.lastADX.toFixed(1)}\`
Vol Spike: \`${res.diagnostics?.volumeSpike.toFixed(1)}x\``;

            await sendNotification(chatId, message);
        }
    }

    return sorted;
}
