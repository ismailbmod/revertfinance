/**
 * Technical Indicators for Crypto Market Analysis
 */

export function calculateEMA(prices: number[], period: number): number[] {
    const k = 2 / (period + 1);
    let ema = [prices[0]];
    for (let i = 1; i < prices.length; i++) {
        ema.push(prices[i] * k + ema[i - 1] * (1 - k));
    }
    return ema;
}

export function calculateATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
    const tr: number[] = [highs[0] - lows[0]];
    for (let i = 1; i < highs.length; i++) {
        const hl = highs[i] - lows[i];
        const hpc = Math.abs(highs[i] - closes[i - 1]);
        const lpc = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(hl, hpc, lpc));
    }

    const atr: number[] = [tr.slice(0, period).reduce((a, b) => a + b) / period];
    for (let i = period; i < tr.length; i++) {
        atr.push((atr[atr.length - 1] * (period - 1) + tr[i]) / period);
    }
    return atr;
}

export function calculateADX(highs: number[], lows: number[], closes: number[], period: number): { adx: number[]; plusDI: number[]; minusDI: number[] } {
    const tr: number[] = [];
    const plusDM: number[] = [];
    const minusDM: number[] = [];

    for (let i = 1; i < highs.length; i++) {
        const hl = highs[i] - lows[i];
        const hpc = Math.abs(highs[i] - closes[i - 1]);
        const lpc = Math.abs(lows[i] - closes[i - 1]);
        tr.push(Math.max(hl, hpc, lpc));

        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];

        if (upMove > downMove && upMove > 0) {
            plusDM.push(upMove);
        } else {
            plusDM.push(0);
        }

        if (downMove > upMove && downMove > 0) {
            minusDM.push(downMove);
        } else {
            minusDM.push(0);
        }
    }

    const smoothTR: number[] = [tr.slice(0, period).reduce((a, b) => a + b)];
    const smoothPlusDM: number[] = [plusDM.slice(0, period).reduce((a, b) => a + b)];
    const smoothMinusDM: number[] = [minusDM.slice(0, period).reduce((a, b) => a + b)];

    for (let i = period; i < tr.length; i++) {
        smoothTR.push(smoothTR[smoothTR.length - 1] - smoothTR[smoothTR.length - 1] / period + tr[i]);
        smoothPlusDM.push(smoothPlusDM[smoothPlusDM.length - 1] - smoothPlusDM[smoothPlusDM.length - 1] / period + plusDM[i]);
        smoothMinusDM.push(smoothMinusDM[smoothMinusDM.length - 1] - smoothMinusDM[smoothMinusDM.length - 1] / period + minusDM[i]);
    }

    const plusDI = smoothPlusDM.map((v, i) => (v / smoothTR[i]) * 100);
    const minusDI = smoothMinusDM.map((v, i) => (v / smoothTR[i]) * 100);

    const dx = plusDI.map((v, i) => (Math.abs(v - minusDI[i]) / (v + minusDI[i])) * 100);

    const adx: number[] = [dx.slice(0, period).reduce((a, b) => a + b) / period];
    for (let i = period; i < dx.length; i++) {
        adx.push((adx[adx.length - 1] * (period - 1) + dx[i]) / period);
    }

    return { adx, plusDI, minusDI };
}

export function detectRegime(ema20: number, ema50: number, adx: number): 'trend' | 'range' | 'neutral' {
    if (adx > 25) {
        if (Math.abs((ema20 - ema50) / ema50) > 0.005) {
            return 'trend';
        }
    }
    if (adx < 20) {
        return 'range';
    }
    return 'neutral';
}


export function calculateRSI(prices: number[], period: number): number[] {
    const rsi: number[] = [];
    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < prices.length; i++) {
        const difference = prices[i] - prices[i - 1];
        gains.push(Math.max(0, difference));
        losses.push(Math.max(0, -difference));
    }

    let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;

    for (let i = period; i < gains.length; i++) {
        rsi.push(100 - (100 / (1 + (avgGain / (avgLoss || 1)))));
        avgGain = (avgGain * (period - 1) + gains[i]) / period;
        avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    return rsi;
}

export function calculateVolumeSpike(volumes: number[], period: number = 14): number {
    if (volumes.length < period) return 1;
    const currentVolume = volumes[volumes.length - 1];
    const prevVolumes = volumes.slice(-period - 1, -1);
    const avgVolume = prevVolumes.reduce((a, b) => a + b, 0) / period;
    return avgVolume > 0 ? currentVolume / avgVolume : 1;
}
