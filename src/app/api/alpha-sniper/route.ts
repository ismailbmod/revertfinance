import { NextResponse } from 'next/server';
import { runAlphaSniper } from '@/lib/alpha-sniper';

export async function POST(req: Request) {
    try {
        const chainIdsToScan = [1, 8453, 42161, 10, 137]; // ETH, Base, Arb, Op, Poly
        const opportunities = await runAlphaSniper(chainIdsToScan);

        return NextResponse.json({
            success: true,
            opportunities,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('Alpha Sniper API Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
