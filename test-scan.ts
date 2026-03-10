import { scanMarket } from './src/lib/bot-engine';
import { SUPPORTED_CHAINS } from './src/lib/subgraph';

// Mock supabase to avoid DB inserts during test
jest.mock('./src/lib/supabase', () => ({
    supabase: {
        from: () => ({
            upsert: jest.fn(),
            insert: jest.fn(),
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null })
        })
    }
}));

// Mock telegram to avoid sending messages during test
jest.mock('./src/lib/telegram', () => ({
    sendNotification: jest.fn()
}));

async function runTest() {
    console.log("Starting test scan...");
    // Just test on Polygon to make it fast
    const results = await scanMarket([137], 'medium', 5);
    console.log("Scan complete. Results count: ", results.length);
    if (results.length > 0) {
        console.log("Top result output structure:");
        console.log(JSON.stringify(results[0].analysis, null, 2));
    }
}

runTest().catch(console.error);
