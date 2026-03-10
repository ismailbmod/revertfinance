const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
// Note: We'll use the compiled logic or just re-implement the subset here for debugging

const SUPABASE_URL = "https://btznjknwfbjmbmkrxlzp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0em5qa253ZmJqbWJta3J4bHpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NDczNTEsImV4cCI6MjA4ODQyMzM1MX0.KtGTFbiLlPdx88haOYpZNl192iJ6k6yWFR_8_22hYqs";

async function debugPositions() {
    console.log("--- Standalone API Debugger ---");

    // 1. Fetch wallets from Supabase
    // We'll try to find the key in .env.local
    const fs = require('fs');
    const path = require('path');
    let supabaseKey = "";
    try {
        const env = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
        supabaseKey = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();
    } catch (e) {
        console.error("Could not read .env.local for Supabase key");
        return;
    }

    const supabase = createClient(SUPABASE_URL, supabaseKey);
    const { data: settings, error } = await supabase.from('settings').select('value').eq('key', 'wallets').single();

    if (error) {
        console.error("Supabase Error:", error);
        return;
    }

    const wallets = settings?.value || [];
    console.log("Wallets in Database:", wallets);

    if (wallets.length === 0) {
        console.log("STOP: No wallets found.");
        return;
    }

    // 2. Test Subgraph Fetch for each wallet
    const SUBGRAPH_URLS = {
        42161: "https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/3V7ZY6muhxaQL5qvntX1CFXJ32W7BxXZTGTwmpH5J4t3"
    };

    for (const wallet of wallets) {
        console.log(`Checking Wallet: ${wallet} on Arbitrum...`);
        const query = `{
          positions(where: { owner: "${wallet.toLowerCase()}", liquidity_gt: "0" }) {
            id
            pool {
              id
              token0 { symbol decimals }
              token1 { symbol decimals }
              feeTier
              totalValueLockedUSD
              volumeUSD
              tick
            }
            tickLower { tickIdx }
            tickUpper { tickIdx }
            liquidity
            depositedToken0
            depositedToken1
            collectedFeesToken0
            collectedFeesToken1
            owner
          }
        }`;

        const response = await fetch(SUBGRAPH_URLS[42161], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        const body = await response.json();
        if (body.data && body.data.positions && body.data.positions.length > 0) {
            console.log(`Found ${body.data.positions.length} positions for ${wallet}`);
            console.log("RAW SAMPLE:", JSON.stringify(body.data.positions[0], null, 2));
        } else {
            console.log(`No positions found for ${wallet}`);
            if (body.errors) console.error(body.errors);
        }
    }
}

debugPositions();
