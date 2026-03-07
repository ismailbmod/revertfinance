
import { NextResponse } from 'next/server';
import { monitorPositions } from '../../../../lib/monitor';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');

    // Vercel Cron sends an Authorization header with a Bearer token
    if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    try {
        await monitorPositions();
        return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
    } catch (error: any) {
        console.error('Cron Monitor Error:', error.message);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
