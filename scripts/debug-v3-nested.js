
const owner = "0x93b396CBcD0B03b7e5ca3a6F559EcDCF9470Dc8a".toLowerCase();
const url = "https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";

const query = JSON.stringify({
    query: `{
    positions(where: { owner: "${owner}", liquidity_gt: 0 }) {
      id
      pool {
        id
        token0 { symbol decimals }
        token1 { symbol decimals }
        feeTier
      }
      tickLower { tickIdx }
      tickUpper { tickIdx }
      liquidity
    }
  }`
});

async function run() {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: query
        });
        const data = await response.json();
        console.log("Response:", JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error:", err);
    }
}

run();
