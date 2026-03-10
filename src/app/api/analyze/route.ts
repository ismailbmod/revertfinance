import { NextResponse } from 'next/server';
import { runAnalysis, PoolConfig } from '@/lib/bot-engine';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
    try {
        const { pool, riskProfile, silent } = await req.json() as {
            pool: PoolConfig,
            riskProfile: 'risky' | 'medium' | 'moderate',
            silent?: boolean
        };

        if (!pool || !riskProfile) {
            return NextResponse.json({ error: 'Missing pool or riskProfile' }, { status: 400 });
        }

        const result = await runAnalysis(pool, riskProfile, silent);

        return NextResponse.json({ success: true, result });
    } catch (error: any) {
        console.error('Analysis failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
