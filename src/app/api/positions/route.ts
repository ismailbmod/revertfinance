import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchPositionsByOwner, tickToPrice, SUPPORTED_CHAINS } from '@/lib/subgraph';
import { calculateEstimatedAPR, calculateLPValue, calculateHealth } from '@/lib/lp-math';
import ccxt from 'ccxt';

export async function GET() {
    try {
        const { data: settings } = await supabase.from('settings').select('value').eq('key', 'wallets').single();
        const wallets: string[] = settings?.value || [];

        if (wallets.length === 0) return NextResponse.json([]);

        // Fetch Prices for valuation
        const prices: Record<string, number> = { 'ETH': 2500, 'BTC': 65000 };
        try {
            const exchange = new ccxt.binance();
            const tickers = await exchange.fetchTickers(['ETH/USDT', 'BTC/USDT']);
            prices['ETH'] = tickers['ETH/USDT']?.last || 2500;
            prices['BTC'] = tickers['BTC/USDT']?.last || 65000;
        } catch (e) {
            console.error('Failed to fetch prices for LP valuation');
        }

        const allPositions: any[] = [];
        const chainNames: Record<number, string> = {
            1: 'Ethereum', 137: 'Polygon', 10: 'Optimism', 42161: 'Arbitrum', 8453: 'Base', 56: 'BNB'
        };

        for (const wallet of wallets) {
            const chainPromises = SUPPORTED_CHAINS.map(async (chainId) => {
                try {
                    const positions = await fetchPositionsByOwner(wallet, chainId);
                    const results = positions.map(pos => {
                        const valuation = calculateLPValue(pos, prices);

                        const getTickIdx = (t: any) => typeof t === 'object' ? t?.tickIdx : t;
                        const tLower = parseInt(getTickIdx(pos.tickLower));
                        const tUpper = parseInt(getTickIdx(pos.tickUpper));

                        const parseAmount = (amt: string, decimals: number) => {
                            if (!amt) return 0;
                            // If it contains a dot, it's likely already pre-formatted by this specific subgraph
                            if (amt.includes('.')) return parseFloat(amt);
                            // Otherwise it's a raw integer amount
                            return parseFloat(amt) / Math.pow(10, decimals);
                        };

                        // IL Calculation: (Current Value - HODL Value)
                        const dep0 = parseAmount(pos.depositedToken0, parseInt(pos.pool.token0.decimals));
                        const dep1 = parseAmount(pos.depositedToken1, parseInt(pos.pool.token1.decimals));
                        const hodlValue = (dep0 * valuation.p0) + (dep1 * valuation.p1);
                        const il = valuation.totalUSD - hodlValue;

                        // Fees Calculation
                        const fees0 = parseAmount(pos.collectedFeesToken0, parseInt(pos.pool.token0.decimals));
                        const fees1 = parseAmount(pos.collectedFeesToken1, parseInt(pos.pool.token1.decimals));
                        const feesUSD = (fees0 * valuation.p0) + (fees1 * valuation.p1);

                        const netProfit = il + feesUSD;
                        const { status } = calculateHealth(pos);

                        return {
                            id: `${chainId}-${pos.id}`,
                            pair: `${pos.pool.token0.symbol}/${pos.pool.token1.symbol}`,
                            range: `$${tickToPrice(tLower, parseInt(pos.pool.token0.decimals), parseInt(pos.pool.token1.decimals)).toFixed(2)} - $${tickToPrice(tUpper, parseInt(pos.pool.token0.decimals), parseInt(pos.pool.token1.decimals)).toFixed(2)}`,
                            apr: calculateEstimatedAPR(pos),
                            valueUSD: valuation.totalUSD,
                            ilUSD: il,
                            feesUSD: feesUSD,
                            netProfitUSD: netProfit,
                            status: status,
                            chainId: chainId,
                            chainName: chainNames[chainId] || 'Unknown',
                            poolAddress: pos.pool.id
                        };
                    }).filter(p => p !== null);
                    return results;
                } catch (err) {
                    console.error(`[API] Error on chain ${chainId}:`, err);
                    return [];
                }
            });

            const results = await Promise.all(chainPromises);
            allPositions.push(...results.flat());
        }

        return NextResponse.json(allPositions);
    } catch (error: any) {
        console.error('Failed to fetch positions:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
