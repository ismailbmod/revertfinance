
import { runAlphaSniper } from './alpha-sniper';
import { detectHighYieldPools } from './high-yield';
import { sendNotification } from './telegram';
import { supabase } from './supabase';

export async function runAutomatedAlphaScan() {
    console.log(`--- [CRON] Starting Automated Alpha Sniper Scan at ${new Date().toLocaleString()} ---`);
    
    const { data: telegramData } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();
    const chatId = telegramData?.value;
    if (!chatId) return;

    // Scan all main chains
    const chainIds = [1, 137, 10, 42161, 8453, 56];
    
    try {
        const opportunities = await runAlphaSniper(chainIds);
        
        // Filter for ELITE opportunities to avoid spamming
        const eliteOpps = opportunities.filter(o => (o.alphaScore || 0) >= 80);
        
        if (eliteOpps.length > 0) {
            console.log(`[CRON] Found ${eliteOpps.length} elite alpha opportunities!`);
            
            for (const opp of eliteOpps) {
                const message = `🚀 *ELITE ALPHA OPPORTUNITY DETECTED*\n\n` +
                    `Pair: \`${opp.pool}\`\n` +
                    `Chain: \`${opp.chainId}\`\n` +
                    `Alpha Score: \`${opp.alphaScore?.toFixed(1)}\` / 100\n` +
                    `Daily Yield: \`${(opp.expectedDailyYield * 100).toFixed(3)}%\`\n` +
                    `Regime: \`${opp.strategyType.join(', ')}\`\n\n` +
                    `Recommendation: \`${opp.recommendation}\`\n` +
                    `Confidence: \`${opp.confidence}\``;
                
                await sendNotification(chatId, message);
                
                // Track in signals table
                await supabase.from('signals').insert({
                    type: 'ALPHA_SNIPER',
                    asset_pair: opp.pool,
                    message: message,
                    data: opp,
                    is_active: true
                });
            }
        }
    } catch (error) {
        console.error('[CRON] Alpha Sniper automated scan failed:', error);
    }
}

export async function runAutomatedHighYieldScan() {
    console.log(`--- [CRON] Starting Automated High Yield Scan at ${new Date().toLocaleString()} ---`);
    
    const { data: telegramData } = await supabase.from('settings').select('value').eq('key', 'telegram_chat_id').single();
    const chatId = telegramData?.value;
    if (!chatId) return;

    const chainIds = [1, 137, 10, 42161, 8453, 56];
    
    try {
        const pools = await detectHighYieldPools(chainIds);
        
        // Only Tier 1/2 and yield > 0.4% daily
        const topPools = pools.filter(p => 
            p.expectedDailyYield >= 0.004 && 
            (p.yieldTier === 'Tier 1 - Extreme' || p.yieldTier === 'Tier 2 - Very High')
        );

        if (topPools.length > 0) {
            console.log(`[CRON] Found ${topPools.length} high yield opportunities!`);
            
            for (const p of topPools) {
                const message = `💎 *HIGH YIELD SCANNER*\n\n` +
                    `Pair: \`${p.symbol}\`\n` +
                    `Yield Tier: \`${p.yieldTier}\`\n` +
                    `Daily Yield: \`${(p.expectedDailyYield * 100).toFixed(2)}%\`\n` +
                    `Projected APR: \`${p.expectedAPR.toFixed(0)}%\`\n` +
                    `TVL: \`$${(p.tvl / 1000000).toFixed(2)}M\`\n\n` +
                    `⚠️ *High risk, check range efficiency before entry.*`;
                
                await sendNotification(chatId, message);

                await supabase.from('signals').insert({
                    type: 'HIGH_YIELD',
                    asset_pair: p.symbol,
                    message: message,
                    data: p,
                    is_active: true
                });
            }
        }
    } catch (error) {
        console.error('[CRON] High Yield automated scan failed:', error);
    }
}
