import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        // 1. Get the most recent scan signal to find the timestamp batch
        const { data: latestScan, error: scanError } = await supabase
            .from('signals')
            .select('created_at')
            .eq('type', 'scan')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (scanError && scanError.code !== 'PGRST116') {
            throw scanError;
        }

        if (latestScan) {
            // Since inserts happen in a batch, their timestamps will be very close. 
            // We can just fetch the top 10 most recent and filter them in memory by exact match, 
            // or just fetch by exact timestamp match. Supabase insert array creates exact matching timestamps.
            const { data: batchSignals, error: batchError } = await supabase
                .from('signals')
                .select('*')
                .eq('type', 'scan')
                .eq('created_at', latestScan.created_at)
                .order('data->>confidence', { ascending: false });

            if (batchError) throw batchError;

            return NextResponse.json(batchSignals);
        }

        // Fallback if no scans exist
        const { data: fallback, error } = await supabase
            .from('signals')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(3);

        if (error) throw error;
        return NextResponse.json(fallback);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
