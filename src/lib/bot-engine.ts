import ccxt from 'ccxt';
import { calculateEMA, calculateATR, calculateADX, detectRegime } from './indicators';
import { supabase } from './supabase';
import { sendNotification } from './telegram';
import { fetchPoolsByPair } from './subgraph';

export interface PoolConfig {
    symbol: string; // e.g., 'ZEC/USDT'
    chainId: number;
    poolAddress: string;
}

async function normalizeSymbol(exchange: any, symbol: string): Promise<string | null> {
    const markets = await exchange.loadMarkets();
    const commonVariants = [
        symbol,
        symbol.replace('WETH', 'ETH').replace('WBTC', 'BTC'),
        symbol.split('/').reverse().join('/'),
        symbol.split('/').reverse().join('/').replace('WETH', 'ETH').replace('WBTC', 'BTC'),
    ];

    for (const variant of commonVariants) {
        if (markets[variant]) return variant;
    }
    return null;
}

export async function runAnalysis(pool: PoolConfig, riskProfile: 'risky' | 'medium' | 'moderate') {
    const exchange = new ccxt.binance();

    // 1. Normalize Symbol for Binance
    const normalizedSymbol = await normalizeSymbol(exchange, pool.symbol);
    if (!normalizedSymbol) {
        throw new Error(`Symbol ${pool.symbol} not found on Binance`);
    }

    const cacheKey = `${normalizedSymbol}-${riskProfile}`;

    // 2. Check Cache (1-hour TTL)
    try {
        const { data: cache } = await supabase
            .from('market_data_cache')
            .select('*')
            .eq('symbol', cacheKey)
            .single();

        if (cache && (new Date().getTime() - new Date(cache.updated_at).getTime() < 3600000)) {
            console.log(`Using cached analysis for ${cacheKey}`);
            return cache.data;
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
    const { adx } = calculateADX(highs, lows, closes, 14);
    const atr = calculateATR(highs, lows, closes, 14);

    const lastEMA20 = ema20[ema20.length - 1];
    const lastEMA50 = ema50[ema50.length - 1];
    const lastADX = adx[adx.length - 1];
    const lastATR = atr[atr.length - 1];

    // 5. Detect Regime & Calculate Granular K-Factor (Professional MM Logic)
    const regime = detectRegime(lastEMA20, lastEMA50, lastADX);

    // ChatGPT/MM Logic for K based on ADX
    let k = 1.0;
    if (lastADX < 20) k = 1.0;
    else if (lastADX < 30) k = 1.5;
    else if (lastADX < 40) k = 2.0;
    else k = 2.5;

    // Adjust based on User Risk Profile
    if (riskProfile === 'risky') k *= 0.8;
    if (riskProfile === 'moderate') k *= 1.2;

    const rangeWidth = k * lastATR;
    const rangeMin = currentPrice - rangeWidth / 2;
    const rangeMax = currentPrice + rangeWidth / 2;

    const needsInversion = normalizedSymbol.split('/')[0] !== pool.symbol.split('/')[0] && !normalizedSymbol.includes(pool.symbol.split('/')[0].replace('WETH', 'ETH'));
    const cleanClose = needsInversion ? 1 / currentPrice : currentPrice;

    // 6. Pool Scoring & Selection (Weighted Professional Logic)
    const [t0, t1] = pool.symbol.split('/');
    const pools = await fetchPoolsByPair(t0, t1, pool.chainId);

    let bestPool = pools[0];
    let maxScore = 0;

    pools.forEach(p => {
        const vol = parseFloat(p.volumeUSD);
        const tvl = parseFloat(p.totalValueLockedUSD);

        // Efficiency Score: (Volume / TVL) - Higher is better
        const efficiency = tvl > 0 ? vol / tvl : 0;

        // TVL Depth Score: Reward deeper liquidity for stability (normalized)
        const depth = Math.log10(tvl + 1) / 10;

        // Fee Tier Weight: Reward higher fees but only if volume is there
        const feeTierBase = parseInt(p.feeTier) / 10000;

        // Weighted Score Formula: 60% Efficiency, 30% Fee Tier, 10% Depth
        const score = (0.6 * efficiency) + (0.3 * feeTierBase) + (0.1 * depth);

        if (score > maxScore) {
            maxScore = score;
            bestPool = p;
        }
    });

    const recommendedFee = bestPool ? (parseInt(bestPool.feeTier) / 10000).toFixed(2) + '%' : '0.30%';

    // 7. Calculate Market Maker Confidence
    const confidence = Math.min(99, Math.round(
        (lastADX > 25 ? 40 : 20) +
        (k * 20) -
        (Math.abs(lastEMA20 - lastEMA50) / currentPrice * 100)
    ));

    const analysisResult = {
        currentPrice: cleanClose,
        rangeMin,
        rangeMax,
        regime,
        lastADX,
        lastATR,
        recommendedFee,
        confidence,
        timestamp: new Date().toISOString()
    };

    // 8. Update Cache
    await supabase.from('market_data_cache').upsert({
        symbol: cacheKey,
        price: cleanClose,
        volatility_7d: lastATR,
        data: analysisResult,
        updated_at: new Date().toISOString()
    });

    // 9. Store Analysis & Send Notification
    const { data: settings } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();
    const chatId = settings?.value;

    const signalMessage = `
🚀 *MM ANALYSIS: ${pool.symbol}*
Regime: \`${regime.toUpperCase()}\`
Price: \`$${cleanClose.toFixed(4)}\`
ADX: \`${lastADX.toFixed(2)}\` | ATR: \`${lastATR.toFixed(2)}\`

📍 *Professional LP Range:*
MIN: \`$${rangeMin.toFixed(4)}\`
MAX: \`$${rangeMax.toFixed(4)}\`

💎 *Recommended Fee Tier:* \`${recommendedFee}\`
📊 *Bot Confidence:* \`${confidence}%\`
Strategy: \`${riskProfile.toUpperCase()}\` (${k.toFixed(1)}x ATR)
  `;

    if (chatId) {
        await sendNotification(chatId, signalMessage);
    }

    // Save to DB
    await supabase.from('signals').insert({
        type: 'entry',
        asset_pair: pool.symbol,
        message: signalMessage,
        data: { ...analysisResult, riskProfile }
    });

    return analysisResult;
}
