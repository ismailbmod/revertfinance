
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing env vars');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    try {
        const { data, error } = await supabase.from('settings').select('*').eq('key', 'wallets').single();
        if (error) {
            console.error('Error:', error.message);
        } else {
            console.log('Wallets:', data.value);
        }
    } catch (e) {
        console.error('Crash:', e.message);
    }
}

check();
