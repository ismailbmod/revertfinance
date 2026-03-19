async function testStrategy() {
    process.env.TEST_MODE = 'true';
    const { runAnalysis } = await import('../src/lib/bot-engine');
    
    console.log('--- Testing LP Strategy Refactor ---');

    console.log('\n1. Analyzing WBTC/USDT (Normal Pair)...');
    try {
        const result = await runAnalysis({
            symbol: 'WBTC/USDT',
            chainId: 42161, // Arbitrum
            poolAddress: '0x2f5e87a896cf5ad61413d4b6330139bcac581373' // 0.3% WBTC/USDT pool
        }, 'moderate', true); // Use silent: true

        if (result) {
            console.log('✅ Analysis Successful');
            console.log(`Current Price: $${result.currentPrice}`);
            console.log(`Optimal Range: $${result.rangeMin.toFixed(2)} - $${result.rangeMax.toFixed(2)}`);
            console.log(`Stop Loss: $${result.stopLoss.toFixed(2)}`);
            console.log(`Safety Score: ${result.safetyScore}`);
            console.log(`Market Regime: ${result.marketRegime}`);
            console.log(`Recommended Fee: ${result.recommendation.feeTierDisplay}`);
            console.log(`Regime Indicators: ATR%=${result.indicators.atrPct.toFixed(2)}%, ADX=${result.indicators.adx.toFixed(1)}, VolSpike=${result.indicators.volumeSpike.toFixed(1)}`);
        }
    } catch (e: any) {
        console.error('❌ WBTC/USDT Failed:', e.message);
    }

    console.log('\n2. Analyzing USDC/USDT (Stable Pair)...');
    try {
        const result = await runAnalysis({
            symbol: 'USDC/USDT',
            chainId: 137, // Polygon
            poolAddress: '0x45dda9cb7c25131df268515131f648d91ea85cdb' // 0.01% USDC/USDT pool
        }, 'moderate', true); // Use silent: true

        if (result) {
            console.log('✅ Analysis Successful');
            console.log(`Optimal Range: $${result.rangeMin.toFixed(4)} - $${result.rangeMax.toFixed(4)}`);
            console.log(`Strategy: ${result.recommendation.strategy}`);
        }
    } catch (e: any) {
        console.error('❌ USDC/USDT Failed:', e.message);
    }

    console.log('\n--- Verification Finished ---');
}

testStrategy();
