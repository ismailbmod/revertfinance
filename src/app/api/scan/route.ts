import { NextResponse } from 'next/server';
import { scanMarket } from '@/lib/bot-engine';

export async function POST(req: Request) {
    try {
        const { riskProfile, limit } = await req.json();

        if (!riskProfile) {
            return NextResponse.json({ error: 'Missing riskProfile' }, { status: 400 });
        }

        // Scan all supported networks
        const chainIdsToScan = [1, 137, 10, 42161, 8453];
        const topopportunities = await scanMarket(chainIdsToScan, riskProfile, limit || 3);

        return NextResponse.json({ success: true, topopportunities });
    } catch (error: any) {
        console.error('Market scan failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
