
const { runAnalysis } = require('../src/lib/bot-engine');

async function test() {
  process.env.TEST_MODE = 'true';
  const arbPool = {
    symbol: 'ETH/USDC',
    chainId: 42161,
    poolAddress: '0xc6962004f452be9203591991d15f6b388e09e8d0'
  };

  const ethPool = {
    symbol: 'ETH/USDT',
    chainId: 1,
    poolAddress: '0x11b81a04b0b8c307d1e27684073b22200af47b59'
  };

  console.log('--- TEST 1: Arbitrum (Good Conditions) ---');
  const arbRes = await runAnalysis(arbPool, 'moderate', false);
  if (arbRes) {
    console.log(`Symbol: ${arbRes.mappedSymbol}`);
    console.log(`Safety Score: ${arbRes.safetyScore}`);
    console.log(`Market Regime: ${arbRes.marketRegime}`);
    console.log(`Status: ${arbRes.statusLabel}`);
    console.log(`APR: ${arbRes.expectedFeeAPR.toFixed(2)}%`);
    console.log(`Range Width: ${arbRes.rangeWidthPct.toFixed(2)}%`);
  } else {
    console.log('Signal Suppressed (as expected if validation fails)');
  }

  console.log('\n--- TEST 2: Ethereum (Penalty Check) ---');
  const ethRes = await runAnalysis(ethPool, 'moderate', false);
  if (ethRes) {
    console.log(`Symbol: ${ethRes.mappedSymbol}`);
    console.log(`Safety Score: ${ethRes.safetyScore}`);
    console.log(`Market Regime: ${ethRes.marketRegime}`);
    console.log(`APR: ${ethRes.expectedFeeAPR.toFixed(2)}%`);
  } else {
    console.log('Signal Suppressed (Expected on Ethereum if APR < 40% or Score < 70)');
  }
}

test().catch(console.error);
