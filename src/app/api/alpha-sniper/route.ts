import { NextResponse } from 'next/server';
import { runAlphaSniper } from '@/lib/alpha-sniper';

export async function POST(req: Request) {
    try {
        const chainIdsToScan = [1, 8453, 42161, 10, 137, 56]; // ETH, Base, Arb, Op, Poly, BNB
        const opportunities = await runAlphaSniper(chainIdsToScan);
        
        // Summary for debugging
        const scanSummary = {
            totalScan: opportunities.length,
            targetChains: chainIdsToScan.length,
            time: new Date().toISOString()
        };

        return NextResponse.json({
            success: true,
            opportunities,
            summary: scanSummary,
            timestamp: scanSummary.time
        });
    } catch (error: any) {
        console.error('Alpha Sniper API Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
