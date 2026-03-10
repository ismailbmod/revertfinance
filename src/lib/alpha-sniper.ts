import ccxt from 'ccxt';
import { fetchTopPools, fetchPoolTicks, SubgraphPool } from './subgraph';
import { calculateATR } from './indicators';
import { normalizeSymbol } from './bot-engine';
import { sendNotification } from './telegram';
import { supabase } from './supabase';

export interface AlphaSniperResult {
    pool: string;
    chainId: number;
    poolAddress: string;
    feeTier: number;
    tvl: number;
    volume24h: number;
    volumeEfficiency: number;
    expectedDailyYield: number;
    expectedAPR: number;
    alphaScore: number;
    strategyType: string[];
    recommendedRanges: {
        tight: { min: number; max: number };
        medium: { min: number; max: number };
        wide: { min: number; max: number };
    };
    positionShare?: number;
    liquidityDensity?: number;
}

export async function runAlphaSniper(chainIds: number[]): Promise<AlphaSniperResult[]> {
    const exchange = new ccxt.binance();
    const allResults: AlphaSniperResult[] = [];

    for (const chainId of chainIds) {
        try {
            // STEP 1 — Pool Universe (Top 200 per chain)
            const pools = await fetchTopPools(chainId, 200);

            for (const pool of pools) {
                const tvl = parseFloat(pool.totalValueLockedUSD);
                const vol24h = pool.poolDayData?.[0] ? parseFloat(pool.poolDayData[0].volumeUSD) : 0;

                // STEP 3 - Alpha Filters (Basic)
                if (tvl < 1000000) continue;
                if (vol24h < 2000000) continue;

                const volumeEfficiency = vol24h / tvl;
                if (volumeEfficiency <= 0.8) continue;

                // STEP 2 — Core Alpha Metrics
                const feeTierDecimal = parseInt(pool.feeTier) / 1000000;
                const dailyFeePool = vol24h * feeTierDecimal;

                // 1) PRICE INVERSION FIX & STABLECOIN DETECTION
                const currentTick = parseInt(pool.tick);
                let price = Math.pow(1.0001, currentTick) * Math.pow(10, parseInt(pool.token0.decimals) - parseInt(pool.token1.decimals));

                const STABLES = ['USDC', 'USDT', 'DAI', 'USDE', 'MAI', 'FRAX', 'LUSD', 'PYUSD'];
                const t0Stable = STABLES.includes(pool.token0.symbol.toUpperCase());
                const t1Stable = STABLES.includes(pool.token1.symbol.toUpperCase());
                const isStablePair = t0Stable && t1Stable;

                // Sanity check price scale
                if (price < 0.000001 || price > 1000000) {
                    price = 1 / price;
                }

                let isInverted = false;
                // If t0 is stable and t1 is not, we prefer t1/t0 format (e.g. ETH/USDC)
                // Uniswap usually does t1/t0, so if Token0 is Stable, price is Asset/Stable already if tick is correct.
                // Wait: Current price calculation: (1.0001^tick * 10^(d0-d1)) = amount of Token1 per 1 Token0.
                // So if Token0=ETH, Token1=USDC -> price is USDC per ETH.
                // If Token0=USDC, Token1=ETH -> price is ETH per USDC.

                if (t0Stable && !t1Stable) {
                    price = 1 / price;
                    isInverted = true;
                }

                const poolSymbol = isInverted ? `${pool.token1.symbol}/${pool.token0.symbol}` : `${pool.token0.symbol}/${pool.token1.symbol}`;

                // 3) Liquidity Density Near Price (±1.0%)
                const ticks = await fetchPoolTicks(pool.id, chainId);
                const rangeFactor = 0.01; // 1%
                const rangeMin = price * (1 - rangeFactor);
                const rangeMax = price * (1 + rangeFactor);

                let activeLiquidityNearPrice = 0;
                let totalPoolLiquidity = 0;

                for (const tick of ticks) {
                    let tickPrice = Math.pow(1.0001, parseInt(tick.tickIdx)) * Math.pow(10, parseInt(pool.token0.decimals) - parseInt(pool.token1.decimals));
                    if (isInverted) tickPrice = 1 / tickPrice;

                    const liqGross = parseFloat(tick.liquidityGross);
                    totalPoolLiquidity += liqGross;
                    if (tickPrice >= rangeMin && tickPrice <= rangeMax) {
                        activeLiquidityNearPrice += liqGross;
                    }
                }

                if (totalPoolLiquidity === 0) continue;

                // Heuristic improvement: if specific tick data is too sparse, assume 15% density
                let liquidityDensity = activeLiquidityNearPrice / totalPoolLiquidity;
                if (liquidityDensity < 0.001) {
                    liquidityDensity = 0.15;
                }

                // 4) POSITION SHARE LIMIT
                const positionSize = 5000;
                const estimatedActiveCapitalInRange = liquidityDensity * tvl;
                let positionShare = positionSize / (estimatedActiveCapitalInRange + positionSize);

                // Safety cap: Max 0.5% of active liquidity
                if (positionShare > 0.005) {
                    positionShare = 0.005;
                }

                // 5) Estimated Daily Fees & YIELD REALISM
                let estimatedDailyFees = dailyFeePool * positionShare;

                // 6) FEE CONSISTENCY CHECK
                // If estimated fees for the LP position exceed 1% of total pool fees, cap it
                if (estimatedDailyFees > dailyFeePool * 0.01) {
                    estimatedDailyFees = dailyFeePool * 0.01;
                }

                let expectedDailyYield = estimatedDailyFees / positionSize;
                let yieldFlag = "";

                // Yield realism filter
                if (expectedDailyYield > 0.02) {
                    expectedDailyYield = 0.02;
                    yieldFlag = "Yield Capped";
                }

                // STEP 3 - Alpha Filters (Yield)
                if (expectedDailyYield <= 0.002) continue; // > 0.2%

                // Strategy markers
                const strategyType: string[] = [];
                if (expectedDailyYield > 0.01) {
                    strategyType.push("EXTREME ALPHA (VERIFY)");
                }

                // STEP 4 — Fee Spike Detection
                const volumes = pool.poolDayData?.map(d => parseFloat(d.volumeUSD)) || [];
                const avg7dVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : vol24h;
                const feeSpikeFlag = vol24h / (avg7dVolume || 1) > 1.8;

                // STEP 5 — Liquidity Gap Detection
                const liquidityGapFlag = liquidityDensity < 0.05 && volumeEfficiency > 1.2;

                // STEP 6 — Range Generation (ATR)
                let atr1h = 0;
                try {
                    const normalizedSymbol = await normalizeSymbol(exchange, poolSymbol);
                    if (normalizedSymbol) {
                        const ohlcv = await exchange.fetchOHLCV(normalizedSymbol, '1h', undefined, 100);
                        if (ohlcv.length >= 24) {
                            const closes = ohlcv.map(o => o[4] as number);
                            const highs = ohlcv.map(o => o[2] as number);
                            const lows = ohlcv.map(o => o[3] as number);
                            const atrs = calculateATR(highs, lows, closes, 24);
                            atr1h = atrs[atrs.length - 1];
                        }
                    }
                } catch (e) { }

                if (atr1h === 0) atr1h = price * 0.01; // fallback 1% ATR

                // STABLECOIN PAIR multiplier
                const atrMult = isStablePair ? 0.5 : 1.0;

                let tightWidth = 0.75 * atr1h * atrMult;
                let medWidth = 1.5 * atr1h * atrMult;
                let wideWidth = 3.0 * atr1h * atrMult;

                // 2) RANGE SANITY VALIDATION & CLAMPING
                const maxAllowedWidth = 0.5 * price;
                if (tightWidth > maxAllowedWidth) tightWidth = maxAllowedWidth;
                if (medWidth > maxAllowedWidth) medWidth = maxAllowedWidth;
                if (wideWidth > maxAllowedWidth) wideWidth = maxAllowedWidth;

                const tightRange = { min: price - tightWidth, max: price + tightWidth };
                const mediumRange = { min: price - medWidth, max: price + medWidth };
                const wideRange = { min: price - wideWidth, max: price + wideWidth };

                // Ensure positive
                if (tightRange.min <= 0) tightRange.min = price * 0.99;
                if (mediumRange.min <= 0) mediumRange.min = price * 0.95;
                if (wideRange.min <= 0) wideRange.min = price * 0.9;

                // STEP 7 — Alpha Score
                let alphaScore = (expectedDailyYield * 100) + (volumeEfficiency * 50);
                if (feeSpikeFlag) alphaScore += 40;
                if (liquidityGapFlag) alphaScore += 30;

                if (feeSpikeFlag) strategyType.push("Fee Spike");
                if (liquidityGapFlag) strategyType.push("Liquidity Gap");
                if (volumeEfficiency > 1.5) strategyType.push("High Efficiency");
                if (yieldFlag) strategyType.push(yieldFlag);

                // 8) FINAL OUTPUT VALIDATION
                if (price <= 0 || price > 1000000) continue;
                if (expectedDailyYield <= 0 || expectedDailyYield > 0.02) continue;
                if (tightRange.max <= tightRange.min) continue;

                allResults.push({
                    pool: poolSymbol,
                    chainId,
                    poolAddress: pool.id,
                    feeTier: parseInt(pool.feeTier),
                    tvl,
                    volume24h: vol24h,
                    volumeEfficiency,
                    expectedDailyYield,
                    expectedAPR: expectedDailyYield * 365 * 100,
                    alphaScore,
                    strategyType: strategyType.length > 0 ? strategyType : ["High Efficiency"],
                    recommendedRanges: {
                        tight: tightRange,
                        medium: mediumRange,
                        wide: wideRange
                    },
                    positionShare,
                    liquidityDensity
                });
            }
        } catch (error) {
            console.error(`Alpha Sniper failed for chain ${chainId}:`, error);
        }
    }

    // Sort by Alpha Score
    const sorted = allResults.sort((a, b) => b.alphaScore - a.alphaScore).slice(0, 5);

    // STEP 9 — Alerts (Yield > 0.5%)
    let chatId = undefined;
    if (!process.env.TEST_MODE) {
        const { data: settings } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();
        chatId = settings?.value;
    }

    const getNetworkName = (id: number) => id === 137 ? 'Polygon' : id === 1 ? 'Ethereum' : id === 10 ? 'Optimism' : id === 42161 ? 'Arbitrum' : id === 8453 ? 'Base' : `Chain ${id}`;
    const formatPrice = (p: number) => p < 0.01 ? p.toFixed(8) : p.toFixed(4);

    for (const res of sorted) {
        if (res.expectedDailyYield > 0.005 && chatId) {
            const message = `🚀 *ALPHA SNIPER ALERT*
            
Pool: \`${res.pool}\`
Fee Tier: \`${(res.feeTier / 10000).toFixed(2)}%\`
Chain: \`${getNetworkName(res.chainId)}\`
Daily Yield: \`${(res.expectedDailyYield * 100).toFixed(2)}%\`
Alpha Score: \`${res.alphaScore.toFixed(1)}\`
Strategies: \`${res.strategyType.join(', ')}\`

*Recommended Ranges:*
Tight: \`$${formatPrice(res.recommendedRanges.tight.min)} - $${formatPrice(res.recommendedRanges.tight.max)}\`
Medium: \`$${formatPrice(res.recommendedRanges.medium.min)} - $${formatPrice(res.recommendedRanges.medium.max)}\`
Wide: \`$${formatPrice(res.recommendedRanges.wide.min)} - $${formatPrice(res.recommendedRanges.wide.max)}\``;

            await sendNotification(chatId, message);
        }
    }

    return sorted;
}
