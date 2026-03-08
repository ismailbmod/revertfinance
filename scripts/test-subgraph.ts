
async function testSubgraph() {
    const owner = "0x93b396CBcD0B03b7e5ca3a6F559EcDCF9470Dc8a".toLowerCase();
    const url = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";

    const query = `
    {
      positions(where: { owner: "${owner}", liquidity_gt: 0 }) {
        id
        pool {
          id
          token0 { symbol decimals }
          token1 { symbol decimals }
          feeTier
        }
        tickLower
        tickUpper
        liquidity
      }
    }
  `;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });

        const body = await response.json();
        console.log("Subgraph Data:", JSON.stringify(body, null, 2));

        if (body.data && body.data.positions) {
            console.log(`Found ${body.data.positions.length} positions.`);
        } else {
            console.log("No positions found or error in body.");
        }
    } catch (error) {
        console.error("Fetch error:", error);
    }
}

testSubgraph();
