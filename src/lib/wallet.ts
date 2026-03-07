import { ethers } from 'ethers';

const RPC_URLS: Record<number, string[]> = {
    1: ['https://rpc.flashbots.net', 'https://eth.drpc.org', 'https://gateway.tenderly.co/public/mainnet'],
    137: ['https://polygon-rpc.com', 'https://1rpc.io/matic', 'https://rpc-mainnet.maticvigil.com'],
    10: ['https://mainnet.optimism.io', 'https://1rpc.io/op'],
    42161: ['https://arb1.arbitrum.io/rpc', 'https://1rpc.io/arb'],
    8453: ['https://mainnet.base.org', 'https://1rpc.io/base'],
};

const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
];

export interface TokenBalance {
    symbol: string;
    balance: string;
    chainId: number;
}

const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));

export async function fetchWalletBalances(address: string, chainId: number, tokens: string[]): Promise<TokenBalance[]> {
    const rpcList = RPC_URLS[chainId] || [];
    let balances: TokenBalance[] = [];

    for (const rpcUrl of rpcList) {
        try {
            const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });

            // Fetch Native Balance with timeout
            const nativeBal = await Promise.race([
                provider.getBalance(address),
                timeout(5000)
            ]) as bigint;

            balances.push({
                symbol: chainId === 137 ? 'MATIC' : 'ETH',
                balance: ethers.formatEther(nativeBal),
                chainId
            });

            // Fetch Token Balances
            for (const tokenAddress of tokens) {
                try {
                    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
                    const [bal, decimals, symbol] = await Promise.race([
                        Promise.all([
                            contract.balanceOf(address),
                            contract.decimals(),
                            contract.symbol()
                        ]),
                        timeout(5000)
                    ]) as [bigint, number, string];

                    if (parseFloat(ethers.formatUnits(bal, decimals)) > 0) {
                        balances.push({
                            symbol,
                            balance: ethers.formatUnits(bal, decimals),
                            chainId
                        });
                    }
                } catch (e) {
                    // Skip individual token error: console.log(`Token ${tokenAddress} failed on ${rpcUrl}`);
                }
            }

            if (balances.length > 0) break;
        } catch (error) {
            console.error(`RPC ${rpcUrl} failed for chain ${chainId}:`, error instanceof Error ? error.message : error);
        }
    }

    return balances;
}
