process.env.TEST_MODE = 'true';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://dummy.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy';
process.env.SUPABASE_URL = 'https://dummy.supabase.co';
process.env.SUPABASE_ANON_KEY = 'dummy';

import { scanMarket } from './src/lib/bot-engine';
import { SUPPORTED_CHAINS } from './src/lib/subgraph';

// Prevent actual DB/Telegram side effects if possible, but since scanMarket sends telegram natively we might just let it or console over it.
// The easiest way to verify without spam is to just run the function and let it print its console errors for telegram if it fails, or it will succeed.

async function runTest() {
    console.log("Starting test scan...");
    try {
        const results = await scanMarket([137], 'medium', 5);
        console.log("Scan complete. Results count: ", results.length);
        if (results.length > 0) {
            console.log("Top result output structure:");
            console.log(JSON.stringify(results[0].analysis, null, 2));
        }
    } catch (e) {
        console.error("Error during scan:", e);
    }
}

runTest();
