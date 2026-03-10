const fetch = require('node-fetch');

async function test() {
    console.log("--- Verifying Arbitrum APR Restoration ---");
    try {
        const res = await fetch('http://localhost:3000/api/positions');
        const data = await res.json();

        const arbitrumPos = data.filter(p => p.chainName === 'Arbitrum');
        console.log(`Found ${arbitrumPos.length} Arbitrum positions.`);

        arbitrumPos.forEach(p => {
            console.log(`- ${p.pair} | APR: ${p.apr} | Value: $${p.valueUSD?.toFixed(2)}`);
        });

        const hasNonZeroAPR = arbitrumPos.some(p => p.apr !== "0.00%");
        if (hasNonZeroAPR) {
            console.log("✅ Success! Found non-zero APR on Arbitrum.");
        } else {
            console.log("❌ Failure: All Arbitrum APRs are still 0.00%.");
        }
    } catch (e) {
        console.error("Test failed:", e.message);
    }
}

test();
