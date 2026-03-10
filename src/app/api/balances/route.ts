import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchWalletBalances, TokenBalance } from '@/lib/wallet';
import ccxt from 'ccxt';

const DEFAULT_TOKENS: Record<number, string[]> = {
    1: [ // Ethereum
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    ],
    137: [ // Polygon
        '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH
        '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC.e
        '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
        '0x1BFD6202410a6EE570c663A0F39659357640a340', // WBTC
    ],
    42161: [ // Arbitrum
        '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
        '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
        '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', // WBTC
    ],
    10: [ // Optimism
        '0x4200000000000000000000000000000000000006', // WETH
        '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC
        '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // USDT
    ],
    8453: [ // Base
        '0x4200000000000000000000000000000000000006', // WETH
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    ]
};

export async function GET() {
    try {
        const { data: settings } = await supabase.from('settings').select('value').eq('key', 'wallets').single();
        const wallets: string[] = settings?.value || [];

        if (wallets.length === 0) return NextResponse.json([]);

        const allBalances: TokenBalance[] = [];

        for (const wallet of wallets) {
            console.log(`Fetching balances for wallet: ${wallet}`);
            const chainPromises = Object.keys(DEFAULT_TOKENS).map(async (chainId) => {
                const id = parseInt(chainId);
                try {
                    return await fetchWalletBalances(wallet, id, DEFAULT_TOKENS[id]);
                } catch (e) {
                    console.error(`Blockchain fetch failed for chain ${id}:`, e);
                    return [];
                }
            });

            const results = await Promise.all(chainPromises);
            allBalances.push(...results.flat());
        }

        console.log(`Total balances found: ${allBalances.length}`);

        // 2. Fetch Prices via CCXT (Binance)
        const exchange = new ccxt.binance();
        const prices: Record<string, number> = {
            'USDC': 1,
            'USDT': 1,
            'DAI': 1,
            'USDC.E': 1,
            'USDE': 1,
            'PYUSD': 1
        };

        try {
            const tickers = await exchange.fetchTickers(['ETH/USDT', 'BTC/USDT', 'MATIC/USDT', 'SOL/USDT']);
            const ethPrice = tickers['ETH/USDT']?.last || 0;
            const btcPrice = tickers['BTC/USDT']?.last || 0;
            const maticPrice = tickers['MATIC/USDT']?.last || 0;

            prices['ETH'] = ethPrice;
            prices['WETH'] = ethPrice;
            prices['BTC'] = btcPrice;
            prices['WBTC'] = btcPrice;
            prices['MATIC'] = maticPrice;
            prices['WMATIC'] = maticPrice;

            console.log(`Prices fetched: ETH=${ethPrice}, BTC=${btcPrice}, MATIC=${maticPrice}`);
        } catch (e) {
            console.error('Price fetch failed from Binance:', e instanceof Error ? e.message : e);
        }

        // 3. Attach USD Values with fuzzy/case-insensitive matching
        const balancesWithUSD = allBalances.map(b => {
            const symbol = b.symbol.toUpperCase();
            let price = 0;

            if (prices[symbol]) {
                price = prices[symbol];
            } else if (symbol.includes('BTC')) {
                price = prices['BTC'] || 0;
            } else if (symbol.includes('ETH')) {
                price = prices['ETH'] || 0;
            } else if (symbol.includes('USDC') || symbol.includes('USDT') || symbol.includes('DAI')) {
                price = 1;
            }

            return {
                ...b,
                price: price,
                balanceUSD: (parseFloat(b.balance) * price)
            };
        });

        return NextResponse.json(balancesWithUSD);
    } catch (error: any) {
        console.error('Failed to fetch balances:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
