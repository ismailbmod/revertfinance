import ccxt from 'ccxt';
import { calculateEMA, calculateATR, calculateADX, calculateRSI, detectRegime, calculateVolumeSpike } from './indicators';
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
        .replace(/\bc?b?BTC\.?e?\b/g, 'BTC')
        .replace(/\bc?b?ETH\.?e?\b/g, 'ETH')
        .replace(/\bWETH\b/g, 'ETH')
        .replace(/\bWBTC\b/g, 'BTC')
        .replace(/\bWMATIC\b/g, 'MATIC')
        .replace(/\bWBNB\b/g, 'BNB')
        .replace(/\bWSOL\b/g, 'SOL')
        .replace(/\bWAVAX\b/g, 'AVAX')
        .replace(/\bwstETH\b/g, 'ETH')
        .replace(/\bc?b?USDC\.?e?\b/g, 'USDT') // Fallback USDC to USDT for better liquidity on Binance oracles
        .replace(/\bDAI\b/g, 'USDT');

    const clean = stripWrapped(symbol);
    const [t0, t1] = clean.split('/');

    const commonVariants = [
        symbol,
        clean,
        `${t0}/${t1}`,
        `${t1}/${t0}`,
        symbol.split('/').reverse().join('/'),
        // Oracles as USDT pairs (the most common on Binance)
        `${t0}/USDT`,
        `${t1}/USDT`,
        `BTC/USDT`, // Final fallback for BTC pegged assets
        `ETH/USDT`, // Final fallback for ETH pegged assets
    ];

    for (const variant of commonVariants) {
        if (markets[variant]) return variant;
    }
    return null;
}

export async function runAnalysis(pool: PoolConfig, riskProfile: 'risky' | 'medium' | 'moderate', silent: boolean = false, minAprThreshold: number = 25) {
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
    const volumes = ohlcv.map(d => d[5] as number);

    const currentPrice = closes[closes.length - 1];

    // 4. Calculate Indicators
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);

    const lastEMA20 = ema20[ema20.length - 1];
    const lastEMA50 = ema50[ema50.length - 1];
    const { adx } = calculateADX(highs, lows, closes, 14);
    const atr = calculateATR(highs, lows, closes, 14);
    const rsiRaw = calculateRSI(closes, 14);
    const volumeSpike = calculateVolumeSpike(volumes, 14);

    const lastADX = adx[adx.length - 1];
    const lastATR = atr[atr.length - 1];
    const lastRSI = rsiRaw[rsiRaw.length - 1];
    const atrPct = (lastATR / currentPrice) * 100;

    // DATA VALIDATION LAYER
    if (!lastATR || lastATR === 0 || !lastADX || lastADX === 0 || !volumeSpike || volumeSpike === 0) {
        throw new Error("NO TRADE - INVALID OR MISSING MARKET DATA");
    }

    // 5. Determine General Market Regime
    let marketRegime = 'RANGING';
    if (atrPct > 1.5 && lastADX > 30) {
        marketRegime = 'VOLATILE TREND';
    } else if (atrPct < 0.5 && lastADX < 20) {
        marketRegime = 'STABLE RANGE';
    } else if (lastADX > 40) {
        marketRegime = 'STRONG TREND';
    } else if (lastADX > 30) {
        marketRegime = 'TREND';
    } else if (lastADX >= 20) {
        marketRegime = 'MIXED';
    } else {
        marketRegime = 'RANGING';
    }


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

    // Single Optimal Range Calculation (Volatility Driven)
    let K = 2.5; // Default Volatile
    if (isStablePair) K = 1.5;
    else if (isCorrelatedPair) K = 2.0;

    let K_ADX_Multiplier = 1.0;
    if (lastADX > 25) {
        K_ADX_Multiplier = 1.25; // increase range by +25%
    }

    let rangeWidthPct = (K * atrPct * K_ADX_Multiplier) / 100;
    
    // Minimum range width = 1.5% and enforce if ATR < 0.5%
    if (rangeWidthPct < 0.015 || atrPct < 0.5) {
        rangeWidthPct = Math.max(0.015, rangeWidthPct); // Enforce minimum width 1.5%
    }
    
    if (rangeWidthPct > 0.15) rangeWidthPct = 0.15; // Set a generous cap (15%)
    
    const currentPriceBase = currentPrice;
    const adjustedRangeWidth = currentPriceBase * rangeWidthPct;
    let rangeMin = currentPriceBase - (adjustedRangeWidth / 2);
    let rangeMax = currentPriceBase + (adjustedRangeWidth / 2);

    // Calculate Estimated time in range (hours)
    const distanceToEdge = (rangeWidthPct * 100) / 2;
    let estimatedTimeHours = 0;
    if (lastADX > 25) {
        estimatedTimeHours = Math.floor(distanceToEdge / atrPct);
    } else {
        estimatedTimeHours = Math.floor(Math.pow(distanceToEdge / atrPct, 2));
    }
    let stopLossDistancePct = (atrPct * 1.5) / 100;
    if (lastADX > 30) stopLossDistancePct *= 0.8;
    if (atrPct > 1.5) stopLossDistancePct *= 1.2;
    
    if (stopLossDistancePct < 0.01) stopLossDistancePct = 0.01;
    if (stopLossDistancePct > 0.03) stopLossDistancePct = 0.03;

    const stopLossDistance = currentPriceBase * stopLossDistancePct;
    const stopLoss = rangeMin - stopLossDistance;

    // (Market Regime Warning previously resided here - moved to final NO TRADE validation)

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

    const specificPool = pool.poolAddress
        ? pools.find(p => p.id.toLowerCase() === pool.poolAddress.toLowerCase())
        : null;

    let bestPool: any = specificPool || pools[0];
    let maxVolumeEfficiency = 0;
    let selectedFeeTier = bestPool?.feeTier || '3000';
    let expectedFeeAPR = 0;

    const validPools = pools.filter(p => {
        const isVerifiedPool = pool.poolAddress && p.id.toLowerCase() === pool.poolAddress.toLowerCase();
        const tvl = parseFloat(p.totalValueLockedUSD);
        const pool24hVolObj = p.poolDayData?.[0];
        if (!pool24hVolObj) return false;
        const vol24h = parseFloat(pool24hVolObj.volumeUSD);

        if (!isVerifiedPool) {
            if (tvl < 100000) return false;
        }

        const volEff = tvl > 0 ? vol24h / tvl : 0;
        if (!isVerifiedPool) {
            if (volEff > 20 || volEff < 0.05) return false;
        }

        if (p.createdAtTimestamp) {
            const ageSecs = Math.floor(Date.now() / 1000) - parseInt(p.createdAtTimestamp);
            if (ageSecs < 172800) return false;
        }

        return true;
    });

    if (validPools.length === 0 && !specificPool) {
        throw new Error(`No valid pools pass strict criteria for ${displaySymbol}. Try selecting a specific pool address to analyze.`);
    }

    bestPool = specificPool || validPools[0];

    let maxScore = 0;
    const poolsToAnalyze = specificPool ? [specificPool] : validPools;

    poolsToAnalyze.forEach(p => {
        const dayData = p.poolDayData || [];
        if (dayData.length === 0) return;
        
        const pool24hVolObj = dayData[0];
        const vol24h = parseFloat(pool24hVolObj.volumeUSD);
        const tvl = parseFloat(p.totalValueLockedUSD);
        const feeT = parseInt(p.feeTier);

        const volEff = tvl > 0 ? vol24h / tvl : 0;
        
        // Realistic APR Base
        const feeRate = feeT / 1000000;
        let baseAPR = tvl > 0 ? ((vol24h * feeRate * 365) / tvl) * 100 : 0;
        
        // Strict Yield Filters
        if (tvl < 5000000) return;
        if (vol24h < 1000000) return;
        if (volEff < 0.1) return;
        if (baseAPR > 200) return;

        let rawAPR = baseAPR;
        let adjustedAPR = rawAPR;
        
        // Realistic Adjustments
        if (volumeSpike < 0.5) adjustedAPR *= 0.4;
        if (lastADX > 30) adjustedAPR *= 0.6;
        if (tvl > 50000000) adjustedAPR *= 0.7;
        
        const volToTvl = tvl > 0 ? (vol24h / tvl) : 0;
        if (volToTvl < 0.1) adjustedAPR *= 0.5;

        // Hard Caps
        let aprLabel = 'STABLE APR';
        if (adjustedAPR > 100) {
            adjustedAPR = 100;
            aprLabel = 'UNSTABLE APR';
        }

        // APR Confidence
        let aprConfidence = 'HIGH';
        if (volToTvl < 0.05 || lastADX > 35) aprConfidence = 'LOW';
        else if (volToTvl < 0.2 || lastADX > 25 || volumeSpike < 0.8) aprConfidence = 'MEDIUM';

        // Continue with Score Calculation
        const density = Math.log10(tvl + 1) / 10;
        const gasRatio = estimateGasEfficiency(1000, pool.chainId);
        const volPct = (lastATR / currentPrice);

        const score = calculateFinalOpportunityScore(adjustedAPR, volEff, volPct, density, gasRatio);

        if (score > maxScore) {
            maxScore = score;
            bestPool = p;
            maxVolumeEfficiency = volEff;
            selectedFeeTier = p.feeTier;
            expectedFeeAPR = adjustedAPR; 

            (p as any).analysisContext = {
                rawAPR,
                adjustedAPR,
                aprLabel,
                aprConfidence
            };
        }
    });

    const context = bestPool?.analysisContext || { rawAPR: expectedFeeAPR, adjustedAPR: expectedFeeAPR, aprLabel: 'STABLE APR', aprConfidence: 'HIGH' };

    const finalVol24h = bestPool?.poolDayData?.[0] ? parseFloat(bestPool.poolDayData[0].volumeUSD) : 0;
    if (finalVol24h === 0) {
        throw new Error("NO TRADE - INVALID OR MISSING MARKET DATA");
    }

    if (maxScore === 0) {
        throw new Error(`NO TRADE - LOW LIQUIDITY POOL`);
    }

    // Calculate New 0-100 Safety Score System
    let aprScore = 0;
    if (context.adjustedAPR > 50) aprScore = 25;
    else if (context.adjustedAPR > 20) aprScore = 20;
    else if (context.adjustedAPR > 10) aprScore = 15;
    else if (context.adjustedAPR > 5) aprScore = 10;
    else aprScore = 5;
    if (context.aprLabel === 'UNSTABLE APR') aprScore -= 10;

    let volScore = 0;
    if (maxVolumeEfficiency > 0.8) volScore = 25;
    else if (maxVolumeEfficiency > 0.5) volScore = 20;
    else if (maxVolumeEfficiency > 0.2) volScore = 15;
    else if (maxVolumeEfficiency > 0.1) volScore = 10;
    else volScore = 5;
    if (maxVolumeEfficiency < 0.3) volScore -= 10;

    let atrScore = 0;
    if (atrPct < 0.5) atrScore = 20;
    else if (atrPct < 1.0) atrScore = 15;
    else if (atrPct < 1.5) atrScore = 10;
    else atrScore = 5;

    let adxScore = 0;
    if (lastADX < 20) adxScore = 20;
    else if (lastADX < 25) adxScore = 15;
    else if (lastADX < 30) adxScore = 10;
    else adxScore = 5;
    if (lastADX > 30) adxScore -= 10;

    let rangeScore = 0;
    const finalRangeWidthForScore = rangeWidthPct * 100;
    if (finalRangeWidthForScore > 5.0) rangeScore = 10; // Wider is more stable
    else if (finalRangeWidthForScore > 3.0) rangeScore = 8;
    else if (finalRangeWidthForScore > 1.5) rangeScore = 5;
    else rangeScore = 2;

    aprScore = Math.max(0, aprScore);
    volScore = Math.max(0, volScore);
    atrScore = Math.max(0, atrScore);
    adxScore = Math.max(0, adxScore);
    rangeScore = Math.max(0, rangeScore);

    const safetyScore = Math.max(0, Math.min(100, aprScore + volScore + atrScore + adxScore + rangeScore));

    let statusLabel = 'RISKY';
    let tradeRecommendation = 'RISKY';
    if (safetyScore >= 80) {
        statusLabel = 'Excellent LP conditions';
        tradeRecommendation = 'STRONG BUY';
    } else if (safetyScore >= 60) {
        statusLabel = 'Acceptable LP conditions';
        tradeRecommendation = 'MODERATE';
    } else {
        statusLabel = 'Risky LP environment';
        tradeRecommendation = 'RISKY';
    }

    const recommendedFee = bestPool ? (parseInt(bestPool.feeTier) / 10000).toFixed(2) + '%' : '0.30%';

    // Snap to tick logic would go here if we had the tick helper, 
    // but we use prices for recommendation display. Needs inversion if necessary.
    let finalMin = rangeMin;
    let finalMax = rangeMax;
    let finalStop = stopLoss;

    if (needsInversion) {
        finalMin = 1 / rangeMax;
        finalMax = 1 / rangeMin;
        finalStop = 1 / stopLoss;
    }

    const priceDropPct = (currentPriceBase - stopLoss) / currentPriceBase;
    const estimatedLossPct = priceDropPct * 100 * 0.6; // Using 60% exposure rule of thumb (50% base + IL)
    const expectedRewardPct = (context.adjustedAPR / 365 / 24) * estimatedTimeHours;
    const riskRewardRatio = estimatedLossPct > 0 && expectedRewardPct > 0 ? expectedRewardPct / estimatedLossPct : 0;

    const analysisResult = {
        mappedSymbol: displaySymbol,
        currentPrice: cleanClose,
        tvl: bestPool ? parseFloat(bestPool.totalValueLockedUSD) : 0,
        dailyVolume: bestPool?.poolDayData?.[0] ? parseFloat(bestPool.poolDayData[0].volumeUSD) : 0,
        volEfficiency: maxVolumeEfficiency,
        expectedFeeAPR: context.rawAPR,
        normalizedAPR: context.adjustedAPR,
        aprConfidence: context.aprConfidence,
        aprLabel: context.aprLabel,
        riskClassification: (lastADX > 30 || atrPct > 1.5) ? 'High Risk' : (lastADX < 20 && atrPct < 1.0) ? 'Low Risk' : 'Medium Risk',
        score: maxScore,
        safetyScore,
        marketRegime,
        statusLabel,
        tradeRecommendation,
        rangeMin: finalMin,
        rangeMax: finalMax,
        rangeWidthPct: rangeWidthPct * 100,
        estimatedTimeHours,
        stopLoss: finalStop,
        estimatedLossPct,
        riskRewardRatio,
        indicators: {
            regime: marketRegime,
            adx: lastADX,
            atr: lastATR,
            atrPct,
            volumeSpike,
            rsi: lastRSI
        },
        chartData: ohlcv.map(d => ({
            time: new Date(Number(d[0])).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            price: d[4],
            high: d[2],
            low: d[3],
            open: d[1]
        })).slice(-50), // Send last 50 candles for the chart
        recommendation: {
            feeTier: parseInt(selectedFeeTier),
            feeTierDisplay: recommendedFee,
            confidence: safetyScore,
            opportunityScore: maxScore,
            strategy: 'Single Optimal Range',
            stopLoss: finalStop
        },
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
        let chatId = undefined;
        if (!process.env.TEST_MODE) {
            const { data: settings } = await supabase.from('settings').select('key, value').in('key', ['telegram_chat_id', 'min_apr_threshold']);
            chatId = settings?.find(s => s.key === 'telegram_chat_id')?.value;
            const configMinApr = settings?.find(s => s.key === 'min_apr_threshold')?.value;
            if (configMinApr) minAprThreshold = parseFloat(configMinApr);
        }

        const formatPrice = (p: number) => p < 0.01 ? p.toFixed(8) : p.toFixed(4);

        // SIGNAL VALIDATION
        const currentRangePct = rangeWidthPct * 100;
        const isNotSafe = lastADX > 35 || atrPct > 2.0 || volumeSpike < 0.3 || context.adjustedAPR < 8;
        const isValid = safetyScore >= 70 && context.adjustedAPR >= minAprThreshold && currentRangePct >= 1.5 && currentRangePct <= 15 && !isNotSafe;
        
        // Ethereum Specific filter
        const isEthLowYield = pool.chainId === 1 && context.adjustedAPR < 40;

        if (isNotSafe || !isValid || isEthLowYield) {
            console.log(`[SIGNAL VALIDATION FAILED] ${displaySymbol} - Score: ${safetyScore}, APR: ${context.adjustedAPR.toFixed(2)}%, Range: ${currentRangePct.toFixed(2)}%`);
            
            if (isNotSafe) {
                const noTradeMessage = `⛔ *NO TRADE - MARKET CONDITIONS NOT SAFE*
                
Pair: \`${displaySymbol}\`
Chain: \`${pool.chainId === 42161 ? 'Arbitrum' : (pool.chainId === 8453 ? 'Base' : (pool.chainId === 10 ? 'Optimism' : 'Ethereum'))}\`

*Risk Profile:* \`${analysisResult.riskClassification}\`

*Failure Reasons:*
${lastADX > 35 ? `• Strong Trend (ADX: ${lastADX.toFixed(1)})\n` : ''}${atrPct > 2.0 ? `• High Volatility (ATR: ${atrPct.toFixed(2)}%)\n` : ''}${volumeSpike < 0.3 ? `• Low Activity (Vol Spike: ${volumeSpike.toFixed(2)}x)\n` : ''}${context.adjustedAPR < 8 ? `• Expected APR < 8% (${context.adjustedAPR.toFixed(2)}%)\n` : ''}

Market Regime: \`${marketRegime}\`
Recommendation: *Avoid entering positions that will quickly go out of range.*`;

                if (chatId) await sendNotification(chatId, noTradeMessage);

                if (!process.env.TEST_MODE) {
                    await supabase.from('signals').insert({
                        type: 'no_trade',
                        asset_pair: pool.symbol,
                        message: noTradeMessage,
                        data: { ...analysisResult, riskProfile }
                    });
                }
            } else if (context.adjustedAPR < minAprThreshold) {
                console.log(`LOW YIELD POOL: APR ${context.adjustedAPR.toFixed(2)}% below threshold ${minAprThreshold}%`);
            }
            return analysisResult;
        }

        const signalMessage = `
🚀 *LP ENTRY SIGNAL*

Pair: \`${displaySymbol}\`
Chain: \`${pool.chainId === 42161 ? 'Arbitrum' : (pool.chainId === 8453 ? 'Base' : (pool.chainId === 10 ? 'Optimism' : 'Ethereum'))}\`

Risk Profile: \`${analysisResult.riskClassification}\`

Current Price: \`${formatPrice(cleanClose)}\`

Recommended Range:
\`${formatPrice(finalMin)} - ${formatPrice(finalMax)}\`
Range Width: \`${currentRangePct.toFixed(2)}%\`
Est. Time in Range: \`~${estimatedTimeHours} hours\`

Lower Exit (Stop Loss):
\`${formatPrice(finalStop)}\`
Est. Loss at Stop: \`${estimatedLossPct.toFixed(2)}%\`
Risk/Reward Ratio: \`${riskRewardRatio.toFixed(2)}\`

Raw APR: \`${context.rawAPR.toFixed(2)}%\`
Adjusted APR: \`${context.adjustedAPR.toFixed(2)}%\`

APR Confidence: \`${context.aprConfidence}\`
${context.aprLabel === 'UNSTABLE APR' ? '⚠️ *UNSTABLE APR*\nYield metrics may be unreliable.' : ''}

LP Safety Score: \`${safetyScore}/100\`

Recommendation: *${tradeRecommendation}*

Market Regime: 
\`${marketRegime}\`
*${statusLabel}*

Diagnostics:
ATR: \`${atrPct.toFixed(2)}%\`
ADX: \`${lastADX.toFixed(1)}\`
Volume Spike: \`${volumeSpike.toFixed(1)}x\`

Recommendation:
*Open position and enable Swap to USDT on exit.*
      `;

        if (chatId) await sendNotification(chatId, signalMessage);

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
            const topPoolData = await fetchTopPools(chainId, 50, 1000000);
            const topPools = topPoolData
                .sort((a, b) => parseFloat(b.volumeUSD) - parseFloat(a.volumeUSD))
                .slice(0, 15)
                .map(p => ({ ...p, chainId }));
            allTopPairs.push(...topPools);
        } catch (error) {
            console.error(`Failed to fetch pools for chain ${chainId}`, error);
        }
    }

    const results: any[] = [];
    const batchSize = 3;
    for (let i = 0; i < allTopPairs.length; i += batchSize) {
        const batch = allTopPairs.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(async (pool) => {
            try {
                const analysis = await runAnalysis({
                    symbol: `${pool.token0.symbol}/${pool.token1.symbol}`,
                    chainId: pool.chainId,
                    poolAddress: pool.id
                }, riskProfile, true);

                if (analysis && analysis.safetyScore >= 60) {
                    return {
                        pool: analysis.mappedSymbol || `${pool.token0.symbol}/${pool.token1.symbol}`,
                        chainId: pool.chainId,
                        poolAddress: pool.id,
                        confidence: analysis.safetyScore,
                        analysis
                    };
                }
            } catch (e: any) {}
            return null;
        }));
        results.push(...batchResults.filter(r => r !== null));
    }

    const uniqueResults = new Map<string, any>();
    results.forEach(res => {
        const key = `${res.pool}-${res.chainId}`;
        if (!uniqueResults.has(key) || res.analysis.score > uniqueResults.get(key).analysis.score) {
            uniqueResults.set(key, res);
        }
    });

    const dedupedResults = Array.from(uniqueResults.values());
    const topOpportunities = dedupedResults
        .sort((a, b) => b.analysis.score - a.analysis.score)
        .slice(0, limit);

    if (topOpportunities.length > 0 && !process.env.TEST_MODE) {
        const dbInserts = topOpportunities.map((opp) => ({
            type: 'scan',
            asset_pair: opp.pool,
            message: `Market Scan Opportunity. Score: ${opp.analysis.score.toFixed(2)}. Regime: ${opp.analysis.marketRegime}`,
            data: { ...opp.analysis, chainId: opp.chainId, poolAddress: opp.poolAddress }
        }));
        await supabase.from('signals').insert(dbInserts);
    }

    return topOpportunities;
}
