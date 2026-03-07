import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const settings = data.reduce((acc: any, item: any) => {
        acc[item.key] = item.value;
        return acc;
    }, {});

    return NextResponse.json(settings);
}

export async function POST(req: Request) {
    try {
        const { key, value } = await req.json();
        const { error } = await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });

        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
