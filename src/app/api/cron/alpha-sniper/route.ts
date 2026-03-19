
import { NextResponse } from 'next/server';
import { runAutomatedAlphaScan } from '@/lib/cron-scanner';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');

    if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const chainId = searchParams.get('chainId');

    try {
        await runAutomatedAlphaScan(chainId ? parseInt(chainId) : undefined);
        return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
    } catch (error: any) {
        console.error('Alpha Sniper Cron Error:', error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
