
import { tickToPrice } from './subgraph';

export function calculateEstimatedAPR(pos: any): string {
    const feeTier = parseInt(pos.pool.feeTier) / 1000000;
    const tvl = parseFloat(pos.pool.totalValueLockedUSD);
    // Handle cases where poolDayData is not available (e.g. some Arbitrum subgraphs)
    const vol24h = pos.pool.poolDayData?.[0] ? parseFloat(pos.pool.poolDayData[0].volumeUSD) : 0;

    if (tvl === 0 || vol24h === 0) return '0.00%';
    const baseAPR = (feeTier * vol24h) / tvl;
    const annualAPR = baseAPR * 365 * 100;
    if (annualAPR > 1000) return '100.00%+';
    return annualAPR > 0 ? `${annualAPR.toFixed(2)}%` : '0.00%';
}

export function calculateLPValue(pos: any, prices: Record<string, number>) {
    const liquidity = parseFloat(pos.liquidity);
    const tickCurrent = parseInt(pos.pool.tick);

    const getTickIdx = (t: any) => (typeof t === 'object' && t !== null) ? t.tickIdx : t;
    const tickLower = parseInt(getTickIdx(pos.tickLower));
    const tickUpper = parseInt(getTickIdx(pos.tickUpper));

    const sqrtP = Math.sqrt(Math.pow(1.0001, tickCurrent));
    const sqrtA = Math.sqrt(Math.pow(1.0001, tickLower));
    const sqrtB = Math.sqrt(Math.pow(1.0001, tickUpper));

    let x = 0;
    let y = 0;

    if (tickCurrent < tickLower) {
        x = liquidity * (1 / sqrtA - 1 / sqrtB);
    } else if (tickCurrent >= tickUpper) {
        y = liquidity * (sqrtB - sqrtA);
    } else {
        x = liquidity * (1 / sqrtP - 1 / sqrtB);
        y = liquidity * (sqrtP - sqrtA);
    }

    const d0 = parseInt(pos.pool.token0.decimals);
    const d1 = parseInt(pos.pool.token1.decimals);
    const amount0 = x / Math.pow(10, d0);
    const amount1 = y / Math.pow(10, d1);

    const getPrice = (symbol: string) => {
        const s = symbol.toUpperCase();
        if (s.includes('USD') || s.includes('DAI')) return 1;
        if (s.includes('BTC')) return prices['BTC'] || prices['WBTC'] || 0;
        return prices['ETH'] || prices['WETH'] || 0;
    };

    const p0 = getPrice(pos.pool.token0.symbol);
    const p1 = getPrice(pos.pool.token1.symbol);

    return {
        amount0,
        amount1,
        totalUSD: (amount0 * p0) + (amount1 * p1),
        p0,
        p1
    };
}

export function calculateHealth(pos: any) {
    const tickCurrent = parseInt(pos.pool.tick);
    const tickLower = parseInt(pos.tickLower.tickIdx);
    const tickUpper = parseInt(pos.tickUpper.tickIdx);
    const rangeTotal = tickUpper - tickLower;
    const positionRatio = rangeTotal !== 0 ? (tickCurrent - tickLower) / rangeTotal : 0.5;

    let status = 'In Range';
    if (positionRatio < 0.2 || positionRatio > 0.8) status = 'Rebalance Soon';
    if (tickCurrent < tickLower || tickCurrent > tickUpper) status = 'Out of Range';

    return { status, positionRatio };
}

export function calculateExpectedDailyFees(volumeUSD: number, feeTier: number): number {
    return volumeUSD * (feeTier / 1000000); // feeTier is usually 3000 for 0.3%
}

export function estimateLPShare(positionLiquidity: number, totalLiquidityInRange: number): number {
    if (totalLiquidityInRange === 0) return 1; // if you are the only one
    return positionLiquidity / totalLiquidityInRange;
}

export function simulateImpermanentLoss(rangeMin: number, rangeMax: number, priceChange: number): number {
    // simplified IL simulation based on price change and range
    // Assuming stable price = 1 for base math, new price p1 = 1 + priceChange
    const p0 = 1;
    const p1 = 1 + priceChange;

    // sqrt formulas for liquidity
    const sqrtP0 = Math.sqrt(p0);
    const sqrtP1 = Math.sqrt(p1);
    const sqrtMin = Math.sqrt(rangeMin);
    const sqrtMax = Math.sqrt(rangeMax);

    // Initial position value
    const x0 = p0 >= rangeMax ? 0 : p0 <= rangeMin ? 1 / sqrtMin - 1 / sqrtMax : 1 / Math.sqrt(p0) - 1 / sqrtMax;
    const y0 = p0 <= rangeMin ? 0 : p0 >= rangeMax ? sqrtMax - sqrtMin : Math.sqrt(p0) - sqrtMin;
    const v0 = y0 + x0 * p0;

    // Value if held (HODL)
    const hodlValue = y0 + x0 * p1;

    // Value in LP
    const x1 = p1 >= rangeMax ? 0 : p1 <= rangeMin ? 1 / sqrtMin - 1 / sqrtMax : 1 / Math.sqrt(p1) - 1 / sqrtMax;
    const y1 = p1 <= rangeMin ? 0 : p1 >= rangeMax ? sqrtMax - sqrtMin : Math.sqrt(p1) - sqrtMin;
    const v1 = y1 + x1 * p1;

    // IL is the difference between LP value and HODL value
    const il = (v1 - hodlValue) / hodlValue;
    return il * 100; // Return as percentage (e.g., -0.5 is -0.5%)
}

export function estimateGasEfficiency(capitalUSD: number, chainId: number): number {
    // Hardcoded typical gas costs in USD for operations (add + rebalance + withdraw)
    let estimatedGasUSD = 15.0; // Default (e.g., Ethereum fallback)

    switch (chainId) {
        case 1: estimatedGasUSD = 50.0; break; // Ethereum
        case 137: estimatedGasUSD = 0.5; break; // Polygon
        case 10: estimatedGasUSD = 0.8; break; // Optimism
        case 42161: estimatedGasUSD = 0.5; break; // Arbitrum
        case 8453: estimatedGasUSD = 0.3; break; // Base
        case 56: estimatedGasUSD = 1.5; break; // BNB
    }

    // gas_ratio = gas_cost / capital
    return (estimatedGasUSD / capitalUSD) * 100; // Percentage
}

export function calculateFinalOpportunityScore(
    feeAPR: number,
    volEfficiency: number,
    volatility: number,
    liquidityDensity: number,
    gasEfficiency: number
): number {
    // Expected weights:
    // 0.30 * fee_APR
    // 0.25 * volume_efficiency
    // 0.20 * volatility
    // 0.15 * liquidity_density
    // 0.10 * gas_efficiency (inverse, so negative weight or subtracted)

    // Normalize inputs roughly to 0-100 scale if possible, assuming they are provided in reasonable scales
    // Gas efficiency is bad if high, so we subtract its scaled impact.

    const score =
        (0.30 * feeAPR) +
        (0.25 * volEfficiency * 100) + // volEfficiency usually fraction 0.05 etc, mapping to higher scale
        (0.20 * volatility * 100) + // volatility mapped similarly
        (0.15 * liquidityDensity) -
        (0.10 * gasEfficiency);

    return Math.max(0, score);
}

export function calculateRealisticAPR(
    volumeUSD: number,
    feeTier: number,
    expectedShare: number,
    tvlUSD: number
): number {
    if (tvlUSD <= 0) return 0;
    // volume * (feeTier / 1000000) = daily fees in USD
    // daily fees * 365 = yearly fees in USD
    // yearly * expectedShare = estimated fees for the position
    // APR relative to whole pool TVL (as requested): (fees / TVL) * 100
    const dailyFees = volumeUSD * (feeTier / 1000000);
    const yearlyFees = dailyFees * 365;
    const positionFees = yearlyFees * expectedShare;
    return (positionFees / tvlUSD) * 100;
}

export function estimateLiquidityInRange(ticks: any[], rangeMin: number, rangeMax: number, currentPrice: number): number {
    // A simplified heuristic to estimate active liquidity in a price range from tick data
    // Subgraph calculates prices from ticks slightly differently, but assume linear-ish distribution 
    // for simplicity if tick spacing isn't precisely mapped in the bot.
    // liquidityNet/Gross is abstract, but we can sum gross liquidity in the bounds.
    let totalGrossLiquidity = 0;
    // VERY rough approximation: simply sum up the liquidityGross of ticks that are "near" the current price
    // Since tick to price math is complex (price = 1.0001^tick), we'll do a basic sum for density comparison.
    for (const tick of ticks) {
        const tickPrice = Math.pow(1.0001, parseInt(tick.tickIdx));
        if (tickPrice >= rangeMin && tickPrice <= rangeMax) {
            totalGrossLiquidity += parseFloat(tick.liquidityGross);
        }
    }
    return totalGrossLiquidity;
}

export function calculateRiskScore(
    volatility: number,
    ilProbability: number, // from 0 to 1
    liquidityStability: number // e.g. vol/tvl fraction, 0 to 1
): number {
    // Higher score means higher risk. Scale 0 to 100.
    // Volatility: high ATR means high risk
    // IL Prob: likely IL means high risk
    // Liquidity Stability: Highly unstable liquidity (high daily vol vs low TVL) might imply fleeting liquidity

    // Normalize inputs roughly
    const volScore = Math.min(volatility * 100 * 5, 40); // cap at 40
    const ilScore = Math.min(ilProbability * 100 * 10, 40); // cap at 40
    const stabilityScore = Math.min((1 - liquidityStability) * 100, 20); // cap at 20

    return volScore + ilScore + stabilityScore;
}
