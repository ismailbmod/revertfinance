const fetch = require('node-fetch');

const API_KEY = "2215756a9c5d0a9e90f0c0fcbee6730d";
const ANALYTICS_ID = "FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM";
const URL = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${ANALYTICS_ID}`;

// This is the pool ID for WBTC/USDT on Arbitrum from my previous RAW SAMPLE
const POOL_ID = "0x5969efdde3cf5c0d9a88ae51e47d721096a97203".toLowerCase();

async function test() {
    console.log(`--- Testing Analytics Subgraph: ${ANALYTICS_ID} ---`);
    const query = `{
        pool(id: "${POOL_ID}") {
            id
            poolDayData(first: 1, orderBy: date, orderDirection: desc) {
                volumeUSD
            }
        }
    }`;

    try {
        const response = await fetch(URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        const body = await response.json();
        if (body.errors) {
            console.log("Errors:", body.errors.map(e => e.message).join(", "));
        } else {
            console.log("Success! Pool found:", body.data.pool?.id);
            if (body.data.pool?.poolDayData) {
                console.log("VolumeUSD (24h):", body.data.pool.poolDayData[0]?.volumeUSD);
            }
        }
    } catch (e) {
        console.error("Fetch error:", e.message);
    }
}

test();
