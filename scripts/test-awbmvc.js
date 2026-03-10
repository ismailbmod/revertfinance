const fetch = require('node-fetch');

const API_KEY = "2215756a9c5d0a9e90f0c0fcbee6730d";
const ID = "AwbMVC6EBTpzjkHR2CtJLJnWqjU58MteLEVSoN4oNncZ";
const URL = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${ID}`;

const USER_WALLET = "0x93b396CBcD0B03b7e5ca3a6F559EcDCF9470Dc8a".toLowerCase();

async function test() {
    console.log(`--- Testing Subgraph: ${ID} ---`);
    const query = `{
        positions(where: { owner: "${USER_WALLET}" }) {
            id
            pool {
                id
                poolDayData(first: 1) { volumeUSD }
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
            console.log("Success! Found positions:", body.data.positions.length);
            if (body.data.positions.length > 0) {
                console.log("Sample Pool Day Data:", body.data.positions[0].pool.poolDayData);
            }
        }
    } catch (e) {
        console.error("Fetch error:", e.message);
    }
}

test();
