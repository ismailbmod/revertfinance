
const { ethers } = require('ethers');

async function test() {
    const address = '0x93b396CBcD0B03b7e5ca3a6F559EcDCF9470Dc8a';
    const rpcs = ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth', 'https://cloudflare-eth.com'];

    for (const rpc of rpcs) {
        console.log(`Testing RPC: ${rpc} for address: ${address}`);
        try {
            const provider = new ethers.JsonRpcProvider(rpc);
            const balance = await provider.getBalance(address);
            console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
            break;
        } catch (err) {
            console.error(`RPC ${rpc} failed:`, err.message);
        }
    }
}

test();
