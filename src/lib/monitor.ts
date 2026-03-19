import { supabase } from './supabase';
import { fetchPositionsByOwner, SUPPORTED_CHAINS, tickToPrice } from './subgraph';
import { calculateLPValue, simulateImpermanentLoss, estimateGasEfficiency } from './lp-math';
import { sendNotification } from './telegram';
import { runAnalysis } from './bot-engine';

const chainNames: Record<number, string> = {
    1: 'Ethereum', 137: 'Polygon', 10: 'Optimism', 42161: 'Arbitrum', 8453: 'Base', 56: 'BNB'
};

async function getPrices() {
    const prices: Record<string, number> = { 'ETH': 2500, 'BTC': 65000 };
    try {
        const ccxt = require('ccxt');
        const exchange = new ccxt.binance();
        const tickers = await exchange.fetchTickers(['ETH/USDT', 'BTC/USDT']);
        prices['ETH'] = tickers['ETH/USDT']?.last || 2500;
        prices['BTC'] = tickers['BTC/USDT']?.last || 65000;
    } catch (e) {
        console.error('Failed to fetch prices for LP valuation in monitor.');
    }
    return prices;
}

export async function monitorPositions() {
    console.log(`--- Advanced LP Monitor Started at ${new Date().toLocaleString()} ---`);

    const { data: walletData } = await supabase.from('settings').select('value').eq('key', 'wallets').single();
    const { data: telegramData } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();

    const wallets: string[] = walletData?.value || [];
    const chatId = telegramData?.value;

    if (wallets.length === 0 || !chatId) {
        console.log('Missing wallets or telegram_chat_id in settings.');
        return;
    }

    const prices = await getPrices();
    let analyzedPositions: any[] = [];

    // 1. Process and score all positions
    for (const wallet of wallets) {
        for (const chainId of SUPPORTED_CHAINS) {
            try {
                const positions = await fetchPositionsByOwner(wallet, chainId);

                for (const pos of positions) {
                    const getTickIdx = (t: any) => (typeof t === 'object' && t !== null) ? t.tickIdx : t;
                    const tickLower = parseInt(getTickIdx(pos.tickLower));
                    const tickUpper = parseInt(getTickIdx(pos.tickUpper));
                    const currentTick = parseInt(pos.pool.tick);

                    const pMin = tickToPrice(tickLower, parseInt(pos.pool.token0.decimals), parseInt(pos.pool.token1.decimals));
                    const pMax = tickToPrice(tickUpper, parseInt(pos.pool.token0.decimals), parseInt(pos.pool.token1.decimals));
                    const currentPrice = tickToPrice(currentTick, parseInt(pos.pool.token0.decimals), parseInt(pos.pool.token1.decimals));

                    const poolTVL = parseFloat(pos.pool.totalValueLockedUSD);
                    const poolVol24h = pos.pool.poolDayData?.[0] ? parseFloat(pos.pool.poolDayData[0].volumeUSD) : 0;
                    const feeTier = parseInt(pos.pool.feeTier) / 1000000;

                    // Range checks
                    const rangeWidth = Math.abs(pMax - pMin);
                    const distanceToLower = rangeWidth > 0 ? (currentPrice - pMin) / rangeWidth : 0;
                    const distanceToUpper = rangeWidth > 0 ? (pMax - currentPrice) / rangeWidth : 0;

                    const valuation = calculateLPValue(pos, prices);
                    const positionValueUSD = valuation.totalUSD;

                    // Fetch existing DB record
                    const { data: existingRecord } = await supabase
                        .from('positions')
                        .select('last_alert_type')
                        .eq('nft_id', pos.id)
                        .eq('chain_id', chainId)
                        .single();

                    const lastAlertType = existingRecord?.last_alert_type || null;

                    // Sync position to DB
                    await supabase.from('positions').upsert({
                        nft_id: pos.id,
                        chain_id: chainId,
                        owner_address: pos.owner,
                        pool_address: pos.pool.id,
                        token0: pos.pool.token0.symbol,
                        token1: pos.pool.token1.symbol,
                        fee_tier: parseInt(pos.pool.feeTier),
                        range_min: pMin,
                        range_max: pMax,
                        status: currentTick < tickLower || currentTick > tickUpper ? 'Out of Range' : 'In Range',
                        created_at: new Date().toISOString()
                    }, { onConflict: 'chain_id,nft_id' });

                    analyzedPositions.push({
                        raw: pos,
                        chainId,
                        wallet,
                        pair: `${pos.pool.token0.symbol}/${pos.pool.token1.symbol}`,
                        feeTier: parseInt(pos.pool.feeTier),
                        pMin, pMax, currentPrice,
                        currentTick, tickLower, tickUpper,
                        poolTVL, poolVol24h, positionValueUSD,
                        distanceToLower, distanceToUpper,
                        lastAlertType
                    });
                }
            } catch (err: any) {
                console.error(`Error checking ${chainNames[chainId]}:`, err.message);
            }
        }
    }

    // 2. Evaluate Signals
    for (const ap of analyzedPositions) {
        let signalData: { type: string, message: string } | null = null;

        // Fetch deep market analysis for regime and volatility
        let analysis = null;
        try {
            analysis = await runAnalysis({
                symbol: ap.pair,
                chainId: ap.chainId,
                poolAddress: ap.raw.pool.id
            }, 'moderate', true);
        } catch (e) {}

        if (!analysis) continue;

        const isOutOfRange = ap.currentTick < ap.tickLower || ap.currentTick > ap.tickUpper;
        const isNearBoundary = ap.distanceToLower < 0.1 || ap.distanceToUpper < 0.1;

        // Signal Logic Hierarchy
        if (analysis.marketRegime.includes('Dangerous')) {
            signalData = {
                type: 'VOLATILITY_WARNING',
                message: `⚠️ *MARKET VOLATILITY ALERT*\n\nPair: \`${ap.pair}\`\n\nATR: \`${analysis.indicators.atrPct.toFixed(2)}%\`\nADX: \`${analysis.indicators.adx.toFixed(1)}\`\nVolume Spike: \`${analysis.indicators.volumeSpike.toFixed(1)}x\`\n\nMarket Regime:\n\`${analysis.marketRegime}\`\n\nRecommendation:\n*Close LP positions*\n*Avoid new LP until volatility decreases.*`
            };
        } else if (isOutOfRange) {
            signalData = {
                type: 'OUT_OF_RANGE',
                message: `🚨 *OUT OF RANGE ALERT*\n\nPair: \`${ap.pair}\` on \`${chainNames[ap.chainId]}\`\n\nPrice: \`${ap.currentPrice.toFixed(4)}\` is outside range \`${ap.pMin.toFixed(4)} - ${ap.pMax.toFixed(4)}\`.\n\nRecommendation:\n*Close position and consider new optimal range entry.*`
            };
        } else if (isNearBoundary) {
            signalData = {
                type: 'REBALANCE_SUGGESTION',
                message: `⚖️ *REBALANCE SUGGESTION*\n\nPair: \`${ap.pair}\`\n\nPrice approaching range boundary.\n\nRecommendation:\n*Consider repositioning range if strong trend continues.*`
            };
        }

        // Send Alert if state changed
        if (signalData && signalData.type !== ap.lastAlertType) {
            await sendNotification(chatId, signalData.message);
            console.log(`[Signal Sent] ${signalData.type} for ${ap.pair}`);

            await supabase.from('positions')
                .update({ last_alert_type: signalData.type })
                .eq('nft_id', ap.raw.id)
                .eq('chain_id', ap.chainId);
        }
    }

    console.log('--- Advanced LP Monitor Finished ---');
}
