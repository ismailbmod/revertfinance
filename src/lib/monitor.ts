
import { supabase } from './supabase';
import { fetchPositionsByOwner, SUPPORTED_CHAINS, tickToPrice } from './subgraph';
import { calculateHealth } from './lp-math';
import { sendNotification } from './telegram';
import { runAnalysis } from './bot-engine';

const chainNames: Record<number, string> = {
    1: 'Ethereum', 137: 'Polygon', 10: 'Optimism', 42161: 'Arbitrum', 8453: 'Base'
};

async function syncPosition(pos: any, chainId: number, status: string) {
    const tickLower = parseInt(pos.tickLower.tickIdx);
    const tickUpper = parseInt(pos.tickUpper.tickIdx);
    const pMin = tickToPrice(tickLower, parseInt(pos.pool.token0.decimals), parseInt(pos.pool.token1.decimals));
    const pMax = tickToPrice(tickUpper, parseInt(pos.pool.token0.decimals), parseInt(pos.pool.token1.decimals));

    const { error } = await supabase.from('positions').upsert({
        nft_id: pos.id,
        chain_id: chainId,
        owner_address: pos.owner,
        pool_address: pos.pool.id,
        token0: pos.pool.token0.symbol,
        token1: pos.pool.token1.symbol,
        fee_tier: parseInt(pos.pool.feeTier),
        range_min: pMin,
        range_max: pMax,
        status: status,
        created_at: new Date().toISOString()
    }, { onConflict: 'chain_id,nft_id' });

    if (error) console.error(`  Failed to sync position ${pos.id} on chain ${chainId}:`, error.message);
}

export async function monitorPositions() {
    console.log(`--- LP Health Monitor Started at ${new Date().toLocaleString()} ---`);

    // 1. Get Wallet Settings
    const { data: walletData } = await supabase.from('settings').select('value').eq('key', 'wallets').single();
    const { data: telegramData } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();

    const wallets: string[] = walletData?.value || [];
    const chatId = telegramData?.value;

    if (wallets.length === 0 || !chatId) {
        console.log('Missing wallets or telegram_chat_id in settings.');
        return;
    }

    for (const wallet of wallets) {
        console.log(`Checking wallet: ${wallet}`);

        for (const chainId of SUPPORTED_CHAINS) {
            try {
                const positions = await fetchPositionsByOwner(wallet, chainId);

                for (const pos of positions) {
                    const pair = `${pos.pool.token0.symbol}/${pos.pool.token1.symbol}`;
                    const { status, positionRatio } = calculateHealth(pos);

                    console.log(`  [${chainNames[chainId]}] ${pair}: ${status} (Ratio: ${positionRatio.toFixed(2)})`);

                    // Sync to DB
                    await syncPosition(pos, chainId, status);

                    if (status !== 'In Range') {
                        const alertEmoji = status === 'Out of Range' ? '🚨' : '⚠️';

                        // Perform Market Analysis for better advice
                        let advice = '';
                        try {
                            const analysis = await runAnalysis({
                                symbol: pair,
                                chainId: chainId,
                                poolAddress: pos.pool.id
                            }, 'moderate');

                            advice = `\n\n🎯 *MM Recommended Strategy:*
Regime: \`${analysis.regime.toUpperCase()}\`
ADX: \`${analysis.lastADX.toFixed(1)}\` (Trend Strength)
Rec. Range: \`$${analysis.rangeMin.toFixed(2)} - $${analysis.rangeMax.toFixed(2)}\`
Confidence: \`${analysis.confidence}%\``;
                        } catch (e: any) {
                            console.error(`Analysis failed for ${pair}:`, e.message);
                            advice = '\n\n💡 *Action Needed:* Please check the dashboard to optimize your range.';
                        }

                        const message = `${alertEmoji} *LP ALERT: ${pair}*\n` +
                            `Chain: \`${chainNames[chainId]}\`\n` +
                            `Status: *${status.toUpperCase()}*\n` +
                            `Ratio: \`${(positionRatio * 100).toFixed(1)}%\` of range` +
                            advice;

                        await sendNotification(chatId, message);
                        console.log(`    Alert sent for ${pair}`);
                    }
                }
            } catch (err: any) {
                console.error(`Error checking ${chainNames[chainId]}:`, err.message);
            }
        }
    }

    console.log('--- LP Health Monitor Finished ---');
}
