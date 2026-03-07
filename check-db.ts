
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase.from('settings').select('*').eq('key', 'wallets').single();
    if (error) {
        console.error('Error fetching settings:', error);
    } else {
        console.log('Wallets from DB:', data.value);
    }
}

check();
