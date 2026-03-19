import { NextResponse } from 'next/server';
import { fetchTopPools } from '@/lib/subgraph';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const chainId = parseInt(searchParams.get('chainId') || '1');
        const minTVL = parseInt(searchParams.get('minTVL') || '500000');
        const first = parseInt(searchParams.get('first') || '50');

        const pools = await fetchTopPools(chainId, first, minTVL);
        return NextResponse.json(pools);
    } catch (error: any) {
        console.error('Failed to fetch pools:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
