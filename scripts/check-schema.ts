
import { supabase } from './src/lib/supabase.ts';

async function checkSchema() {
    console.log('--- Database Verification ---');
    const { data: marketData } = await supabase.from('market_data_cache').select('symbol, updated_at');
    console.log('Market Cache Rows:', marketData?.length || 0);
    if (marketData && marketData.length > 0) console.log('Sample:', marketData[0]);

    const { data: positionsData } = await supabase.from('positions').select('nft_id, status');
    console.log('Synced Positions:', positionsData?.length || 0);
    if (positionsData && positionsData.length > 0) console.log('Sample:', positionsData[0]);
}

checkSchema().catch(console.error);
