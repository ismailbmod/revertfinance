
async function test() {
    const pool = {
        symbol: "USDC/WETH",
        chainId: 1,
        poolAddress: "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8"
    };
    const riskProfile = "medium";

    console.log("Testing analysis for:", pool.symbol);
    try {
        const response = await fetch("http://localhost:3000/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pool, riskProfile })
        });
        const data = await response.json();
        console.log("Result:", JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error:", err);
    }
}

test();
