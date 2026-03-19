import ccxt from 'ccxt';
import { fetchTopPools, fetchPoolTicks, SubgraphPool } from './subgraph';
import { calculateATR, calculateADX, calculateVolumeSpike } from './indicators';
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
    recommendedRange: { min: number; max: number };
    rangeWidthPct: number;
    positionShare?: number;
    liquidityDensity?: number;
    recommendation?: string;
    confidence?: string;
    diagnostics?: { atrPct: number; lastADX: number; volumeSpike: number };
}

export async function runAlphaSniper(chainIds: number[]): Promise<AlphaSniperResult[]> {
    const exchange = new ccxt.binance();
    const allResults: AlphaSniperResult[] = [];

    const chainTasks = chainIds.map(async (chainId) => {
        const results: AlphaSniperResult[] = [];
        try {
            console.log(`[Alpha Sniper] Starting scan for chain ${chainId}...`);
            const pools = await fetchTopPools(chainId, 200, 5000000);
            console.log(`[Alpha Sniper] Chain ${chainId}: Found ${pools.length} initial pools.`);

            for (const pool of pools) {
                const tvl = parseFloat(pool.totalValueLockedUSD);
                
                // FIXED: Use max of today/yesterday volume (bypass subgraph morning reset)
                const vol0 = pool.poolDayData?.[0] ? parseFloat(pool.poolDayData[0].volumeUSD) : 0;
                const vol1 = pool.poolDayData?.[1] ? parseFloat(pool.poolDayData[1].volumeUSD) : 0;
                const vol24h = Math.max(vol0, vol1);

                // STEP 3 - Alpha Filters (Basic)
                if (tvl < 5000000) continue; 
                if (vol24h < 1000000) continue; 

                const volumeEfficiency = vol24h / tvl;
                if (volumeEfficiency < 0.1) continue;

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
                const filterRangeMin = price * (1 - rangeFactor);
                const filterRangeMax = price * (1 + rangeFactor);

                let activeLiquidityNearPrice = 0;
                let totalPoolLiquidity = 0;

                for (const tick of ticks) {
                    let tickPrice = Math.pow(1.0001, parseInt(tick.tickIdx)) * Math.pow(10, parseInt(pool.token0.decimals) - parseInt(pool.token1.decimals));
                    if (isInverted) tickPrice = 1 / tickPrice;

                    const liqGross = parseFloat(tick.liquidityGross);
                    totalPoolLiquidity += liqGross;
                    if (tickPrice >= filterRangeMin && tickPrice <= filterRangeMax) {
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

                // STEP 4 — Fee Spike Detection
                const volumes = pool.poolDayData?.map(d => parseFloat(d.volumeUSD)) || [];
                const avg7dVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : vol24h;
                const feeSpikeFlag = vol24h / (avg7dVolume || 1) > 1.8;

                // STEP 5 — Liquidity Gap Detection
                const liquidityGapFlag = liquidityDensity < 0.05 && volumeEfficiency > 1.2;

                // STEP 6 — Range Generation (ATR)
                let atr1h = 0;
                let atrPct = 0;
                let lastADX = 0;
                let volumeSpike = 0;

                try {
                    const normalizedSymbol = await normalizeSymbol(exchange, poolSymbol);
                    if (normalizedSymbol) {
                        const ohlcv = await exchange.fetchOHLCV(normalizedSymbol, '1h', undefined, 100);
                        if (ohlcv.length >= 24) {
                            const closes = ohlcv.map(o => o[4] as number);
                            const highs = ohlcv.map(o => o[2] as number);
                            const lows = ohlcv.map(o => o[3] as number);
                            const vols = ohlcv.map(o => o[5] as number);

                            const atrs = calculateATR(highs, lows, closes, 24);
                            atr1h = atrs[atrs.length - 1];
                            atrPct = (atr1h / price) * 100;

                            const { adx } = calculateADX(highs, lows, closes, 14);
                            lastADX = adx[adx.length - 1];
                            volumeSpike = calculateVolumeSpike(vols, 14);
                        }
                    }
                } catch (e) { }

                // DATA VALIDATION LAYER
                if (!atr1h || atr1h === 0 || !lastADX || lastADX === 0 || !volumeSpike || volumeSpike === 0 || vol24h === 0) {
                    continue; // BLOCK signal completely if market data is missing
                }

                // 2) OPTIMAL RANGE GENERATION
                const t0Correlated = ['ETH', 'WETH', 'BTC', 'WBTC', 'MATIC', 'WMATIC'].includes(pool.token0.symbol.toUpperCase());
                const t1Correlated = ['ETH', 'WETH', 'BTC', 'WBTC', 'MATIC', 'WMATIC'].includes(pool.token1.symbol.toUpperCase());
                const isCorrelatedPair = t0Correlated && t1Correlated && !isStablePair;

                let K = 2.5; // Volatile
                if (isStablePair) K = 1.5;
                else if (isCorrelatedPair) K = 2.0;

                let K_ADX_Multiplier = 1.0;
                if (lastADX > 25) {
                    K_ADX_Multiplier = 1.25; // increase range by +25%
                }

                let rangeWidthPct = (K * atrPct * K_ADX_Multiplier) / 100;
                if (rangeWidthPct < 0.015) {
                    rangeWidthPct = 0.015; // Minimum range width 1.5%
                }

                const maxAllowedPct = 0.50;
                if (rangeWidthPct > maxAllowedPct) rangeWidthPct = maxAllowedPct;

                const adjustedRangeWidth = price * rangeWidthPct;
                let rangeMin = price - (adjustedRangeWidth / 2);
                let rangeMax = price + (adjustedRangeWidth / 2);

                if (rangeMin <= 0) rangeMin = price * 0.95;

                // YIELD REALISM FILTERS
                if (volumeSpike < 0.5) expectedDailyYield *= 0.4;
                if (lastADX > 30) expectedDailyYield *= 0.6;
                if (atrPct < 0.2) expectedDailyYield *= 0.5;

                let expectedAPR = expectedDailyYield * 365 * 100;
                if (expectedAPR > 120) {
                    expectedDailyYield = 1.2 / 365;
                    expectedAPR = 120;
                    strategyType.push("Unstable APR");
                }

                // STEP 7 — Alpha Score (Scale 0-100+)
                // expectedDailyYield of 0.01 (1%) = 100 points
                // volumeEfficiency of 1.0 (100%) = 100 points
                let alphaScore = (expectedDailyYield * 10000) * 0.6 + (volumeEfficiency * 100) * 0.4;
                if (feeSpikeFlag) alphaScore += 30;
                if (liquidityGapFlag) alphaScore += 20;

                if (feeSpikeFlag) strategyType.push("Fee Spike");
                if (liquidityGapFlag) strategyType.push("Liquidity Gap");
                if (volumeEfficiency > 1.5) strategyType.push("High Efficiency");
                if (yieldFlag) strategyType.push(yieldFlag);

                // 8) FINAL OUTPUT VALIDATION
                if (price <= 0 || price > 1000000) continue;
                if (expectedDailyYield <= 0 || expectedDailyYield > 0.02) continue;
                if (rangeMax <= rangeMin) continue;

                // LP Entry Consistency Validation
                if (lastADX > 35) continue;
                if (volumeSpike !== 0 && volumeSpike < 0.3) continue;
                if (expectedAPR < 8) continue;
                if (alphaScore < 60) {
                    console.log(`NO TRADE - LOW QUALITY SETUP (${poolSymbol}) - Score: ${alphaScore.toFixed(1)}`);
                    continue;
                }

                let recommendation = "MODERATE";
                if (alphaScore > 75) recommendation = "STRONG OPPORTUNITY";

                if (expectedDailyYield > 0.008) strategyType.push("HIGH RISK");
                if (expectedDailyYield > 0.01) strategyType.push("EXTREME YIELD - VERIFY DATA");

                results.push({
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
                    recommendation,
                    diagnostics: { atrPct, lastADX, volumeSpike },
                    strategyType: strategyType.length > 0 ? strategyType : ["High Efficiency"],
                    recommendedRange: { min: rangeMin, max: rangeMax },
                    rangeWidthPct,
                    positionShare,
                    liquidityDensity
                });
            }
        } catch (error) {
            console.error(`Alpha Sniper failed for chain ${chainId}:`, error);
        }
        return results;
    });

    const resultsArray = await Promise.all(chainTasks);
    resultsArray.forEach(r => allResults.push(...r));

    // Sort by Alpha Score
    const sorted = allResults.sort((a, b) => b.alphaScore - a.alphaScore).slice(0, 10);


    // STEP 9 — Alerts (Yield > 0.5%)
    let chatId = undefined;
    if (!process.env.TEST_MODE) {
        const { data: settings } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();
        chatId = settings?.value;
    }

    const getNetworkName = (id: number) => id === 137 ? 'Polygon' : id === 1 ? 'Ethereum' : id === 10 ? 'Optimism' : id === 42161 ? 'Arbitrum' : id === 8453 ? 'Base' : `Chain ${id}`;
    const formatPrice = (p: number) => p < 0.01 ? p.toFixed(8) : p.toFixed(4);

    for (const res of sorted) {
        if (res.expectedDailyYield >= 0.002 && chatId) {
            const message = `🚀 *ALPHA SNIPER ALERT*
            
Pool: \`${res.pool}\`
Fee Tier: \`${(res.feeTier / 10000).toFixed(2)}%\`
Chain: \`${getNetworkName(res.chainId)}\`

Recommendation: *${res.recommendation}*

Alpha Score: \`${res.alphaScore.toFixed(1)}\`
Daily Yield: \`${(res.expectedDailyYield * 100).toFixed(2)}%\`
Estimated APR: \`${res.expectedAPR.toFixed(1)}%\`
Strategies: \`${res.strategyType.join(', ')}\`

Diagnostics:
ATR: \`${res.diagnostics?.atrPct.toFixed(2)}%\`
ADX: \`${res.diagnostics?.lastADX.toFixed(1)}\`
Volume Spike: \`${res.diagnostics?.volumeSpike.toFixed(1)}x\`

*Recommended Range:*
\`$${formatPrice(res.recommendedRange.min)} - $${formatPrice(res.recommendedRange.max)}\`
Range Width: \`${(res.rangeWidthPct * 100).toFixed(2)}%\``;

            await sendNotification(chatId, message);
        }
    }

    return sorted;
}
