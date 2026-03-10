const { runAnalysis } = require('./src/lib/bot-engine');

async function test() {
    console.log("Starting runAnalysis directly...");
    try {
        const result = await runAnalysis({
            symbol: "WBTC/USDT",
            chainId: 42161,
            poolAddress: "0x5969efdde3cf5c0d9a88ae51e47d721096a97203"
        }, 'moderate', false);
        console.log("Success:", result);
    } catch (e) {
        console.error("Failed:", e.message);
    }
}
test();
