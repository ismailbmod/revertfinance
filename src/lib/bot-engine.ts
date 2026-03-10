import ccxt from 'ccxt';
import { calculateEMA, calculateATR, calculateADX, calculateRSI, detectRegime } from './indicators';
import { supabase } from './supabase';
import { sendNotification } from './telegram';
import { fetchPoolsByPair, fetchPoolTicks } from './subgraph';
import {
    calculateExpectedDailyFees,
    estimateLPShare,
    simulateImpermanentLoss,
    estimateGasEfficiency,
    calculateFinalOpportunityScore,
    calculateRealisticAPR,
    estimateLiquidityInRange,
    calculateRiskScore
} from './lp-math';

export interface PoolConfig {
    symbol: string; // e.g., 'ZEC/USDT'
    chainId: number;
    poolAddress: string;
}

export async function normalizeSymbol(exchange: any, symbol: string): Promise<string | null> {
    const markets = await exchange.loadMarkets();

    const stripWrapped = (s: string) => s
        .replace(/\bWETH\b/g, 'ETH')
        .replace(/\bWBTC\b/g, 'BTC')
        .replace(/\bWMATIC\b/g, 'MATIC')
        .replace(/\bWBNB\b/g, 'BNB')
        .replace(/\bWSOL\b/g, 'SOL')
        .replace(/\bWAVAX\b/g, 'AVAX');

    const commonVariants = [
        symbol,
        stripWrapped(symbol),
        symbol.split('/').reverse().join('/'),
        stripWrapped(symbol.split('/').reverse().join('/')),
    ];

    for (const variant of commonVariants) {
        if (markets[variant]) return variant;
    }
    return null;
}

export async function runAnalysis(pool: PoolConfig, riskProfile: 'risky' | 'medium' | 'moderate', silent: boolean = false) {
    const exchange = new ccxt.binance();

    // 1. Normalize Symbol for Binance
    const normalizedSymbol = await normalizeSymbol(exchange, pool.symbol);
    if (!normalizedSymbol) {
        if (!silent) console.warn(`Symbol ${pool.symbol} not found on Binance oracles - skipping.`);
        return null;
    }

    const cacheKey = `${normalizedSymbol}-${riskProfile}`;

    // 2. Check Cache (1-hour TTL)
    try {
        if (!process.env.TEST_MODE) {
            const { data: cache } = await supabase
                .from('market_data_cache')
                .select('*')
                .eq('symbol', cacheKey)
                .single();

            if (cache && (new Date().getTime() - new Date(cache.updated_at).getTime() < 3600000)) {
                console.log(`Using cached analysis for ${cacheKey}`);
                return cache.data;
            }
        }
    } catch (e) {
        // Cache miss or error, proceed to analysis
    }

    // 3. Fetch OHLCV Data (1h timeframe)
    const ohlcv = await exchange.fetchOHLCV(normalizedSymbol, '1h', undefined, 100);
    const closes = ohlcv.map(d => d[4] as number);
    const highs = ohlcv.map(d => d[2] as number);
    const lows = ohlcv.map(d => d[3] as number);

    const currentPrice = closes[closes.length - 1];

    // 4. Calculate Indicators
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);

    const lastEMA20 = ema20[ema20.length - 1];
    const lastEMA50 = ema50[ema50.length - 1];
    const { adx } = calculateADX(highs, lows, closes, 14);
    const atr = calculateATR(highs, lows, closes, 14);
    const rsiRaw = calculateRSI(closes, 14);

    const lastADX = adx[adx.length - 1];
    const lastATR = atr[atr.length - 1];
    const lastRSI = rsiRaw[rsiRaw.length - 1];

    // 5. Detect Regime & Calculate Granular K-Factor (Professional MM Logic)
    const regime = detectRegime(lastEMA20, lastEMA50, lastADX);

    const poolT0 = pool.symbol.split('/')[0].toUpperCase();
    const poolT1 = pool.symbol.split('/')[1].toUpperCase();
    let displaySymbol = pool.symbol;

    const isStable = (s: string) => ['USDC', 'USDT', 'DAI', 'USD'].some(stable => s.includes(stable));
    const isCorrelated = (t0: string, t1: string) => {
        const stables = isStable(t0) && isStable(t1);
        const ethCorrelated = ['ETH', 'WETH', 'BTC', 'WBTC', 'MATIC', 'WMATIC'].includes(t0) && ['ETH', 'WETH', 'BTC', 'WBTC', 'MATIC', 'WMATIC'].includes(t1);
        return stables || ethCorrelated;
    };

    const isStablePair = isStable(poolT0) && isStable(poolT1);
    const isCorrelatedPair = isCorrelated(poolT0, poolT1);

    // Range Optimization Engine (Volatility Driven)
    let baseK = 3.0; // Volatile default
    if (isStablePair) baseK = 0.5;
    else if (isCorrelatedPair) baseK = 1.5;

    // Adjust slightly by regime but respect the asset class bounds
    if (regime === 'trend' && !isStablePair) baseK *= 1.2;
    if (regime === 'neutral' && !isStablePair) baseK *= 0.8;

    if (isStable(poolT0) && !isStable(poolT1)) {
        displaySymbol = `${poolT1}/${poolT0}`;
    }

    const stripWrapped = (s: string) => s
        .replace(/\bWETH\b/g, 'ETH')
        .replace(/\bWBTC\b/g, 'BTC')
        .replace(/\bWMATIC\b/g, 'MATIC')
        .replace(/\bWBNB\b/g, 'BNB')
        .replace(/\bWSOL\b/g, 'SOL')
        .replace(/\bWAVAX\b/g, 'AVAX');

    const displayT0 = displaySymbol.split('/')[0];
    const binanceT0 = normalizedSymbol.split('/')[0];
    const needsInversion = stripWrapped(displayT0) !== stripWrapped(binanceT0);
    const cleanClose = needsInversion ? 1 / currentPrice : currentPrice;

    const [t0, t1] = pool.symbol.split('/');
    const pools = await fetchPoolsByPair(t0, t1, pool.chainId);

    // If poolAddress is provided (e.g. from clicking a scan result), find it specifically
    const specificPool = pool.poolAddress
        ? pools.find(p => p.id.toLowerCase() === pool.poolAddress.toLowerCase())
        : null;

    let bestPool: any = specificPool || pools[0];
    let maxVolumeEfficiency = 0;
    let selectedFeeTier = bestPool?.feeTier || '3000';
    let expectedFeeAPR = 0;
    let liquidityDensity = 0;

    let rejectCount = 0;
    // Filter pools by strict criteria
    const validPools = pools.filter(p => {
        const debugLog = (reason: string) => {
            // Silence noise if we are analyzing a specific verified pool address
            if (pool.poolAddress) return;

            if (rejectCount < 3) {
                console.log(`[Reject ${displaySymbol} ${p.id.slice(0, 8)}...] ${reason}`);
                rejectCount++;
                if (rejectCount === 3) console.log(`[Reject ${displaySymbol}] ... more pools hidden to reduce noise`);
            }
        };

        const isVerifiedPool = pool.poolAddress && p.id.toLowerCase() === pool.poolAddress.toLowerCase();

        const tvl = parseFloat(p.totalValueLockedUSD);
        const pool24hVolObj = p.poolDayData?.[0];

        if (!pool24hVolObj) {
            debugLog('Missing 24h volume data');
            return false;
        }

        const vol24h = parseFloat(pool24hVolObj.volumeUSD);

        // 18. Enhanced Strict Rules (Bypass if verified from scan)
        if (!isVerifiedPool) {
            if (tvl < 100000) { debugLog('TVL < 100k'); return false; }
            if (vol24h > 2000000000) { debugLog('Vol > 2B'); return false; }
        }

        const volEff = tvl > 0 ? vol24h / tvl : 0;

        // 12. Volume Sanity Checks (Bypass if verified from scan)
        if (!isVerifiedPool) {
            if (volEff > 20) { debugLog('VolEff > 20'); return false; }
            if (volEff < 0.05) { debugLog('VolEff < 0.05'); return false; }
        }

        // 18. Pool Age Filter (48 hours)
        if (p.createdAtTimestamp) {
            const ageSecs = Math.floor(Date.now() / 1000) - parseInt(p.createdAtTimestamp);
            if (ageSecs < 172800) { debugLog(`Age ${ageSecs}s < 48h`); return false; }
        }

        // 18. Price Sanity Check (Oracle vs DEX)
        if (p.token0Price) {
            const priceA = parseFloat(p.token0Price);
            if (priceA > 0) {
                const priceB = 1 / priceA;

                const devA = Math.abs(priceA - cleanClose) / cleanClose;
                const devB = Math.abs(priceB - cleanClose) / cleanClose;
                const minDev = Math.min(devA, devB);

                if (minDev > 0.20) {
                    debugLog(`Price Dev ${minDev.toFixed(2)} > 0.20 (PoolP: ${priceA}, Oracle: ${cleanClose})`);
                    return false; // Reject if deviates > 20%
                }
            }
        }

        return true;
    });

    if (validPools.length === 0 && !specificPool) {
        throw new Error(`No valid pools pass strict criteria for ${displaySymbol}`);
    }

    let maxScore = 0;

    // If we have a specific pool, we prioritize its calculation.
    // If not, we iterate to find the best pool by score.
    const poolsToAnalyze = specificPool ? [specificPool] : validPools;

    poolsToAnalyze.forEach(p => {
        const pool24hVolObj = p.poolDayData![0];
        const vol = parseFloat(pool24hVolObj.volumeUSD);
        const tvl = parseFloat(p.totalValueLockedUSD);
        const feeT = parseInt(p.feeTier);

        const volEff = tvl > 0 ? vol / tvl : 0;
        const fees = calculateExpectedDailyFees(vol, feeT);
        const apr = tvl > 0 ? (fees * 365 / tvl) * 100 : 0;

        // APR Sanity Check
        if (apr > 200 && tvl <= 100_000_000) {
            return; // Reject extreme APR unless massive TVL
        }

        // Depth/Density proxy
        const density = Math.log10(tvl + 1) / 10;

        // Estimated Gas Ratio (assuming $1000 capital for generic score scaling)
        const gasRatio = estimateGasEfficiency(1000, pool.chainId);

        // Normalize volatility proxy (lastATR relative to price)
        const volPct = (lastATR / currentPrice);

        const score = calculateFinalOpportunityScore(apr, volEff, volPct, density, gasRatio);

        if (score > maxScore) {
            maxScore = score;
            bestPool = p;
            maxVolumeEfficiency = volEff;
            selectedFeeTier = p.feeTier;
            expectedFeeAPR = apr;
            liquidityDensity = density;
        }
    });

    if (maxScore === 0) {
        throw new Error(`No pools passed APR sanity estimation for ${displaySymbol}`);
    }

    const recommendedFee = bestPool ? (parseInt(bestPool.feeTier) / 10000).toFixed(2) + '%' : '0.30%';

    // Multi-Range Generation
    const tightWidth = (baseK * 0.5) * lastATR;
    const medWidth = baseK * lastATR;
    const wideWidth = (baseK * 1.5) * lastATR;

    const getRange = (width: number) => {
        let rMin = currentPrice - width / 2;
        let rMax = currentPrice + width / 2;
        if (needsInversion) {
            const iMin = 1 / rMax;
            const iMax = 1 / rMin;
            rMin = iMin;
            rMax = iMax;
        }
        // Slightly overlap ranges natively by keeping them center-aligned
        return { min: rMin, max: rMax };
    };

    const rangeTight = getRange(tightWidth);
    const rangeMed = getRange(medWidth);
    const rangeWide = getRange(wideWidth);

    // 14. Liquidity Density Estimation (on Medium Range)
    let realisticAPR = expectedFeeAPR;
    let isHighILRisk = false;
    let il5 = 0;
    let il10 = 0;
    let riskScore = 0;

    if (bestPool) {
        const ticks = await fetchPoolTicks(bestPool.id, pool.chainId);
        const grossLiquidityInRange = estimateLiquidityInRange(ticks, rangeMed.min, rangeMed.max, currentPrice);

        // 13. Realistic LP Fee Capture
        // Assuming user deposits $5000 typical capital for share estimation.
        // Gross liquidity from subgraph is an abstract unit, but we treat it as proxy.
        // If query fails or zero, fallback to ideal expected fee APR.
        if (grossLiquidityInRange > 0) {
            const positionCapital = 5000;
            // Normalize assuming tick liquidity unit relates loosely to TVL. 
            // Real Uniswap math requires full sqrtPrice tick math, so we use a scaling heuristic:
            const estimatedPoolTVLInRange = (grossLiquidityInRange / (ticks.reduce((sum, t) => sum + parseFloat(t.liquidityGross || '0'), 0) || 1)) * parseFloat(bestPool.totalValueLockedUSD);
            const expectedShare = estimateLPShare(positionCapital, estimatedPoolTVLInRange || parseFloat(bestPool.totalValueLockedUSD));

            const pool24hVolObj = bestPool.poolDayData![0];
            const vol = parseFloat(pool24hVolObj.volumeUSD);

            realisticAPR = calculateRealisticAPR(vol, parseInt(bestPool.feeTier), expectedShare, parseFloat(bestPool.totalValueLockedUSD));

            // Reduce APR when liquidity concentration is high.
            // If the estimated TVL in range is > 80% of total TVL, concentration penalizes our share further.
            if (estimatedPoolTVLInRange > parseFloat(bestPool.totalValueLockedUSD) * 0.8) {
                realisticAPR *= 0.8; // 20% penalty for overcrowded tick ranges
            }
        }

        // Impermanent Loss Simulation
        il5 = simulateImpermanentLoss(rangeMed.min, rangeMed.max, 0.05);
        il10 = simulateImpermanentLoss(rangeMed.min, rangeMed.max, 0.10);
        isHighILRisk = il10 < -5.0; // If IL is worse than -5% on a 10% move
        const ilProb = Math.abs(il5) / 100; // rough proxy

        // 16. Risk Score
        riskScore = calculateRiskScore(lastATR / currentPrice, ilProb, Math.min(1, maxVolumeEfficiency / 10)); // proxy stability
    }

    // Gas Cost Efficiency (Assumed typical capital 5000 USD for LPing)
    const capitalUSD = 5000;
    const gasRatio = estimateGasEfficiency(capitalUSD, pool.chainId);
    const gasEfficient = gasRatio <= 1.0;

    // Backtesting Sim (Proxy using recent ATR)
    // Simulated historical fees over 100 periods
    const backtestScoreDelta = (expectedFeeAPR / 365) * 4 - Math.abs(il5);

    // 7. Calculate Market Maker Confidence (Dynamic & Risk-Aware)
    // Formula components:
    // A. Trend Alignment (ADX & EMA): 20-40 pts
    // B. Asset Class Stability (Inverted baseK): 10-30 pts (Safer = Higher)
    // C. Volume Efficiency: up to 20 pts
    // D. Price Stability (RSI Midpoint): up to 10 pts

    let confidence = Math.round(
        (lastADX > 25 ? 35 : 15) +                  // A. Trend Strength
        (maxVolumeEfficiency > 0.5 ? 20 : 10) +     // C. Vol Efficiency
        (4.0 - baseK) * 10 +                        // B. Safety Factor (Inverted K)
        (Math.abs(50 - lastRSI) < 10 ? 10 : 0)      // D. Price Stability
    );

    // Penalties
    if (!gasEfficient) confidence -= 15;
    if (isHighILRisk) confidence -= 15;
    if (Math.abs(lastEMA20 - lastEMA50) / currentPrice > 0.05) confidence -= 10; // High divergence penalty

    // Global constraints
    confidence = Math.min(95, Math.max(10, confidence));

    const chartData = ohlcv.map(d => ({
        time: new Date(d[0] as number).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        price: needsInversion ? 1 / (d[4] as number) : (d[4] as number)
    }));

    const analysisResult = {
        mappedSymbol: displaySymbol,
        currentPrice: cleanClose,
        tvl: bestPool ? parseFloat(bestPool.totalValueLockedUSD) : 0,
        dailyVolume: bestPool?.poolDayData?.[0] ? parseFloat(bestPool.poolDayData[0].volumeUSD) : 0,
        volEfficiency: maxVolumeEfficiency,
        expectedFeeAPR,
        realisticAPR,
        score: maxScore,
        riskScore,
        ilRisk: isHighILRisk ? 'HIGH' : 'LOW',
        il10Move: il10,
        gasRatio,
        rangeMin: rangeMed.min,
        rangeMax: rangeMed.max,
        indicators: {
            regime,
            adx: lastADX,
            atr: lastATR,
            rsi: lastRSI
        },
        recommendation: {
            feeTier: parseInt(selectedFeeTier),
            feeTierDisplay: recommendedFee,
            confidence: Math.max(0, confidence),
            opportunityScore: maxScore,
            ranges: {
                tight: rangeTight,
                medium: rangeMed,
                wide: rangeWide
            },
            strategy: 'Multi-Range Optimal'
        },
        chartData,
        timestamp: new Date().toISOString()
    };

    // 8. Update Cache
    if (!process.env.TEST_MODE) {
        await supabase.from('market_data_cache').upsert({
            symbol: cacheKey,
            price: cleanClose,
            volatility_7d: lastATR,
            data: analysisResult,
            updated_at: new Date().toISOString()
        });
    }

    if (!silent) {
        // 9. Store Analysis & Send Notification
        let chatId = undefined;
        if (!process.env.TEST_MODE) {
            const { data: settings } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();
            chatId = settings?.value;
        }

        const formatPrice = (p: number) => p < 0.01 ? p.toFixed(8) : p.toFixed(4);

        const signalMessage = `
🚀 *MARKET OPPORTUNITY*

Pair: \`${displaySymbol}\`
Chain: \`${pool.chainId}\`
TVL: \`$${analysisResult.tvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}\`
Daily Volume: \`$${analysisResult.dailyVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}\`
Fee Tier: \`${recommendedFee}\`

Estimated APR: \`${expectedFeeAPR.toFixed(2)}%\`
Impermanent Loss Risk: \`${analysisResult.ilRisk}\` (${analysisResult.il10Move.toFixed(2)}% on 10% move)

Recommended LP Strategy: \`${analysisResult.recommendation.strategy}\`

Range 1 (Tight): \`$${formatPrice(rangeTight.min)}\` - \`$${formatPrice(rangeTight.max)}\`
Range 2 (Medium): \`$${formatPrice(rangeMed.min)}\` - \`$${formatPrice(rangeMed.max)}\`
Range 3 (Wide): \`$${formatPrice(rangeWide.min)}\` - \`$${formatPrice(rangeWide.max)}\`

Capital Allocation: \`30% Tight, 40% Medium, 30% Wide\`

Rebalance Trigger: \`Price exits range by 1% OR significant liquidity shift\`

Gas Efficiency: \`${gasEfficient ? 'OPTIMAL' : 'POOR'}\` (${gasRatio.toFixed(2)}%)

Confidence Score: \`${confidence}%\`
      `;

        if (chatId) {
            await sendNotification(chatId, signalMessage);
        }

        // Save to DB
        if (!process.env.TEST_MODE) {
            await supabase.from('signals').insert({
                type: 'entry',
                asset_pair: pool.symbol,
                message: signalMessage,
                data: { ...analysisResult, riskProfile }
            });
        }
    }

    return analysisResult;
}

export async function scanMarket(chainIds: number[], riskProfile: 'risky' | 'medium' | 'moderate', limit: number = 5) {
    const { fetchTopPools } = await import('./subgraph');

    let allTopPairs: any[] = [];

    for (const chainId of chainIds) {
        try {
            const topPoolData = await fetchTopPools(chainId);
            // Take top 12 pools per chain by volume to find the best candidates
            // We use a 100k floor to match runAnalysis strict criteria
            const topPools = topPoolData
                .filter(p => parseFloat(p.totalValueLockedUSD) > 100000)
                .sort((a, b) => parseFloat(b.volumeUSD) - parseFloat(a.volumeUSD))
                .slice(0, 12)
                .map(p => ({ ...p, chainId }));

            allTopPairs.push(...topPools);
        } catch (error) {
            console.error(`Failed to fetch pools for chain ${chainId}`, error);
        }
    }

    const results: any[] = [];

    // Process in parallel batches to optimize speed while respecting rate limits
    const batchSize = 5;
    for (let i = 0; i < allTopPairs.length; i += batchSize) {
        const batch = allTopPairs.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (pool) => {
            try {
                const analysis = await runAnalysis({
                    symbol: `${pool.token0.symbol}/${pool.token1.symbol}`,
                    chainId: pool.chainId,
                    poolAddress: pool.id
                }, riskProfile, true); // Always silent during scan

                if (analysis) {
                    return {
                        pool: analysis.mappedSymbol || `${pool.token0.symbol}/${pool.token1.symbol}`,
                        chainId: pool.chainId,
                        poolAddress: pool.id,
                        confidence: analysis.score || 0,
                        analysis
                    };
                }
            } catch (e: any) {
                if (e.message.includes('No valid pools') || e.message.includes('No pools passed APR')) {
                    // This is normal - it just means the pair didn't meet our quality standards
                    console.log(`[Skip] ${pool.token0.symbol}/${pool.token1.symbol} (Chain: ${pool.chainId}): ${e.message}`);
                } else {
                    console.warn(`[Error] Technical issue analyzing ${pool.token0.symbol}/${pool.token1.symbol}:`, e.message);
                }
            }
            return null;
        }));

        results.push(...batchResults.filter(r => r !== null));
    }

    // After analysis, we deduplicate by pair to keep only the BEST fee tier / pool for each pair
    const uniqueResults = new Map<string, any>();
    results.forEach(res => {
        const key = `${res.pool}-${res.chainId}`;
        if (!uniqueResults.has(key) || res.analysis.score > uniqueResults.get(key).analysis.score) {
            uniqueResults.set(key, res);
        }
    });

    // Pick top opportunities and normalize confidence based on max score
    const dedupedResults = Array.from(uniqueResults.values());
    const maxScore = Math.max(...dedupedResults.map(r => r.analysis.score || 0.001), 0.001);

    const topOpportunities = dedupedResults
        .map(opp => ({
            ...opp,
            confidence: Math.min((opp.analysis.score / maxScore) * 100, 95)
        }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);

    // Save to DB so dashboard can display them
    const formatPrice = (p: number) => p < 0.01 ? p.toFixed(8) : p.toFixed(4);

    if (topOpportunities.length > 0 && !process.env.TEST_MODE) {
        const dbInserts = topOpportunities.map((opp) => ({
            type: 'scan',
            asset_pair: opp.pool,
            message: `Market Scan Opportunity. Regime: ${opp.analysis.indicators?.regime?.toUpperCase() || 'N/A'}. Strategy: ${opp.analysis.recommendation?.strategy || 'N/A'}. Score: ${opp.analysis.score.toFixed(2)}`,
            data: {
                currentPrice: opp.analysis.currentPrice,
                confidence: opp.confidence,
                chainId: opp.chainId,
                poolAddress: opp.poolAddress,
                ...opp.analysis
            }
        }));
        await supabase.from('signals').insert(dbInserts);
    }

    // Send signals for top opportunities
    let chatId = undefined;
    if (!process.env.TEST_MODE) {
        const { data: settings } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();
        chatId = settings?.value;
    }

    if (chatId && topOpportunities.length > 0) {
        let scanMessage = `🔍 *MARKET SCAN: Top ${topOpportunities.length} Opportunities*\n\n`;

        topOpportunities.forEach((opp, i) => {
            const getNetworkName = (id: number) => id === 137 ? 'Polygon' : id === 1 ? 'Ethereum' : id === 10 ? 'Optimism' : id === 42161 ? 'Arbitrum' : id === 8453 ? 'Base' : id === 56 ? 'BNB' : `Chain ${id}`;

            scanMessage += `${i + 1}. *${opp.pool}* on ${getNetworkName(opp.chainId)}\n`;
            scanMessage += `TVL: \`$${(opp.analysis.tvl || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}\` | Vol: \`$${(opp.analysis.dailyVolume || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}\`\n`;
            scanMessage += `Recommended Fee: \`${opp.analysis.recommendation?.feeTierDisplay || 'N/A'}\` | Realistic APR: \`${(opp.analysis.realisticAPR || 0).toFixed(2)}%\`\n`;
            scanMessage += `Risk Score: \`${(opp.analysis.riskScore || 0).toFixed(0)}/100\`\n`;
            scanMessage += `Range 1: \`$${formatPrice(opp.analysis.recommendation.ranges.tight.min)}\` - \`$${formatPrice(opp.analysis.recommendation.ranges.tight.max)}\`\n`;
            scanMessage += `Range 2: \`$${formatPrice(opp.analysis.recommendation.ranges.medium.min)}\` - \`$${formatPrice(opp.analysis.recommendation.ranges.medium.max)}\`\n`;
            scanMessage += `Range 3: \`$${formatPrice(opp.analysis.recommendation.ranges.wide.min)}\` - \`$${formatPrice(opp.analysis.recommendation.ranges.wide.max)}\`\n`;
            scanMessage += `Bot Confidence: \`${opp.confidence.toFixed(1)}%\` | Strategy: \`${opp.analysis.recommendation?.strategy || 'N/A'}\`\n\n`;
        });

        await sendNotification(chatId, scanMessage);
    }

    return topOpportunities;
}
