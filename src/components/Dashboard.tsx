"use client"

import React, { useState, useEffect } from 'react';
import { TrendingUp, Activity, Bell, Settings, ArrowUpRight, ArrowDownRight, RefreshCw, Zap, Search } from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell, ComposedChart, ReferenceArea, ReferenceLine
} from 'recharts';
import { formatDistanceToNow } from 'date-fns';

const mockData = [
    { time: '00:00', price: 2.45 },
    { time: '04:00', price: 2.48 },
    { time: '08:00', price: 2.42 },
    { time: '12:00', price: 2.51 },
    { time: '16:00', price: 2.55 },
    { time: '20:00', price: 2.52 },
    { time: '23:59', price: 2.58 },
];

interface Position {
    id: string;
    pair: string;
    range: string;
    apr: string;
    status: string;
    chainId: number;
    chainName: string;
    poolAddress: string;
    valueUSD: number;
    ilUSD: number;
    feesUSD: number;
    netProfitUSD: number;
    marketAlert?: string;
}

export default function Dashboard() {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [signals, setSignals] = useState<any[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [balances, setBalances] = useState<any[]>([]);
    const [selectedChainId, setSelectedChainId] = useState(1);
    const [topPools, setTopPools] = useState<any[]>([]);
    const [selectedPoolAddress, setSelectedPoolAddress] = useState('');
    const [selectedPair, setSelectedPair] = useState('ETH/USDC');
    const [isWalletLoading, setIsWalletLoading] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [isDetectingHighYield, setIsDetectingHighYield] = useState(false);
    const [isLoadingPools, setIsLoadingPools] = useState(false);
    const [highYieldPools, setHighYieldPools] = useState<any[]>([]);
    const [alphaSniperResults, setAlphaSniperResults] = useState<any[]>([]);
    const [isSniping, setIsSniping] = useState(false);
    const [hasRunSniper, setHasRunSniper] = useState(false);
    const [poolSearch, setPoolSearch] = useState('');
    const [settings, setSettings] = useState<{
        wallets: string[];
        risk_profile: string;
        telegram_chat_id: string;
        watched_pairs: string[];
    }>({
        wallets: [],
        risk_profile: 'moderate',
        telegram_chat_id: '',
        watched_pairs: ['ZEC/USDT', 'ETH/USDC', 'WBTC/USDT']
    });

    useEffect(() => {
        fetchSettings();
        fetchSignals();
        fetchPositions();
        fetchBalances();
        fetchPools(selectedChainId);
    }, []);

    useEffect(() => {
        setTopPools([]); // Clear pools on chain change
        fetchPools(selectedChainId);
    }, [selectedChainId]);

    const fetchPools = async (chainId: number) => {
        setIsLoadingPools(true);
        try {
            const res = await fetch(`/api/pools?chainId=${chainId}&first=200&minTVL=10000`);
            const data = await res.json();
            if (!data.error && Array.isArray(data)) {
                setTopPools(data);
                // Set first pool as default if available
                if (data.length > 0) {
                    const first = data[0];
                    setSelectedPair(`${first.token0.symbol}/${first.token1.symbol}`);
                    setSelectedPoolAddress(first.id);
                }
            } else {
                setTopPools([]);
            }
        } catch (e) {
            console.error(e);
            setTopPools([]);
        } finally {
            setIsLoadingPools(false);
        }
    };

    const fetchSettings = async () => {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (!data.error) {
            setSettings(prev => ({
                ...prev,
                ...data,
                watched_pairs: data.watched_pairs || prev.watched_pairs
            }));
        }
    };

    const fetchSignals = async () => {
        const res = await fetch('/api/signals');
        const data = await res.json();
        if (!data.error) setSignals(data);
    };

    const fetchPositions = async () => {
        const res = await fetch('/api/positions');
        const data = await res.json();
        if (!data.error) setPositions(data);
    };

    const fetchBalances = async () => {
        setIsWalletLoading(true);
        try {
            const res = await fetch('/api/balances');
            const data = await res.json();
            if (!data.error) setBalances(data);
        } catch (e) {
            console.error(e);
        } finally {
            setIsWalletLoading(false);
        }
    };

    const handleUpdateSetting = async (key: string, value: any) => {
        await fetch('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ key, value })
        });
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const [lastAnalysis, setLastAnalysis] = useState<any>(null);
    const totalWalletUSD = balances.reduce((sum, b) => sum + (b.balanceUSD || 0), 0);
    const totalLPUSD = positions.reduce((sum, p) => sum + (p.valueUSD || 0), 0);
    const totalPortfolioUSD = totalWalletUSD + totalLPUSD;

    const [scanLimit, setScanLimit] = useState(3);
    const formatPrice = (p: number) => {
        if (!p) return '0.00';
        if (p < 0.0001) return p.toFixed(8);
        if (p < 0.01) return p.toFixed(6);
        return p.toFixed(4);
    };

    const triggerAnalysis = async (posOverride?: Position | any, silent: boolean = false) => {
        if (!silent) setIsAnalyzing(true);
        else setIsRefreshing(true);

        const pair = posOverride ? posOverride.pair : selectedPair;
        const chainId = posOverride ? posOverride.chainId : selectedChainId;
        const poolAddress = posOverride ? posOverride.poolAddress || posOverride.id : selectedPoolAddress;

        if (posOverride) {
            setSelectedPair(posOverride.pair);
            setSelectedChainId(posOverride.chainId);
            setSelectedPoolAddress(posOverride.poolAddress || posOverride.id);
        }

        try {
            const res = await fetch('/api/analyze', {
                method: 'POST',
                body: JSON.stringify({
                    pool: { symbol: pair, chainId, poolAddress },
                    riskProfile: settings.risk_profile,
                    silent
                })
            });
            const data = await res.json();
            if (res.ok && data.result) {
                setLastAnalysis(data.result);
                if (!silent) {
                    fetchSignals();
                    fetchPositions();
                    fetchBalances();
                }
            } else if (!silent) {
                setLastAnalysis(null);
                const errorMsg = data.error || (data.result === null ? "Price oracle not found on Binance for this pair." : "Analysis unavailable.");
                alert(`Analysis Error: ${errorMsg}`);
            }
        } catch (e) {
            console.error(e);
        }
        setIsAnalyzing(false);
        setIsRefreshing(false);
    };


    // Phase 2: Market Scan
    const runMarketScan = async () => {
        setIsScanning(true);
        try {
            const res = await fetch('/api/scan', {
                method: 'POST',
                body: JSON.stringify({
                    riskProfile: settings.risk_profile,
                    limit: scanLimit
                })
            });
            const data = await res.json();
            if (data.success && data.topopportunities && data.topopportunities.length > 0) {
                const formattedSignals = data.topopportunities.map((opp: any, idx: number) => ({
                    id: `scan-${Date.now()}-${idx}`,
                    type: 'scan',
                    asset_pair: opp.pool,
                    created_at: new Date().toISOString(),
                    message: `Market Scan. Regime: ${opp.analysis.indicators?.regime?.toUpperCase() || 'N/A'}. Strategy: ${opp.analysis.recommendation?.strategy || 'N/A'}`,
                    data: {
                        currentPrice: opp.analysis.currentPrice,
                        confidence: opp.confidence,
                        chainId: opp.chainId,
                        poolAddress: opp.poolAddress,
                        ...opp.analysis
                    }
                }));
                setSignals(formattedSignals);
            } else if (data.success) {
                setSignals([]); // Clear old results to reflect current state
                alert("Scan complete! No high-yield opportunities met the current validation criteria on the scanned networks.");
            } else {
                alert(`Scan failed: ${data.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Scan failed:', error);
            alert("A network error occurred during the market scan. Please try again.");
        } finally {
            setIsScanning(false);
        }
    };

    const runHighYieldDetection = async () => {
        setIsDetectingHighYield(true);
        try {
            const res = await fetch('/api/high-yield', {
                method: 'POST'
            });
            const data = await res.json();
            if (data.success && data.highYieldPools) {
                setHighYieldPools(data.highYieldPools);
                if (data.highYieldPools.length === 0) {
                    alert("No High Yield (0.3%+) opportunities found at this time with TVL > 5M.");
                }
            }
        } catch (error) {
            console.error('High yield detection failed:', error);
            alert("A network error occurred during the high yield detection.");
        } finally {
            setIsDetectingHighYield(false);
        }
    };

    const runAlphaSniperScan = async () => {
        setIsSniping(true);
        try {
            const res = await fetch('/api/alpha-sniper', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setAlphaSniperResults(data.opportunities || []);
                setHasRunSniper(true);
            } else {
                alert(data.error || 'Alpha Sniper scan failed');
            }
        } catch (error) {
            console.error('Sniper Scan Error:', error);
            alert('Failed to trigger Alpha Sniper');
        } finally {
            setIsSniping(false);
        }
    };

    const handleSignalClick = (signal: any) => {
        const chainId = signal.data?.chainId || signal.metadata?.chainId || selectedChainId;
        const poolAddress = signal.data?.poolAddress || '';

        setSelectedChainId(chainId);
        setSelectedPair(signal.asset_pair);
        if (poolAddress) {
            setSelectedPoolAddress(poolAddress);
            triggerAnalysis({ pair: signal.asset_pair, chainId, poolAddress }, false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    return (
        <div className="min-h-screen p-6 max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <header className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                        Revert Optimizer
                    </h1>
                    <p className="text-slate-400 mt-1">Semi-Automatic LP Management Engine</p>
                </div>
                <div className="flex gap-4">
                    <button
                        onClick={() => triggerAnalysis()}
                        className="p-2 glass-card hover:bg-slate-800 transition-colors"
                    >
                        <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={() => setShowSettings(true)}
                        className="p-2 glass-card hover:bg-slate-800 transition-colors"
                    >
                        <Settings className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {/* Settings Modal */}
            {showSettings && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="glass-card w-full max-w-md p-8 space-y-6 shadow-2xl border-blue-500/30">
                        <div className="flex justify-between items-center">
                            <h2 className="text-2xl font-bold">App Settings</h2>
                            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white">✕</button>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Risk Profile</label>
                                <select
                                    value={settings.risk_profile}
                                    onChange={(e) => handleUpdateSetting('risk_profile', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="risky">Risky (Aggressive Fees)</option>
                                    <option value="medium">Medium (Balanced)</option>
                                    <option value="moderate">Moderate (Safety First)</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Watched Pairs (comma separated)</label>
                                <input
                                    type="text"
                                    value={settings.watched_pairs.join(', ')}
                                    onChange={(e) => setSettings(prev => ({ ...prev, watched_pairs: e.target.value.split(',').map(s => s.trim()) }))}
                                    onBlur={(e) => handleUpdateSetting('watched_pairs', e.target.value.split(',').map(s => s.trim()))}
                                    placeholder="ZEC/USDT, ETH/USDC"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Telegram Chat ID</label>
                                <input
                                    type="text"
                                    value={settings.telegram_chat_id}
                                    onChange={(e) => setSettings(prev => ({ ...prev, telegram_chat_id: e.target.value }))}
                                    onBlur={(e) => handleUpdateSetting('telegram_chat_id', e.target.value)}
                                    placeholder="Enter Chat ID"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-400">Wallet Addresses (comma separated)</label>
                                <textarea
                                    rows={3}
                                    value={settings.wallets.join(', ')}
                                    onChange={(e) => setSettings(prev => ({ ...prev, wallets: e.target.value.split(',').map(s => s.trim()) }))}
                                    onBlur={(e) => handleUpdateSetting('wallets', e.target.value.split(',').map(s => s.trim()))}
                                    placeholder="0x..."
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        </div>

                        <button
                            onClick={() => setShowSettings(false)}
                            className="w-full py-3 premium-gradient rounded-xl font-bold uppercase tracking-wider"
                        >
                            Save & Close
                        </button>
                    </div>
                </div>
            )}

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-card p-6 border-l-4 border-blue-500">
                    <div className="flex justify-between items-start">
                        <p className="text-slate-400 text-sm font-medium">Total Portfolio Value</p>
                        <TrendingUp className="text-blue-500 w-5 h-5" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-white">${totalPortfolioUSD.toFixed(2)}</span>
                        <span className="text-emerald-500 text-sm font-medium">Live</span>
                    </div>
                </div>
                <div className="glass-card p-6 border-l-4 border-purple-500">
                    <div className="flex justify-between items-start">
                        <p className="text-slate-400 text-sm font-medium">Active Positions</p>
                        <Activity className="text-purple-500 w-5 h-5" />
                    </div>
                    <div className="mt-2 text-3xl font-bold text-white">{positions.length}</div>
                </div>
                <div className="glass-card p-6 border-l-4 border-emerald-500 relative overflow-hidden">
                    <div className="flex justify-between items-start">
                        <p className="text-slate-400 text-sm font-medium">Wallet Assets (All Chains)</p>
                        <div className="flex items-center gap-2">
                            {isWalletLoading && <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin" />}
                            <ArrowUpRight className="text-emerald-500 w-5 h-5" />
                        </div>
                    </div>
                    <div className="mt-2 text-sm max-h-[100px] overflow-y-auto custom-scrollbar">
                        {balances.filter(b => parseFloat(b.balance) > 0).map((b, idx) => (
                            <div key={`${b.symbol}-${idx}`} className="flex justify-between items-center text-sm py-1 border-b border-slate-800/30 last:border-0 hover:bg-white/[0.02] transition-colors px-1">
                                <div className="flex flex-col">
                                    <span className="text-slate-400 font-medium">{b.symbol}</span>
                                    <span className="text-[10px] text-slate-500">Chain: {b.chainId === 1 ? 'ETH' : b.chainId === 137 ? 'Polygon' : b.chainId === 10 ? 'OP' : b.chainId === 42161 ? 'Arb' : 'Base'}</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="font-bold text-white">{parseFloat(b.balance).toFixed(4)}</span>
                                    <span className="text-[10px] text-emerald-500/80 font-black">${(b.balanceUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            </div>
                        ))}
                        {balances.filter(b => parseFloat(b.balance) > 0).length === 0 && <span className="text-slate-500 italic text-xs">No assets found</span>}
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Chart Section */}
                <div className="lg:col-span-2 glass-card p-6 space-y-6 relative overflow-hidden">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                                Market Analysis
                                {isAnalyzing && <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />}
                            </h2>
                            <div className="flex gap-2">
                                <select
                                    value={selectedChainId}
                                    onChange={(e) => setSelectedChainId(parseInt(e.target.value))}
                                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                                >
                                    <option value={1}>Ethereum</option>
                                    <option value={137}>Polygon</option>
                                    <option value={10}>Optimism</option>
                                    <option value={42161}>Arbitrum</option>
                                    <option value={8453}>Base</option>
                                    <option value={56}>BNB Chain</option>
                                </select>
                                <div className="relative group">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <Search className="w-3 h-3 text-slate-500" />
                                    </div>
                                    <input 
                                        type="text"
                                        placeholder="Search pair (e.g. SN3)"
                                        value={poolSearch}
                                        onChange={(e) => setPoolSearch(e.target.value)}
                                        className="bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-blue-500 w-[180px] transition-all"
                                    />
                                </div>
                                <select
                                    value={selectedPoolAddress}
                                    onChange={(e) => {
                                        const pool = topPools.find(p => p.id === e.target.value);
                                        if (pool) {
                                            setSelectedPoolAddress(pool.id);
                                            setSelectedPair(`${pool.token0.symbol}/${pool.token1.symbol}`);
                                        }
                                    }}
                                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-blue-500 max-w-[150px] transition-all"
                                >
                                    {isLoadingPools ? (
                                        <option value="">Loading pools...</option>
                                    ) : topPools.length > 0 ? (
                                        (() => {
                                            const filtered = Array.from(new Set(topPools.map(p => `${p.token0.symbol}/${p.token1.symbol}`)))
                                                .filter(pair => pair.toLowerCase().includes(poolSearch.toLowerCase()));
                                            
                                            if (filtered.length === 0) return <option value="">No matching pairs</option>;
                                            
                                            return filtered.map(pairSymbol => {
                                                const firstPool = topPools.find(p => `${p.token0.symbol}/${p.token1.symbol}` === pairSymbol);
                                                return (
                                                    <option key={firstPool.id} value={firstPool.id}>
                                                        {pairSymbol}
                                                    </option>
                                                );
                                            });
                                        })()
                                    ) : (
                                        <option value="">No pools found</option>
                                    )}
                                </select>
                            </div>
                        </div>

                        <button
                            onClick={() => triggerAnalysis(undefined, false)}
                            disabled={isRefreshing || isAnalyzing || !selectedPoolAddress}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2 active:scale-95"
                        >
                            {isAnalyzing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                            {isAnalyzing ? 'Analyzing...' : 'Analyze Market Now'}
                        </button>
                    </div>
                    <div className="flex gap-2">
                        <span className="px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-semibold">
                            {lastAnalysis ? `$${formatPrice(lastAnalysis.currentPrice)}` : 'Live Price'}
                        </span>
                        {lastAnalysis && (
                            <div className="flex gap-2">
                                <span className={`px-3 py-1 rounded-full text-[10px] font-bold border ${['STRONG TREND', 'VOLATILE TREND'].includes(lastAnalysis.marketRegime) ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                                    ['TREND', 'MIXED'].includes(lastAnalysis.marketRegime) ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                        'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    }`}>
                                    Regime: {lastAnalysis.marketRegime}
                                </span>
                                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full text-[10px] font-semibold border border-emerald-500/20">
                                    Range: ${formatPrice(lastAnalysis.rangeMin)} - ${formatPrice(lastAnalysis.rangeMax)}
                                </span>
                                {lastAnalysis.stopLoss && (
                                    <span className="px-3 py-1 bg-rose-500/10 text-rose-400 rounded-full text-[10px] font-semibold border border-rose-500/20">
                                        Stop Loss: ${formatPrice(lastAnalysis.stopLoss)}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className={`h-[300px] w-full mt-4 transition-opacity duration-300 ${isAnalyzing ? 'opacity-30' : 'opacity-100'}`}>
                        {lastAnalysis ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={lastAnalysis.chartData}>
                                    <defs>
                                        <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#26262a" vertical={false} />
                                    <XAxis
                                        dataKey="time"
                                        stroke="#64748b"
                                        fontSize={10}
                                        tickLine={false}
                                        axisLine={false}
                                        minTickGap={30}
                                    />
                                    <YAxis
                                        domain={['auto', 'auto']}
                                        stroke="#64748b"
                                        fontSize={10}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(val) => `$${val.toFixed(2)}`}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#161618', borderColor: '#26262a', color: '#fff', borderRadius: '8px', fontSize: '12px' }}
                                        itemStyle={{ color: '#3b82f6' }}
                                        formatter={(value: any) => [`$${formatPrice(parseFloat(value))}`, 'Price']}
                                    />

                                    <ReferenceArea
                                        y1={lastAnalysis.rangeMin}
                                        y2={lastAnalysis.rangeMax}
                                        fill="#10b981"
                                        fillOpacity={0.1}
                                        stroke="#10b981"
                                        strokeOpacity={0.3}
                                        strokeDasharray="3 3"
                                    />

                                    <ReferenceLine
                                        y={lastAnalysis.currentPrice}
                                        stroke="#3b82f6"
                                        strokeDasharray="3 3"
                                        label={{ position: 'right', value: 'Live', fill: '#3b82f6', fontSize: 10 }}
                                    />

                                    {lastAnalysis.stopLoss && (
                                        <ReferenceLine
                                            y={lastAnalysis.stopLoss}
                                            stroke="#f43f5e"
                                            strokeDasharray="5 5"
                                            label={{ position: 'left', value: 'Stop Loss', fill: '#f43f5e', fontSize: 10 }}
                                        />
                                    )}

                                    <Area
                                        type="monotone"
                                        dataKey="price"
                                        stroke="#3b82f6"
                                        strokeWidth={2}
                                        fillOpacity={1}
                                        fill="url(#colorPrice)"
                                        animationDuration={1000}
                                    />
                                </ComposedChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full w-full flex flex-col items-center justify-center bg-slate-900/20 rounded-3xl border border-slate-800/50 border-dashed">
                                <Activity className="w-12 h-12 text-slate-800 mb-4" />
                                <p className="text-slate-500 text-sm italic">Click "Analyze Market Now" to load the live chart and metrics.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Analysis Details Panel */}
                <div className="glass-card p-6 space-y-6">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Activity className="w-5 h-5 text-blue-500" />
                            Detailed Metrics
                        </h2>
                        {lastAnalysis && lastAnalysis.recommendation && (
                            <div className="flex flex-col items-end gap-1">
                                <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${lastAnalysis.safetyScore >= 80 ? 'bg-emerald-500/10 text-emerald-400' :
                                    lastAnalysis.safetyScore >= 60 ? 'bg-blue-500/10 text-blue-400' :
                                        lastAnalysis.safetyScore >= 40 ? 'bg-amber-500/10 text-amber-400' :
                                            'bg-rose-500/10 text-rose-400'
                                    }`}>
                                    Safety: {lastAnalysis.safetyScore}/100
                                </span>
                                {lastAnalysis.marketRegime && (
                                    <span className={`text-[10px] font-bold uppercase tracking-tighter ${['STABLE RANGE', 'RANGING'].includes(lastAnalysis.marketRegime) ? 'text-emerald-400' :
                                        ['MIXED', 'TREND'].includes(lastAnalysis.marketRegime) ? 'text-amber-400' :
                                            'text-rose-400'
                                        }`}>
                                        Regime: {lastAnalysis.marketRegime}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    {!lastAnalysis && (
                        <div className="py-20 text-center space-y-4">
                            <div className="w-12 h-12 bg-slate-900/50 rounded-full flex items-center justify-center mx-auto border border-slate-800">
                                <TrendingUp className="w-6 h-6 text-slate-700" />
                            </div>
                            <p className="text-slate-500 text-sm">Select a pair to see detailed indicators.</p>
                        </div>
                    )}

                    {lastAnalysis && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
                            {/* Price & Strategy */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-slate-900/40 rounded-2xl border border-slate-800/50">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Live Price</p>
                                    <p className="text-lg font-bold text-white">${formatPrice(lastAnalysis.currentPrice)}</p>
                                </div>
                                <div className="p-4 bg-slate-900/40 rounded-2xl border border-slate-800/50">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Recommended Fee</p>
                                    <p className="text-lg font-bold text-blue-400">{(lastAnalysis.recommendation.feeTier / 10000).toFixed(2)}%</p>
                                </div>
                            </div>

                             {/* Optimal Range & Exit */}
                            <div className="space-y-3">
                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-2">Strategy Parameters</p>
                                <div className="grid grid-cols-1 gap-3">
                                    {/* Optimal Range */}
                                    <div className="p-3 bg-slate-900/40 rounded-xl border border-emerald-500/20 relative">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-[9px] font-bold text-emerald-400/80 uppercase">Optimal Range</span>
                                            <span className="text-[9px] text-emerald-400 font-bold">Stable APR: {lastAnalysis.realisticAPR?.toFixed(1)}%</span>
                                        </div>
                                        <div className="flex justify-between mb-2">
                                            <div className="flex flex-col">
                                                <span className="text-[8px] text-slate-500 uppercase">Min</span>
                                                <span className="text-sm font-bold text-white">${formatPrice(lastAnalysis.rangeMin)}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-[8px] text-slate-500 uppercase">Max</span>
                                                <span className="text-sm font-bold text-white">${formatPrice(lastAnalysis.rangeMax)}</span>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center border-t border-slate-800/80 pt-2 mt-2">
                                            <span className="text-[9px] font-medium text-slate-400 text-center flex-1">Width: {lastAnalysis.rangeWidthPct?.toFixed(2)}%</span>
                                            <span className="text-[9px] font-medium text-emerald-500/80 text-center flex-1 border-l border-slate-800">~{lastAnalysis.estimatedTimeHours || 0}h Est. Lifetime</span>
                                        </div>
                                    </div>

                                    {/* Stop Loss */}
                                    {lastAnalysis.stopLoss && (
                                        <div className="p-3 bg-slate-900/40 rounded-xl border border-rose-500/20 relative">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-[9px] font-bold text-rose-400/80 uppercase">Lower Exit (Stop Loss)</span>
                                                <span className="text-[9px] text-slate-500 font-medium">Auto-Swap</span>
                                            </div>
                                            <div className="flex justify-center mb-2">
                                                <span className="text-sm font-bold text-white">${formatPrice(lastAnalysis.stopLoss)}</span>
                                            </div>
                                            <div className="flex justify-between items-center border-t border-slate-800/80 pt-2 mt-2">
                                                <span className="text-[9px] font-medium text-slate-400 text-center flex-1">Est. Loss: -{lastAnalysis.estimatedLossPct?.toFixed(2)}%</span>
                                                <span className="text-[9px] font-medium text-rose-400/80 text-center flex-1 border-l border-slate-800">R/R Ratio: {lastAnalysis.riskRewardRatio?.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Technical Indicators */}
                            <div className="space-y-3">
                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-2">Technical Indicators</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex justify-between items-center p-3 bg-slate-900/30 rounded-xl border border-slate-800/30">
                                        <span className="text-xs text-slate-400">Regime</span>
                                        <span className="text-xs font-bold text-white uppercase">{lastAnalysis.indicators?.regime || '---'}</span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-slate-900/30 rounded-xl border border-slate-800/30">
                                        <span className="text-xs text-slate-400">Volume Spike</span>
                                        <span className={`text-xs font-bold ${lastAnalysis.indicators?.volumeSpike > 2 ? 'text-rose-400' : 'text-white'}`}>
                                            {lastAnalysis.indicators?.volumeSpike?.toFixed(1) || '---'}x
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-slate-900/30 rounded-xl border border-slate-800/30">
                                        <span className="text-xs text-slate-400">ATR</span>
                                        <span className="text-xs font-bold text-white">{lastAnalysis.indicators?.atr?.toFixed(4) || '---'}</span>
                                    </div>
                                    <div className="flex justify-between items-center p-3 bg-slate-900/30 rounded-xl border border-slate-800/30">
                                        <span className="text-xs text-slate-400">RSI</span>
                                        <span className="text-xs font-bold text-white">{lastAnalysis.indicators?.rsi?.toFixed(2) || '---'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Strategy Recommendation */}
                            <div className="p-4 bg-gradient-to-br from-blue-600/10 to-purple-600/10 rounded-2xl border border-blue-500/20">
                                <div className="flex justify-between items-center mb-2">
                                    <p className="text-[10px] text-blue-400 uppercase font-bold tracking-wider">Bot Strategy</p>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${lastAnalysis.tradeRecommendation === 'STRONG BUY' ? 'bg-emerald-500/20 text-emerald-400' : lastAnalysis.tradeRecommendation === 'MODERATE' ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'}`}>{lastAnalysis.tradeRecommendation}</span>
                                </div>
                                <p className="text-sm font-medium text-white mb-1">{lastAnalysis.recommendation?.strategy || '---'}</p>
                                <p className="text-[10px] text-slate-500 leading-relaxed italic">
                                    Based on volatility and volume, this setup targets optimal fee capture while maintaining a safety margin.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Market Scanner Section (Relocated & Improved) */}
            <div className="glass-card p-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div>
                        <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                            <Bell className="w-6 h-6 text-amber-500" />
                            Market Scanner
                        </h2>
                        <p className="text-slate-400 text-sm mt-1">Cross-pair analysis to find top high-yield LP opportunities</p>
                    </div>

                    <div className="flex items-center gap-3 bg-slate-900/80 p-2 rounded-2xl border border-slate-800">
                        <div className="flex items-center gap-2 px-3">
                            <span className="text-xs text-slate-500 font-medium">Scan Limit</span>
                            <select
                                value={scanLimit}
                                onChange={(e) => setScanLimit(parseInt(e.target.value))}
                                className="bg-slate-800 border-none rounded-lg px-2 py-1 text-xs text-white outline-none cursor-pointer hover:bg-slate-700 transition-colors"
                            >
                                <option value={3}>TOP 3</option>
                                <option value={4}>TOP 4</option>
                                <option value={5}>TOP 5</option>
                                <option value={10}>TOP 10</option>
                            </select>
                        </div>
                        <div className="w-[1px] h-6 bg-slate-800"></div>
                        <button
                            onClick={runMarketScan}
                            disabled={isScanning}
                            className={`flex items-center gap-3 px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/20 ${isScanning ? 'animate-pulse cursor-not-allowed' : 'active:scale-95'}`}
                        >
                            <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                            {isScanning ? 'Scanning Network...' : 'Execute Market Scan'}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {isScanning && (
                        <div className="col-span-full py-16 text-center space-y-4">
                            <div className="relative inline-block">
                                <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <Activity className="w-6 h-6 text-blue-500 animate-pulse" />
                                </div>
                            </div>
                            <div>
                                <h3 className="text-white font-bold">Analyzing Liquidity Pools</h3>
                                <p className="text-slate-500 text-sm max-w-xs mx-auto mt-1">Fetching volume and volatility data for top pairs across ALL supported networks...</p>
                            </div>
                        </div>
                    )}

                    {!isScanning && signals.length === 0 && (
                        <div className="col-span-full py-16 text-center border-2 border-dashed border-slate-800/50 rounded-3xl">
                            <Bell className="w-12 h-12 text-slate-800 mx-auto mb-4" />
                            <p className="text-slate-500 text-sm">No recent scan results. Initiate a scan above.</p>
                        </div>
                    )}

                    {!isScanning && signals.map(signal => {
                        const signalChainId = signal.data?.chainId || signal.metadata?.chainId || 1;
                        const networkName = signalChainId === 137 ? 'Polygon' : signalChainId === 1 ? 'Ethereum' : signalChainId === 10 ? 'Optimism' : signalChainId === 42161 ? 'Arbitrum' : signalChainId === 8453 ? 'Base' : signalChainId === 56 ? 'BNB' : `Chain ${signalChainId}`;

                        return (
                            <div key={signal.id} onClick={() => handleSignalClick(signal)} className="p-5 rounded-3xl bg-slate-900/30 border border-slate-800/50 hover:border-blue-500/30 transition-all cursor-pointer group hover:bg-slate-900/50">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex flex-col">
                                        <h4 className="font-bold text-white group-hover:text-blue-400 transition-colors">
                                            {signal.asset_pair}
                                            <span className="ml-2 text-[9px] text-slate-400 font-medium px-1.5 py-0.5 bg-slate-800 rounded">
                                                {networkName}
                                            </span>
                                        </h4>
                                        <span className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
                                            {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
                                        </span>
                                    </div>
                                    <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase tracking-wider ${signal.type === 'scan' ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/10 text-emerald-400'
                                        }`}>
                                        {signal.type}
                                    </span>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Price</span>
                                        <span className="text-white font-mono">${(signal.data?.currentPrice || signal.metadata?.price)?.toFixed(4) || '---'}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Safety Score</span>
                                        <span className={`font-bold ${signal.data?.safetyScore >= 80 ? 'text-emerald-400' :
                                            signal.data?.safetyScore >= 60 ? 'text-blue-400' :
                                                signal.data?.safetyScore >= 40 ? 'text-amber-400' :
                                                    'text-rose-400'
                                            }`}>
                                            {signal.data?.safetyScore || '--'}/100
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Regime</span>
                                        <span className={`font-bold uppercase ${signal.data?.marketRegime === 'Good' ? 'text-emerald-400' :
                                            signal.data?.marketRegime === 'Risky' ? 'text-amber-400' :
                                                'text-rose-400'
                                            }`}>
                                            {signal.data?.marketRegime || '--'}
                                        </span>
                                    </div>
                                    <div className="pt-3 border-t border-slate-800/50">
                                        <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2 italic">
                                            {signal.message.replace(/\*/g, '').replace(/`/g, '').split('\n').filter(Boolean).filter((l: string) => !l.includes(':')).join(' ')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Alpha High Yield Detector Section */}
                <div className="glass-card p-8 mt-8 border-t-2 border-amber-500/30">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                        <div>
                            <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                                <Zap className="w-6 h-6 text-amber-500" />
                                Alpha High Yield Detector
                            </h2>
                            <p className="text-slate-400 text-sm mt-1">Deep analysis for ultra high-yield (0.3% - 0.8% daily) elite pools</p>
                        </div>

                        <div className="flex gap-4">
                            <button
                                onClick={runHighYieldDetection}
                                disabled={isDetectingHighYield}
                                className={`flex items-center gap-3 px-8 py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-2xl text-sm font-black transition-all shadow-xl shadow-amber-600/20 ${isDetectingHighYield ? 'animate-pulse cursor-not-allowed' : 'active:scale-95'}`}
                            >
                                <Zap className={`w-4 h-4 ${isDetectingHighYield ? 'animate-spin' : ''}`} />
                                {isDetectingHighYield ? 'Detecting Alpha...' : 'Scan for Alpha Opportunities'}
                            </button>

                            <button
                                onClick={runAlphaSniperScan}
                                disabled={isSniping}
                                className={`flex items-center gap-3 px-8 py-3 bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-2xl text-sm font-black transition-all shadow-xl shadow-red-600/20 ${isSniping ? 'animate-bounce cursor-not-allowed' : 'active:scale-95'} border border-red-500/30`}
                            >
                                <Zap className={`w-4 h-4 ${isSniping ? 'animate-pulse' : ''}`} />
                                {isSniping ? 'Sniping...' : 'Alpha Sniper'}
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-900/50 text-slate-400 text-[10px] uppercase font-bold tracking-widest border-b border-slate-800">
                                <tr>
                                    <th className="px-6 py-4">Alpha Pool</th>
                                    <th className="px-6 py-4">Yield Tier</th>
                                    <th className="px-6 py-4">Chain</th>
                                    <th className="px-6 py-4">TVL</th>
                                    <th className="px-6 py-4 text-center">Vol/TVL</th>
                                    <th className="px-6 py-4 text-right">Expected Yield</th>
                                    <th className="px-6 py-4 text-right">Projected APR</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {highYieldPools.length === 0 && !isDetectingHighYield && (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-12 text-center text-slate-500 text-sm italic">
                                            No alpha opportunities detected yet. Start a deep scan to find 0.3%+ daily yield pools.
                                        </td>
                                    </tr>
                                )}
                                {isDetectingHighYield && (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-12 text-center">
                                            <div className="flex flex-col items-center gap-3">
                                                <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
                                                <p className="text-amber-500 font-bold animate-pulse text-xs">Analyzing volatility and range efficiency across multiple chains...</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                {highYieldPools.map((pool, idx) => (
                                    <tr
                                        key={`${pool.poolAddress}-${idx}`}
                                        onClick={() => handleSignalClick({
                                            asset_pair: pool.symbol,
                                            data: { chainId: pool.chainId, poolAddress: pool.poolAddress }
                                        })}
                                        className="hover:bg-amber-500/5 transition-all cursor-pointer group border-l-2 border-transparent hover:border-amber-500"
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-white group-hover:text-amber-400">{pool.symbol}</span>
                                                <span className="text-[10px] text-slate-500 font-mono">{(pool.feeTier / 10000).toFixed(2)}% Tier</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-tighter border ${pool.yieldTier?.includes('Extreme') ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                                                pool.yieldTier?.includes('Very High') ? 'bg-orange-500/10 text-orange-500 border-orange-500/30' :
                                                    'bg-amber-500/10 text-amber-500 border-amber-500/30'
                                                }`}>
                                                {pool.yieldTier || 'N/A'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-0.5 bg-slate-800 rounded text-[9px] font-bold text-slate-300 uppercase">
                                                {pool.chainId === 1 ? 'Ethereum' : pool.chainId === 137 ? 'Polygon' : pool.chainId === 10 ? 'Optimism' : pool.chainId === 42161 ? 'Arbitrum' : pool.chainId === 8453 ? 'Base' : `Chain ${pool.chainId}`}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-xs font-medium text-slate-300">${(pool.tvl / 1000000).toFixed(1)}M</span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="text-xs font-bold text-blue-400">{pool.volumeRatio.toFixed(2)}x</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex flex-col items-end">
                                                <span className="text-sm font-black text-white">{(pool.expectedDailyYield * 100).toFixed(3)}%</span>
                                                <span className="text-[9px] text-slate-500 uppercase">Daily</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="inline-flex flex-col items-end px-3 py-1 bg-amber-500/10 rounded-lg border border-amber-500/20">
                                                <span className="text-sm font-black text-amber-500">{pool.expectedAPR.toFixed(1)}%</span>
                                                <span className="text-[8px] font-bold text-amber-600/70 uppercase">Total APR</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Alpha Sniper Section */}
                {(alphaSniperResults.length > 0 || hasRunSniper || isSniping) && (
                    <div className="mt-8 bg-slate-900/40 border border-red-500/20 rounded-[2.5rem] p-8 backdrop-blur-3xl shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-red-500/5 blur-[100px]" />
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-4">
                                <div className="p-4 bg-red-500/20 rounded-3xl border border-red-500/30">
                                    <Zap className="w-6 h-6 text-red-500" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-black text-white tracking-tight">Alpha Sniper Results</h2>
                                    <p className="text-slate-400 text-sm">Ultra High Yield Signals (0.3% - 1.0% Daily)</p>
                                </div>
                            </div>
                            <div className="px-5 py-2 bg-red-500/10 border border-red-500/30 rounded-2xl">
                                <span className="text-red-500 font-black text-xs uppercase tracking-tighter">Live Alpha Detected</span>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-red-950/20 text-red-400/70 text-[10px] uppercase font-black tracking-widest border-b border-red-900/30">
                                    <tr>
                                        <th className="px-6 py-5 text-left">Target Pool</th>
                                        <th className="px-6 py-5 text-left">Chain</th>
                                        <th className="px-6 py-5 text-center">Fee Tier</th>
                                        <th className="px-6 py-5 text-right">Volume Efficiency</th>
                                        <th className="px-6 py-5 text-right">Density (±0.5%)</th>
                                        <th className="px-6 py-5 text-right">Expected Yield</th>
                                        <th className="px-6 py-5 text-right">Diagnostics</th>
                                        <th className="px-6 py-5 text-right">Alpha Score</th>
                                        <th className="px-6 py-5 text-center">Strategy</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-red-900/10">
                                    {isSniping && alphaSniperResults.length === 0 && (
                                        <tr>
                                            <td colSpan={9} className="px-6 py-20 text-center">
                                                <div className="flex flex-col items-center">
                                                    <RefreshCw className="w-12 h-12 text-red-500 mb-4 animate-spin opacity-50" />
                                                    <p className="text-red-400 font-bold animate-pulse">Scanning Ethereum, Base, Arbitrum, Optimism & Polygon...</p>
                                                    <p className="text-slate-500 text-[10px] mt-2 italic">Filtering for TVL &gt; 5M, Vol &gt; 1M, VolEfficiency &gt; 0.1</p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {alphaSniperResults.length === 0 && !isSniping && hasRunSniper && (
                                        <tr>
                                            <td colSpan={9} className="px-6 py-20 text-center">
                                                <div className="flex flex-col items-center">
                                                    <Zap className="w-12 h-12 text-slate-800 mb-4 opacity-20" />
                                                    <p className="text-slate-500 font-medium">No high-quality Alpha Sniper opportunities found matching your filters.</p>
                                                    <p className="text-slate-600 text-xs mt-2 italic">Scanning Polygon, Arbitrum, Base, Optimism, and Ethereum...</p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {alphaSniperResults.map((res, i) => (
                                        <tr key={i} className="group hover:bg-red-500/[0.03] transition-colors cursor-pointer" onClick={() => {
                                            setSelectedPoolAddress(res.poolAddress);
                                            setSelectedChainId(res.chainId);
                                            triggerAnalysis({ pair: res.pool, chainId: res.chainId, poolAddress: res.poolAddress }, false);
                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                        }}>
                                            <td className="px-6 py-6">
                                                <div className="flex flex-col">
                                                    <span className="font-extrabold text-white group-hover:text-red-400 transition-colors uppercase">{res.pool}</span>
                                                    <span className="text-[10px] text-slate-500 font-mono tracking-tighter">{(res.feeTier / 10000).toFixed(2)}% Fee Tier</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-6">
                                                <span className="px-3 py-1 bg-slate-800/80 rounded-xl text-[10px] font-black text-slate-300 uppercase letter-spacing-1">
                                                    {res.chainId === 1 ? 'Ethereum' : res.chainId === 137 ? 'Polygon' : res.chainId === 10 ? 'Optimism' : res.chainId === 42161 ? 'Arbitrum' : res.chainId === 8453 ? 'Base' : res.chainId === 56 ? 'BNB' : `Chain ${res.chainId}`}
                                                </span>
                                            </td>
                                            <td className="px-6 py-6 text-center">
                                                <span className="px-2 py-1 bg-slate-800/50 border border-slate-700/50 rounded-lg text-[10px] font-mono font-bold text-slate-400">
                                                    {(res.feeTier / 10000).toFixed(2)}%
                                                </span>
                                            </td>
                                            <td className="px-6 py-6 text-right">
                                                <div className="flex flex-col items-end">
                                                    <span className="text-sm font-bold text-white">{res.volumeEfficiency.toFixed(2)}x</span>
                                                    <span className="text-[9px] text-slate-500 uppercase">Vol/TVL</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-6 text-right">
                                                <span className="text-xs font-bold text-blue-400">{(res.liquidityDensity * 100).toFixed(1)}%</span>
                                            </td>
                                            <td className="px-6 py-6 text-right">
                                                <div className="flex flex-col items-end">
                                                    <span className="text-lg font-black text-red-400">{(res.expectedDailyYield * 100).toFixed(3)}%</span>
                                                    <span className="text-[9px] text-red-600/50 font-black uppercase">Daily LP Yield</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-6 text-right">
                                                <div className="flex flex-col items-end gap-0.5">
                                                    <span className="text-[10px] text-slate-300 font-mono">ATR: {res.diagnostics?.atrPct?.toFixed(2) || '-'}%</span>
                                                    <span className="text-[10px] text-slate-300 font-mono">ADX: {res.diagnostics?.lastADX?.toFixed(1) || '-'}</span>
                                                    <span className="text-[10px] text-slate-300 font-mono">VolSpike: {res.diagnostics?.volumeSpike?.toFixed(1) || '-'}x</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-6 text-right">
                                                <div className="flex flex-col items-end">
                                                    <div className="inline-flex px-3 py-1 bg-red-500/20 rounded-lg border border-red-500/40 mb-1">
                                                        <span className="text-sm font-black text-red-500">{res.alphaScore?.toFixed(1) || '0.0'}</span>
                                                    </div>
                                                    <span className={`text-[9px] font-black uppercase ${res.recommendation === 'STRONG OPPORTUNITY' ? 'text-emerald-400' : 'text-amber-400'}`}>{res.recommendation || '---'}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-6">
                                                <div className="flex flex-wrap gap-1 justify-center">
                                                    {res.strategyType.map((s: string, idx: number) => (
                                                        <span key={idx} className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tight text-center ${s === 'Fee Spike' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                                                            s === 'Liquidity Gap' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
                                                            s.includes('EXTREME') || s.includes('HIGH RISK') ? 'bg-red-500/80 text-white font-black animate-pulse' :
                                                                'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                                            }`}>
                                                            {s}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Positions Table */}
                <div className="glass-card overflow-hidden mt-8">
                    <div className="p-6 border-b border-slate-800">
                        <h2 className="text-xl font-semibold">Active LP Positions</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-900/50 text-slate-400 text-xs uppercase font-medium">
                                <tr>
                                    <th className="px-6 py-4">Position Pair</th>
                                    <th className="px-6 py-4">Price Range</th>
                                    <th className="px-6 py-4">Estimated APR</th>
                                    <th className="px-6 py-4">Net Profit (IL + Fees)</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {positions.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-8 text-center text-slate-500 text-sm">
                                            No active positions found for your wallets.
                                        </td>
                                    </tr>
                                )}
                                {positions.map(pos => (
                                    <tr key={pos.id} className="hover:bg-slate-800/20 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-semibold text-white">{pos.pair}</div>
                                            <div className="text-[10px] text-slate-500 uppercase tracking-tighter">{pos.chainName}</div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-300 font-mono text-sm">{pos.range}</td>
                                        <td className="px-6 py-4 text-emerald-400 font-bold">{pos.apr}</td>
                                        <td className="px-6 py-4">
                                            <div className={`font-bold ${pos.netProfitUSD >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                ${pos.netProfitUSD.toFixed(2)}
                                            </div>
                                            <div className="text-[10px] text-slate-500">
                                                IL: ${pos.ilUSD.toFixed(2)} | Fees: ${pos.feesUSD.toFixed(2)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${pos.status === 'In Range' ? 'bg-emerald-500/10 text-emerald-400' :
                                                    pos.status === 'Rebalance Soon' ? 'bg-amber-500/10 text-amber-400' :
                                                        'bg-rose-500/10 text-rose-400'
                                                    }`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${pos.status === 'In Range' ? 'bg-emerald-500 animate-pulse' :
                                                        pos.status === 'Rebalance Soon' ? 'bg-amber-500' :
                                                            'bg-rose-500'
                                                        }`}></span>
                                                    {pos.status}
                                                </span>
                                                {pos.marketAlert && (
                                                    <span className="text-[9px] text-amber-500 font-bold animate-pulse leading-none">
                                                        ⚠ {pos.marketAlert.replace(/_/g, ' ')}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => triggerAnalysis(pos)}
                                                className="text-blue-400 text-xs font-bold hover:underline py-1 px-2 border border-blue-400/20 rounded"
                                            >
                                                Optimize
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div >
    );
}
