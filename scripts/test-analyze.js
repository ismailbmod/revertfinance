const fetch = require('node-fetch');

async function test() {
    const payload = {
        pool: {
            symbol: "WBTC/USDT",
            chainId: 42161,
            poolAddress: "0x5969efdde3cf5c0d9a88ae51e47d721096a97203"
        },
        riskProfile: "moderate",
        silent: false
    };

    console.log("Testing POST /api/analyze", payload);
    const res = await fetch('http://localhost:3000/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (res.ok) {
        const body = await res.json();
        console.log("Success:", body);
    } else {
        console.error("Failed:", res.status);
        const err = await res.json();
        console.error("Error body:", err);
    }
}
test();
