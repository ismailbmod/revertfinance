import { NextResponse } from 'next/server';
import { detectHighYieldPools } from '@/lib/high-yield';

export async function POST(req: Request) {
    try {
        // Scan all supported networks for high yield opportunities
        const chainIdsToScan = [1, 137, 10, 42161, 8453];
        const highYieldPools = await detectHighYieldPools(chainIdsToScan);

        return NextResponse.json({ success: true, highYieldPools });
    } catch (error: any) {
        console.error('High yield detection failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
