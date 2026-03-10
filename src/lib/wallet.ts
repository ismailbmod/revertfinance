import { ethers } from 'ethers';

const RPC_URLS: Record<number, string[]> = {
    1: ['https://rpc.ankr.com/eth', 'https://eth.llamarpc.com', 'https://1rpc.io/eth'],
    137: ['https://rpc.ankr.com/polygon', 'https://polygon-rpc.com', 'https://1rpc.io/matic'],
    10: ['https://rpc.ankr.com/optimism', 'https://mainnet.optimism.io', 'https://1rpc.io/op'],
    42161: ['https://rpc.ankr.com/arbitrum', 'https://arb1.arbitrum.io/rpc', 'https://1rpc.io/arb'],
    8453: ['https://rpc.ankr.com/base', 'https://mainnet.base.org', 'https://1rpc.io/base'],
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
    let nativeFetched = false;
    let tokensStillNeeded = [...tokens];

    for (const rpcUrl of rpcList) {
        try {
            const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });

            // 1. Fetch Native Balance if not already done
            if (!nativeFetched) {
                try {
                    const nativeBal = await Promise.race([
                        provider.getBalance(address),
                        timeout(3000)
                    ]) as bigint;

                    balances.push({
                        symbol: chainId === 137 ? 'MATIC' : 'ETH',
                        balance: ethers.formatEther(nativeBal),
                        chainId
                    });
                    nativeFetched = true;
                } catch (e) {
                    console.log(`Native balance fetch failed on ${rpcUrl}`);
                }
            }

            // 2. Fetch Token Balances for remaining tokens
            if (tokensStillNeeded.length > 0) {
                const results = await Promise.allSettled(
                    tokensStillNeeded.map(async (tokenAddress) => {
                        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
                        const [bal, decimals, symbol] = await Promise.race([
                            Promise.all([
                                contract.balanceOf(address),
                                contract.decimals(),
                                contract.symbol()
                            ]),
                            timeout(5000)
                        ]) as [bigint, number, string];

                        return { tokenAddress, bal, decimals, symbol };
                    })
                );

                const successfulTokens: string[] = [];
                for (const res of results) {
                    if (res.status === 'fulfilled') {
                        const { tokenAddress, bal, decimals, symbol } = res.value;
                        if (parseFloat(ethers.formatUnits(bal, decimals)) > 0) {
                            balances.push({
                                symbol,
                                balance: ethers.formatUnits(bal, decimals),
                                chainId
                            });
                        }
                        successfulTokens.push(tokenAddress);
                    }
                }

                // Update remaining tokens
                tokensStillNeeded = tokensStillNeeded.filter(t => !successfulTokens.includes(t));
            }

            // If we have everything, stop
            if (nativeFetched && tokensStillNeeded.length === 0) break;

        } catch (error) {
            console.error(`RPC ${rpcUrl} failed for chain ${chainId}:`, error instanceof Error ? error.message : error);
        }
    }

    return balances;
}
