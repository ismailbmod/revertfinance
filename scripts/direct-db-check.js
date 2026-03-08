
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

async function check() {
    const env = fs.readFileSync('.env.local', 'utf8');
    const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
    const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();

    console.log('Using URL:', url);
    const supabase = createClient(url, key);

    const { data, error } = await supabase.from('settings').select('*');
    if (error) {
        console.error('Error:', error.message);
    } else {
        console.log('All settings:', JSON.stringify(data, null, 2));
    }
}

check();
