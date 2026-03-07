"use client"

import React, { useState, useEffect } from 'react';
import { TrendingUp, Activity, Bell, Settings, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell
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
}

export default function Dashboard() {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [signals, setSignals] = useState<any[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);
    const [balances, setBalances] = useState<any[]>([]);
    const [selectedPair, setSelectedPair] = useState('ZEC/USDT');
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
    }, []);

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
        const res = await fetch('/api/balances');
        const data = await res.json();
        if (!data.error) setBalances(data);
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

    const triggerAnalysis = async (posOverride?: Position) => {
        setIsRefreshing(true);
        const pair = posOverride ? posOverride.pair : selectedPair;
        const chainId = posOverride ? posOverride.chainId : 1;
        const poolAddress = posOverride ? posOverride.poolAddress : '0x...';

        if (posOverride) setSelectedPair(posOverride.pair);

        try {
            const res = await fetch('/api/analyze', {
                method: 'POST',
                body: JSON.stringify({
                    pool: { symbol: pair, chainId, poolAddress },
                    riskProfile: settings.risk_profile
                })
            });
            const data = await res.json();
            if (data.result) {
                setLastAnalysis(data.result);
                fetchSignals();
                fetchPositions();
                fetchBalances();
            }
        } catch (e) {
            console.error(e);
        }
        setIsRefreshing(false);
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
                <div className="glass-card p-6 border-l-4 border-emerald-500">
                    <div className="flex justify-between items-start">
                        <p className="text-slate-400 text-sm font-medium">Wallet Assets (All Chains)</p>
                        <ArrowUpRight className="text-emerald-500 w-5 h-5" />
                    </div>
                    <div className="mt-2 text-sm max-h-[100px] overflow-y-auto custom-scrollbar">
                        {balances.filter(b => parseFloat(b.balance) > 0).map((b, idx) => (
                            <div key={`${b.symbol}-${idx}`} className="flex justify-between items-center text-sm">
                                <span className="text-slate-400">{b.symbol}</span>
                                <span className="font-bold text-white">{parseFloat(b.balance).toFixed(4)}</span>
                            </div>
                        ))}
                        {balances.filter(b => parseFloat(b.balance) > 0).length === 0 && <span className="text-slate-500 italic text-xs">No assets found</span>}
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Chart Section */}
                <div className="lg:col-span-2 glass-card p-6 space-y-6">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <h2 className="text-xl font-semibold whitespace-nowrap">Market Analysis</h2>
                            <select
                                value={selectedPair}
                                onChange={(e) => setSelectedPair(e.target.value)}
                                className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs outline-none"
                            >
                                {settings.watched_pairs.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <span className="px-3 py-1 bg-blue-500/10 text-blue-400 rounded-full text-xs font-semibold">
                                {lastAnalysis ? `$${lastAnalysis.currentPrice.toFixed(4)}` : 'Live Price'}
                            </span>
                        </div>
                    </div>
                    <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={mockData}>
                                <defs>
                                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#26262a" vertical={false} />
                                <XAxis dataKey="time" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis hide />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#161618', borderColor: '#26262a', color: '#fff' }}
                                    itemStyle={{ color: '#3b82f6' }}
                                />
                                <Area type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorPrice)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Signals Sidebar */}
                <div className="glass-card p-6 space-y-6">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <Bell className="w-5 h-5 text-amber-500" />
                        Recent Signals
                    </h2>
                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {signals.length === 0 && (
                            <p className="text-slate-500 text-sm text-center py-8">No signals yet. Click analyze to generate one.</p>
                        )}
                        {signals.map(signal => (
                            <div key={signal.id} className="p-4 rounded-lg bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer">
                                <div className="flex justify-between items-start mb-2">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${signal.type === 'entry' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                                        }`}>
                                        {signal.type.toUpperCase()}
                                    </span>
                                    <span className="text-slate-500 text-[10px]">
                                        {formatDistanceToNow(new Date(signal.created_at), { addSuffix: true })}
                                    </span>
                                </div>
                                <h4 className="font-semibold text-sm text-white">{signal.asset_pair}</h4>
                                <div className="text-xs text-slate-400 mt-1 whitespace-pre-line line-clamp-3">
                                    {signal.message.replace(/\*/g, '').replace(/`/g, '').split('\n').filter(Boolean)[0]}...
                                </div>
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={() => triggerAnalysis()}
                        disabled={isRefreshing}
                        className="w-full py-3 premium-gradient rounded-xl font-bold text-sm shadow-lg hover:opacity-90 transition-opacity uppercase tracking-wider disabled:opacity-50"
                    >
                        {isRefreshing ? 'Thinking...' : 'Analyze Market Now'}
                    </button>
                </div>
            </div>

            {/* Positions Table */}
            <div className="glass-card overflow-hidden">
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
                                    <td colSpan={5} className="px-6 py-8 text-center text-slate-500 text-sm">
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
    );
}
