export const SUPPORTED_CHAINS = [1, 137, 10, 42161, 8453];

const SUBGRAPH_URLS: Record<number, string> = {
  1: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV', // Ethereum
  137: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm', // Polygon
  10: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj', // Optimism
  42161: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM', // Arbitrum
  8453: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/HMuAwufqZ1YCRmzL2SfHTVkzZovC9VL2UAKhjvRqKiR1', // Base
};

export interface SubgraphPosition {
  id: string;
  pool: {
    id: string;
    token0: { symbol: string; decimals: string };
    token1: { symbol: string; decimals: string };
    feeTier: string;
    totalValueLockedUSD: string;
    volumeUSD: string;
    tick: string;
  };
  tickLower: { tickIdx: string };
  tickUpper: { tickIdx: string };
  liquidity: string;
  depositedToken0: string;
  depositedToken1: string;
  collectedFeesToken0: string;
  collectedFeesToken1: string;
  owner: string;
}

export interface SubgraphPool {
  id: string;
  feeTier: string;
  totalValueLockedUSD: string;
  volumeUSD: string;
  token0: { symbol: string; id: string };
  token1: { symbol: string; id: string };
}

export async function fetchPositionsByOwner(owner: string, chainId: number = 1): Promise<SubgraphPosition[]> {
  const url = SUBGRAPH_URLS[chainId];
  if (!url) return [];

  const query = `
    {
      positions(where: { owner: "${owner.toLowerCase()}", liquidity_gt: 0 }) {
        id
        pool {
          id
          token0 { symbol decimals }
          token1 { symbol decimals }
          feeTier
          totalValueLockedUSD
          volumeUSD
          tick
        }
        tickLower { tickIdx }
        tickUpper { tickIdx }
        liquidity
        depositedToken0
        depositedToken1
        collectedFeesToken0
        collectedFeesToken1
        owner
      }
    }
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const { data } = await response.json();
    return data?.positions || [];
  } catch (error) {
    console.error(`Error fetching positions for ${owner} on chain ${chainId}:`, error);
    return [];
  }
}

export function tickToPrice(tick: number, token0Decimals: number, token1Decimals: number): number {
  const rawPrice = Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);

  // If token0 is a stablecoin (USDC, USDT, DAI), rawPrice is probably ETH/USDC, so we invert.
  if (rawPrice < 0.01) {
    return 1 / rawPrice;
  }
  return rawPrice;
}

export async function fetchPoolsByPair(token0Symbol: string, token1Symbol: string, chainId: number = 1): Promise<SubgraphPool[]> {
  const url = SUBGRAPH_URLS[chainId];
  if (!url) return [];

  // First we need to find the token addresses for these symbols or just search by symbol
  // In Uniswap V3 subgraph, we can search pools by token symbols (case insensitive-ish)
  const query = `
    {
      pools(where: { 
        token0_: { symbol_contains_nocase: "${token0Symbol}" },
        token1_: { symbol_contains_nocase: "${token1Symbol}" }
      }) {
        id
        feeTier
        totalValueLockedUSD
        volumeUSD
        token0 { symbol id }
        token1 { symbol id }
      }
    }
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const { data } = await response.json();
    return data?.pools || [];
  } catch (error) {
    console.error(`Error fetching pools for ${token0Symbol}/${token1Symbol} on chain ${chainId}:`, error);
    return [];
  }
}
