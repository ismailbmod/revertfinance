
import { tickToPrice } from './subgraph';

export function calculateEstimatedAPR(pos: any): string {
    const feeTier = parseInt(pos.pool.feeTier) / 1000000;
    const tvl = parseFloat(pos.pool.totalValueLockedUSD);
    if (tvl === 0) return '0.00%';
    const baseAPR = (feeTier * parseFloat(pos.pool.volumeUSD)) / tvl;
    const annualAPR = baseAPR * 100;
    if (annualAPR > 1000) return '100.00%+';
    return annualAPR > 0 ? `${annualAPR.toFixed(2)}%` : '0.00%';
}

export function calculateLPValue(pos: any, ethPrice: number) {
    const liquidity = parseFloat(pos.liquidity);
    const tickCurrent = parseInt(pos.pool.tick);
    const tickLower = parseInt(pos.tickLower.tickIdx);
    const tickUpper = parseInt(pos.tickUpper.tickIdx);

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

    const p0 = pos.pool.token0.symbol.includes('USD') ? 1 : ethPrice;
    const p1 = pos.pool.token1.symbol.includes('USD') ? 1 : ethPrice;

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
