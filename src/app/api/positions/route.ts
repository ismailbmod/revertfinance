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

        // Fetch ETH Price for valuation
        let ethPrice = 2000;
        try {
            const exchange = new ccxt.binance();
            const ticker = await exchange.fetchTicker('ETH/USDT');
            ethPrice = ticker.last || 2000;
        } catch (e) {
            console.error('Failed to fetch eth price for LP valuation');
        }

        const allPositions: any[] = [];
        const chainNames: Record<number, string> = {
            1: 'Ethereum', 137: 'Polygon', 10: 'Optimism', 42161: 'Arbitrum', 8453: 'Base'
        };

        for (const wallet of wallets) {
            const chainPromises = SUPPORTED_CHAINS.map(async (chainId) => {
                const positions = await fetchPositionsByOwner(wallet, chainId);
                return positions.map(pos => {
                    const valuation = calculateLPValue(pos, ethPrice);

                    // IL Calculation: (Current Value - HODL Value)
                    const dep0 = parseFloat(pos.depositedToken0) / Math.pow(10, parseInt(pos.pool.token0.decimals));
                    const dep1 = parseFloat(pos.depositedToken1) / Math.pow(10, parseInt(pos.pool.token1.decimals));
                    const hodlValue = (dep0 * valuation.p0) + (dep1 * valuation.p1);
                    const il = valuation.totalUSD - hodlValue;

                    // Fees Calculation
                    const fees0 = parseFloat(pos.collectedFeesToken0) / Math.pow(10, parseInt(pos.pool.token0.decimals));
                    const fees1 = parseFloat(pos.collectedFeesToken1) / Math.pow(10, parseInt(pos.pool.token1.decimals));
                    const feesUSD = (fees0 * valuation.p0) + (fees1 * valuation.p1);

                    const netProfit = il + feesUSD;
                    const { status } = calculateHealth(pos);

                    return {
                        id: `${chainId}-${pos.id}`,
                        pair: `${pos.pool.token0.symbol}/${pos.pool.token1.symbol}`,
                        range: `$${tickToPrice(parseInt(pos.tickLower.tickIdx), parseInt(pos.pool.token0.decimals), parseInt(pos.pool.token1.decimals)).toFixed(2)} - $${tickToPrice(parseInt(pos.tickUpper.tickIdx), parseInt(pos.pool.token0.decimals), parseInt(pos.pool.token1.decimals)).toFixed(2)}`,
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
                });
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
