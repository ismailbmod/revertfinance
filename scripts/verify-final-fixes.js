const fetch = require('node-fetch');

// Mocked subset of subgraph.ts to verify the logic
const SUBGRAPH_URLS = {
    42161: "https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/3V7ZY6muhxaQL5qvntX1CFXJ32W7BxXZTGTwmpH5J4t3"
};

const USER_WALLET = "0x93b396CBcD0B03b7e5ca3a6F559EcDCF9470Dc8a".toLowerCase();

function tickToPrice(tick, token0Decimals, token1Decimals) {
    let rawPrice = Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);

    if (rawPrice < 0.0001) {
        rawPrice = 1 / rawPrice;
    }
    return rawPrice;
}

async function verifyArbitrum() {
    console.log("--- Verifying Arbitrum Positions ---");
    const url = SUBGRAPH_URLS[42161];
    const query = `{
      positions(where: { owner: "${USER_WALLET}", liquidity_gt: "0" }) {
        id
        pool {
          id
          token0 { symbol decimals }
          token1 { symbol decimals }
          feeTier
        }
      }
    }`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });
        const body = await response.json();
        if (body.data && body.data.positions) {
            console.log(`SUCCESS: Found ${body.data.positions.length} positions on Arbitrum.`);
            body.data.positions.forEach(p => {
                console.log(`- ${p.pool.token0.symbol}/${p.pool.token1.symbol} (ID: ${p.id})`);
            });
        } else {
            console.log("FAILURE: No positions found on Arbitrum.");
            console.log(JSON.stringify(body));
        }
    } catch (e) {
        console.error("Fetch Error:", e.message);
    }
}

console.log("--- Verifying Price Inversion Logic ---");
const p1 = tickToPrice(-200000, 8, 6); // Very small tick for BTC/USDT maybe?
console.log(`Tick -200000 (8,6) Price: ${p1.toFixed(2)} (Should be large if inverted)`);

const p2 = tickToPrice(200000, 8, 6);
console.log(`Tick 200000 (8,6) Price: ${p2.toFixed(2)}`);

verifyArbitrum();
