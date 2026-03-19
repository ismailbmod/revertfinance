import { runAnalysis } from '../src/lib/bot-engine';

async function test() {
  const pool = {
    symbol: 'WBTC/USDT',
    chainId: 42161,
    poolAddress: ''
  };

  try {
    const result = await runAnalysis(pool, 'moderate', false);
    if (result) {
      console.log('SUCCESS');
      console.log(`Range Width: ${result.rangeWidthPct}%`);
      console.log(`Est Time in Range: ${result.estimatedTimeHours} hours`);
    } else {
      console.log('RESULT NULL');
    }
  } catch (e: any) {
    console.error('FAILED:', e.message);
  }
}

test();
