import { fetchWalletBalances } from './src/lib/wallet';
import { ethers } from 'ethers';

async function test() {
    const address = '0x1c8D14890A5333f67dB93aC3A5A6094Cf7d8fA99'; // Example address or use a known one
    const chainId = 1; // Mainnet
    // Common Mainnet Tokens
    const tokens = [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    ];

    console.log(`Testing balance for ${address} on chain ${chainId}...`);
    try {
        const balances = await fetchWalletBalances(address, chainId, tokens);
        console.log('Balances found:', JSON.stringify(balances, null, 2));
    } catch (error) {
        console.error('Test failed:', error);
    }
}

test();
