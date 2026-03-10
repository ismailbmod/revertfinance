export const SUPPORTED_CHAINS = [1, 137, 10, 42161, 8453, 56];

const SUBGRAPH_URLS: Record<number, string> = {
  1: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV', // Ethereum
  137: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm', // Polygon
  10: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj', // Optimism
  42161: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/3V7ZY6muhxaQL5qvntX1CFXJ32W7BxXZTGTwmpH5J4t3', // Arbitrum One (Positions)
  8453: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/HMuAwufqZ1YCRmzL2SfHTVkzZovC9VL2UAKhjvRqKiR1', // Base
  56: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/4sQJ7jZqK96cptX7o9x64Wz1t9WeD1n9V7XjD8v1Sg7', // BNB
};

// Analytics-only subgraphs used for missing data merge (e.g. daily volume for APR)
const ANALYTICS_SUBGRAPH_URLS: Record<number, string> = {
  42161: 'https://gateway.thegraph.com/api/2215756a9c5d0a9e90f0c0fcbee6730d/subgraphs/id/FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM', // Arbitrum Analytics
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
    poolDayData: { volumeUSD: string }[];
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
  token0Price: string;
  token1Price: string;
  token0: { symbol: string; id: string; decimals: string };
  token1: { symbol: string; id: string; decimals: string };
  tick: string;
  createdAtTimestamp?: string;
  poolDayData?: { volumeUSD: string; date: number }[];
}

export async function fetchPositionsByOwner(owner: string, chainId: number = 1): Promise<any[]> {
  const url = SUBGRAPH_URLS[chainId];
  if (!url) return [];

  console.log(`[Subgraph] Fetching positions for ${owner} on chain ${chainId}...`);

  // Note: some subgraphs might not have poolDayData or use different field names.
  // We make poolDayData optional for compatibility.
  const query = `
    {
      positions(where: { owner: "${owner.toLowerCase()}", liquidity_gt: "0" }) {
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
        tickLower
        tickUpper
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

    if (!response.ok) {
      console.error(`[Subgraph] Error (Chain ${chainId}): ${response.status} ${response.statusText}`);
      return [];
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error(`[Subgraph] Non-JSON response (Chain ${chainId})`);
      return [];
    }

    const { data, errors } = await response.json();
    if (errors) {
      console.error(`[Subgraph] GraphQL Errors (Chain ${chainId}):`, errors);
    }

    const pos = data?.positions || [];
    console.log(`[Subgraph] Found ${pos.length} positions on chain ${chainId}`);

    // Data Merge: Fetch missing volume data from analytics subgraph if needed
    const analyticsUrl = ANALYTICS_SUBGRAPH_URLS[chainId];
    if (pos.length > 0 && analyticsUrl) {
      const poolIds = Array.from(new Set(pos.map((p: any) => p.pool.id.toLowerCase())));
      const poolQuery = `
        {
          ${poolIds.map((id, i) => `
            pool_${i}: pool(id: "${id}") {
              id
              poolDayData(first: 1, orderBy: date, orderDirection: desc) {
                volumeUSD
              }
            }
          `).join('\n')}
        }
      `;

      try {
        const aRes = await fetch(analyticsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: poolQuery }),
        });
        const aBody = await aRes.json();
        const poolMap = new Map();
        if (aBody.data) {
          Object.values(aBody.data).forEach((p: any) => {
            if (p) poolMap.set(p.id.toLowerCase(), p.poolDayData);
          });
        }

        // Merge back into positions
        pos.forEach((p: any) => {
          const poolData = poolMap.get(p.pool.id.toLowerCase());
          if (poolData) {
            p.pool.poolDayData = poolData;
          }
        });
      } catch (err) {
        console.error(`[Subgraph] Failed to merge analytics data for chain ${chainId}:`, err);
      }
    }

    return pos;
  } catch (error) {
    console.error(`[Subgraph] Exception on chain ${chainId}:`, error);
    return [];
  }
}

export function tickToPrice(tick: number, token0Decimals: number, token1Decimals: number): number {
  let rawPrice = Math.pow(1.0001, tick) * Math.pow(10, token0Decimals - token1Decimals);

  // Price Sanity Check / Inversion Logic (as requested)
  // if price < 0.001 OR price > 100000, we consider it potentially inverted
  if (rawPrice < 0.001 || rawPrice > 100000) {
    // Only invert if it results in a more 'human' range (though here we just follow the rule)
    const inverted = 1 / rawPrice;
    // For WBTC/USDT specifically, if rawPrice is ~6.5M (due to decimal diff), 
    // inverting it makes it 0.0000001, which is even WORSE.
    // So we only invert if the result is closer to a "sane" range.
    if (Math.abs(Math.log10(inverted)) < Math.abs(Math.log10(rawPrice))) {
      rawPrice = inverted;
    }
  }

  return rawPrice;
}

export async function fetchPoolsByPair(token0Symbol: string, token1Symbol: string, chainId: number = 1): Promise<SubgraphPool[]> {
  // Prefer analytics subgraph for pool searching since we need poolDayData
  const url = ANALYTICS_SUBGRAPH_URLS[chainId] || SUBGRAPH_URLS[chainId];
  if (!url) return [];

  // First we need to find the token addresses for these symbols or just search by symbol
  // In Uniswap V3 subgraph, we can search pools by token symbols (case insensitive-ish)
  const queryBody = (t0: string, t1: string) => `
    {
      pools(where: { 
        token0_: { symbol_contains_nocase: "${t0}" },
        token1_: { symbol_contains_nocase: "${t1}" }
      }) {
        id
        feeTier
        totalValueLockedUSD
        volumeUSD
        token0Price
        token1Price
        token0 { symbol id }
        token1 { symbol id }
        createdAtTimestamp
        poolDayData(first: 1, orderBy: date, orderDirection: desc) {
          volumeUSD
        }
      }
    }
  `;

  try {
    // Try both orderings since we don't know which is token0 in the Subgraph
    const [res1, res2] = await Promise.all([
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryBody(token0Symbol, token1Symbol) }),
      }),
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryBody(token1Symbol, token0Symbol) }),
      })
    ]);

    const results: any[] = [];
    for (const res of [res1, res2]) {
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) continue;
      const { data } = await res.json();
      if (data?.pools) results.push(...data.pools);
    }

    // Exact Match filtering with Alias support (treating WETH and ETH as equal)
    const normalize = (s: string) => s.toUpperCase().replace(/^W(ETH|BTC|MATIC|BNB|SOL|AVAX)/, '$1');
    const target0 = normalize(token0Symbol);
    const target1 = normalize(token1Symbol);

    const uniquePools = new Map<string, SubgraphPool>();
    results.forEach(p => {
      const s0 = normalize(p.token0.symbol);
      const s1 = normalize(p.token1.symbol);

      const isExact = (s0 === target0 && s1 === target1) || (s0 === target1 && s1 === target0);
      if (isExact) {
        uniquePools.set(p.id, p);
      }
    });

    return Array.from(uniquePools.values());
  } catch (error) {
    console.error(`Error fetching pools for ${token0Symbol}/${token1Symbol} on chain ${chainId}:`, error);
    return [];
  }
}

export async function fetchTopPools(chainId: number = 1, first: number = 50): Promise<SubgraphPool[]> {
  const url = SUBGRAPH_URLS[chainId];
  if (!url) return [];

  const query = `
    {
      pools(first: ${first}, orderBy: volumeUSD, orderDirection: desc, where: { totalValueLockedUSD_gt: "100000" }) {
        id
        feeTier
        totalValueLockedUSD
        volumeUSD
        token0Price
        token1Price
        token0 { symbol id decimals }
        token1 { symbol id decimals }
        tick
        poolDayData(first: 7, orderBy: date, orderDirection: desc) {
          volumeUSD
          date
        }
        createdAtTimestamp
      }
    }
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      console.error(`Subgraph error fetching top pools (Chain ${chainId}): ${response.status}`);
      return [];
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return [];
    }

    const { data } = await response.json();
    return data?.pools || [];
  } catch (error) {
    console.error(`Error fetching top pools for chain ${chainId}:`, error);
    return [];
  }
}

export async function fetchPoolTicks(poolId: string, chainId: number = 1): Promise<any[]> {
  const url = SUBGRAPH_URLS[chainId];
  if (!url) return [];

  // Fetch up to 1000 active ticks to estimate liquidity distribution
  const query = `
    {
      ticks(first: 1000, where: { pool: "${poolId.toLowerCase()}", liquidityNet_not: "0" }, orderBy: tickIdx) {
        tickIdx
        liquidityGross
        liquidityNet
      }
    }
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) return [];

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) return [];

    const { data } = await response.json();
    return data?.ticks || [];
  } catch (error) {
    console.error(`Error fetching ticks for pool ${poolId}:`, error);
    return [];
  }
}
