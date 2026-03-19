
import { NextResponse } from 'next/server';
import { runAutomatedHighYieldScan } from '@/lib/cron-scanner';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');

    if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
        await runAutomatedHighYieldScan();
        return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
    } catch (error: any) {
        console.error('High Yield Cron Error:', error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
