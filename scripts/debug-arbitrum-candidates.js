const fetch = require('node-fetch');

const USER_WALLET = "0x93b396CBcD0B03b7e5ca3a6F559EcDCF9470Dc8a".toLowerCase();
const API_KEY = "2215756a9c5d0a9e90f0c0fcbee6730d";

const SUBGRAPHS = [
    { name: "Arbitrum Analytics (Current)", id: "FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM" },
    { name: "Candidate 1 (FQ6JYs...)", id: "FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX" },
    { name: "Candidate 2 (3V7ZY6...)", id: "3V7ZY6muhxaQL5qvntX1CFXJ32W7BxXZTGTwmpH5J4t3" }
];

async function testPositions() {
    for (const subgraph of SUBGRAPHS) {
        console.log(`\n--- Testing ${subgraph.name} (${subgraph.id}) ---`);
        const url = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${subgraph.id}`;

        const query = `{
            positions(where: { owner: "${USER_WALLET}", liquidity_gt: "0" }) {
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

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query }),
            });

            const body = await response.json();
            if (body.errors) {
                console.log(`Errors for ${subgraph.name}:`, JSON.stringify(body.errors[0].message));
            } else if (body.data && body.data.positions) {
                console.log(`Found ${body.data.positions.length} positions.`);
                body.data.positions.forEach(p => {
                    console.log(`- Position ${p.id}: ${p.pool.token0.symbol}/${p.pool.token1.symbol} (${p.pool.feeTier})`);
                });
            } else {
                console.log(`No results for ${subgraph.name}.`);
            }
        } catch (err) {
            console.error(`Fetch error for ${subgraph.name}:`, err.message);
        }
    }
}

testPositions();
