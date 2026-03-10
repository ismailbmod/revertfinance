const fetch = require('node-fetch');

async function testApi() {
    console.log("--- Testing /api/positions endpoint ---");
    try {
        const response = await fetch('http://localhost:3000/api/positions');
        const data = await response.json();
        console.log("API Response Status:", response.status);
        if (data.error) {
            console.error("API Error:", data.error);
        } else {
            console.log(`API returned ${data.length} positions.`);
            if (data.length > 0) {
                console.log("First Position Sample:", JSON.stringify(data[0], null, 2));
            }
            data.forEach(p => {
                const val = p.valueUSD ? p.valueUSD.toFixed(2) : "N/A";
                console.log(`- [${p.chainName}] ${p.pair} | Range: ${p.range} | APR: ${p.apr} | Value: $${val}`);
            });
        }
    } catch (e) {
        console.error("Fetch Error:", e.message);
        console.log("Note: Make sure the dev server is running on port 3000.");
    }
}

testApi();
