import { runAnalysis } from './src/lib/bot-engine';

async function test() {
    console.log('Starting test analysis...');
    try {
        const result = await runAnalysis(
            { symbol: 'ZEC/USDT', chainId: 1, poolAddress: '0x...' },
            'moderate'
        );
        console.log('Analysis Result:', result);
    } catch (error) {
        console.error('Test failed:', error);
    }
}

test();
