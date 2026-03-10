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

    // Store all valid positions to compute capital efficiency Later
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

                    // Core Derived Metrics
                    const rangeUtilization = tickUpper === tickLower ? 0 : (currentTick - tickLower) / (tickUpper - tickLower);
                    const rangeWidth = Math.abs(pMax - pMin);
                    const distanceToLower = rangeWidth > 0 ? (currentPrice - pMin) / rangeWidth : 0;
                    const distanceToUpper = rangeWidth > 0 ? (pMax - currentPrice) / rangeWidth : 0;

                    const volumeTVLRatio = poolTVL > 0 ? poolVol24h / poolTVL : 0;
                    const expectedDailyYield = poolTVL > 0 ? (poolVol24h * feeTier) / poolTVL : 0;

                    const valuation = calculateLPValue(pos, prices);
                    const positionValueUSD = valuation.totalUSD;

                    // Safety Checks (TVL > $3M, Vol > $1M/day)
                    const passesSafetyChecks = poolTVL >= 3000000 && poolVol24h >= 1000000;

                    // Compute Score (ExpectedDailyYield * VolumeTVLRatio * RangeUtilization)
                    // Note: User formula uses RangeUtilization directly. For scoring, a value closer to 1 (top of range) gives max score.
                    // We will use min(1, max(0.001, RangeUtilization)) to prevent 0 scores.
                    const safeUtil = Math.max(0.001, Math.min(1, Math.abs(rangeUtilization)));
                    const score = expectedDailyYield * volumeTVLRatio * safeUtil;

                    // Fetch existing DB record to get last_alert_type
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
                        rangeUtilization, distanceToLower, distanceToUpper,
                        volumeTVLRatio, expectedDailyYield, score,
                        passesSafetyChecks, lastAlertType
                    });
                }
            } catch (err: any) {
                console.error(`Error checking ${chainNames[chainId]}:`, err.message);
            }
        }
    }

    // 2. Evaluate Signals for each position
    for (let i = 0; i < analyzedPositions.length; i++) {
        const ap = analyzedPositions[i];

        let signalConfig: any = null; // { type, action, ... }

        // Gas check
        const gasCostPct = estimateGasEfficiency(ap.positionValueUSD, ap.chainId);
        const isGasSafe = gasCostPct <= 5; // Gas < 5% of position value

        // Is it Out of Range?
        const isOutOfRange = ap.currentTick < ap.tickLower || ap.currentTick > ap.tickUpper;

        if (!ap.passesSafetyChecks) {
            console.log(`[Skip] ${ap.pair}: Fails TVL/Vol Safety Checks (TVL: $${ap.poolTVL.toFixed(0)}, Vol: $${ap.poolVol24h.toFixed(0)})`);
            continue;
        }

        // --- OUT OF RANGE SIGNAL ---
        if (isOutOfRange) {
            // IL risk for 10% move
            const ilRisk = simulateImpermanentLoss(ap.pMin, ap.pMax, 0.10);
            const riskLabel = ilRisk < -5 ? 'HIGH RISK' : 'MODERATE RISK';
            signalConfig = {
                type: 'OUT_OF_RANGE',
                action: 'CLOSE',
                notes: `Position is OUT OF RANGE. IL Risk on a 10% move is ${ilRisk.toFixed(2)}% (${riskLabel}). Close position and redeploy liquidity.`,
                analysisData: null
            };
        }
        // --- ADD LIQUIDITY SIGNAL ---
        else if (ap.volumeTVLRatio > 0.8 && ap.expectedDailyYield > 0.003 && ap.rangeUtilization >= 0.35 && ap.rangeUtilization <= 0.65) {
            signalConfig = {
                type: 'ADD_LIQUIDITY',
                action: 'ADD LIQUIDITY',
                notes: `Pool is currently highly efficient. Perfect range utilization.`,
                analysisData: null
            };
        }
        // --- MOVE RANGE SIGNAL ---
        else if ((ap.rangeUtilization < 0.20 || ap.rangeUtilization > 0.80) && isGasSafe) {
            // Fetch analysis for ATR ranges
            let analysisData = null;
            try {
                analysisData = await runAnalysis({
                    symbol: ap.pair,
                    chainId: ap.chainId,
                    poolAddress: ap.raw.pool.id
                }, 'moderate', true);
            } catch (e) { }

            if (analysisData) {
                signalConfig = {
                    type: 'MOVE_RANGE',
                    action: 'MOVE RANGE',
                    notes: `Price approaching edge of LP range. Market Regime: ${analysisData.regime?.toUpperCase() || 'UNKNOWN'}. ADX: ${analysisData.lastADX?.toFixed(1) || 'N/A'}.`,
                    analysisData: analysisData
                };
            }
        }
        // --- LOW PERFORMANCE SIGNAL ---
        else if (ap.expectedDailyYield < 0.0005 && ap.volumeTVLRatio < 0.1) {
            signalConfig = {
                type: 'LOW_PERFORMANCE',
                action: 'CLOSE',
                notes: `Low Performance detected. Recommend moving capital to better pools.`,
                analysisData: null
            };
        }
        // --- BETTER POOL FOUND SIGNAL (Capital Efficiency Check) ---
        else if (isGasSafe) {
            // Find if there is a pool with 2x the score
            const betterPool = analyzedPositions.find(other => other.score > (ap.score * 2) && other.passesSafetyChecks && other.raw.id !== ap.raw.id);
            if (betterPool) {
                signalConfig = {
                    type: 'BETTER_POOL',
                    action: 'CLOSE',
                    notes: `Capital efficiency alert. A much better pool (${betterPool.pair} on ${chainNames[betterPool.chainId]}) is offering a 2x higher score. Recommend capital migration.`,
                    analysisData: null
                };
            }
        }

        // 3. Send Telegram Alert if state changed
        if (signalConfig && signalConfig.type !== ap.lastAlertType) {
            // Format New Ranges if any
            let rangesStr = 'N/A';
            let confStr = 'N/A';

            if (signalConfig.analysisData) {
                const a = signalConfig.analysisData;

                // K-logic based on user rules is already embedded in the bot-engine generally, but we'll apply the specific math requested.
                // Assuming we have lastATR.
                const atr = a.lastATR || (ap.currentPrice * 0.05); // fallback 5% ATR
                const isStable = ['USDC', 'USDT', 'DAI'].some(s => ap.pair.includes(s)) && ap.pair.includes('USD');
                // Basic correlated check
                const isCorrelated = ['ETH', 'BTC', 'WETH', 'WBTC'].includes(ap.pair.split('/')[0]) && ['ETH', 'BTC', 'WETH', 'WBTC'].includes(ap.pair.split('/')[1]);

                let K = 3.0;
                if (isStable) K = 0.5;
                else if (isCorrelated) K = 1.5;

                const rWidth = atr * K;
                const tightR = [ap.currentPrice - (0.5 * rWidth), ap.currentPrice + (0.5 * rWidth)];
                const medR = [ap.currentPrice - (1.0 * rWidth), ap.currentPrice + (1.0 * rWidth)];
                const wideR = [ap.currentPrice - (1.5 * rWidth), ap.currentPrice + (1.5 * rWidth)];

                rangesStr = `\nTight: \`$${tightR[0].toFixed(2)} - $${tightR[1].toFixed(2)}\`\n` +
                    `Medium: \`$${medR[0].toFixed(2)} - $${medR[1].toFixed(2)}\`\n` +
                    `Wide: \`$${wideR[0].toFixed(2)} - $${wideR[1].toFixed(2)}\``;
                confStr = `${a.score ? a.score.toFixed(1) : 0}%`;
            }

            const message = `🚨 *LP POSITION ALERT*\n\n` +
                `Pair: \`${ap.pair}\`\n` +
                `Chain: \`${chainNames[ap.chainId] || ap.chainId}\`\n` +
                `Pool Fee: \`${ap.feeTier / 10000}%\`\n\n` +
                `Current Price: \`$${ap.currentPrice.toFixed(4)}\`\n` +
                `Range: \`$${ap.pMin.toFixed(4)} - $${ap.pMax.toFixed(4)}\`\n\n` +
                `Range Utilization: \`${(ap.rangeUtilization * 100).toFixed(1)}%\`\n\n` +
                `Daily Yield Estimate: \`${(ap.expectedDailyYield * 100).toFixed(3)}%\`\n` +
                `Volume/TVL: \`${(ap.volumeTVLRatio).toFixed(3)}\`\n\n` +
                `Suggested Action:\n*${signalConfig.action}*\n\n` +
                `New Suggested Ranges:${rangesStr}\n\n` +
                `Confidence Score: \`${confStr}\`\n\n` +
                `Strategy Notes:\n_${signalConfig.notes}_`;

            await sendNotification(chatId, message);
            console.log(`[Signal Sent] ${signalConfig.type} for ${ap.pair}`);

            // Update Database State
            const { error } = await supabase.from('positions')
                .update({ last_alert_type: signalConfig.type })
                .eq('nft_id', ap.raw.id)
                .eq('chain_id', ap.chainId);

            if (error) {
                console.error(`Failed to update last_alert_type for ${ap.raw.id}:`, error.message);
            }
        }
    }

    console.log('--- Advanced LP Monitor Finished ---');
}
