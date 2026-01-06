'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAllPools, getQuote, formatDenom, formatAmount, calculatePrice } from '@/lib/gno'

interface Pool {
  id: number
  denomA: string
  denomB: string
  reserveA: bigint
  reserveB: bigint
  totalLP: bigint
  feeBPS: bigint
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'swap' | 'pool'>('swap')
  const [pools, setPools] = useState<Pool[]>([])
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null)
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [tokenIn, setTokenIn] = useState<'A' | 'B'>('B') // B = GNOT by default (sorted second)
  const [loading, setLoading] = useState(true)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [connected, setConnected] = useState(false)

  // Fetch pools on load
  useEffect(() => {
    const fetchPools = async () => {
      try {
        const poolData = await getAllPools()
        setPools(poolData)
        if (poolData.length > 0) {
          setSelectedPool(poolData[0])
        }
      } catch (error) {
        console.error('Failed to fetch pools:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchPools()
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchPools, 10000)
    return () => clearInterval(interval)
  }, [])

  // Get quote when amount changes
  const updateQuote = useCallback(async () => {
    if (!selectedPool || !fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount('')
      return
    }

    setQuoteLoading(true)
    try {
      // Convert to micro units (6 decimals)
      const amountIn = BigInt(Math.floor(parseFloat(fromAmount) * 1_000_000))
      const quote = await getQuote(selectedPool.id, tokenIn, amountIn)
      setToAmount(formatAmount(quote, 6))
    } catch (error) {
      console.error('Quote error:', error)
      setToAmount('')
    } finally {
      setQuoteLoading(false)
    }
  }, [selectedPool, fromAmount, tokenIn])

  useEffect(() => {
    const debounce = setTimeout(updateQuote, 300)
    return () => clearTimeout(debounce)
  }, [updateQuote])

  const handleSwapDirection = () => {
    setTokenIn(tokenIn === 'A' ? 'B' : 'A')
    setFromAmount(toAmount)
    setToAmount(fromAmount)
  }

  const fromToken = selectedPool ? (tokenIn === 'A' ? selectedPool.denomA : selectedPool.denomB) : ''
  const toToken = selectedPool ? (tokenIn === 'A' ? selectedPool.denomB : selectedPool.denomA) : ''

  // Calculate TVL
  const totalTVL = pools.reduce((acc, pool) => {
    // Simplified: just add reserves (in real app, multiply by price)
    return acc + Number(pool.reserveA) + Number(pool.reserveB)
  }, 0)

  return (
    <div className="min-h-screen bg-[#0d1117]">
      {/* Header */}
      <header className="border-b border-[#30363d] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-2xl font-bold text-white">
              <span className="text-[#238636]">Gnomo</span> DEX
            </h1>
            <nav className="hidden md:flex gap-6">
              <button 
                onClick={() => setActiveTab('swap')}
                className={`${activeTab === 'swap' ? 'text-white' : 'text-[#8b949e]'} hover:text-white transition`}
              >
                Swap
              </button>
              <button 
                onClick={() => setActiveTab('pool')}
                className={`${activeTab === 'pool' ? 'text-white' : 'text-[#8b949e]'} hover:text-white transition`}
              >
                Pool
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {/* Connection Status */}
            <div className={`flex items-center gap-2 text-sm ${pools.length > 0 ? 'text-[#238636]' : 'text-[#f85149]'}`}>
              <div className={`w-2 h-2 rounded-full ${pools.length > 0 ? 'bg-[#238636]' : 'bg-[#f85149]'}`} />
              {pools.length > 0 ? 'Connected' : 'Disconnected'}
            </div>
            <button 
              onClick={() => setConnected(!connected)}
              className="bg-[#238636] hover:bg-[#2ea043] text-white px-4 py-2 rounded-lg font-medium transition"
            >
              {connected ? 'Disconnect' : 'Connect Wallet'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-lg mx-auto mt-12 px-4">
        {loading ? (
          <div className="bg-[#161b22] rounded-2xl p-8 border border-[#30363d] text-center">
            <div className="animate-spin w-8 h-8 border-2 border-[#238636] border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-[#8b949e]">Loading pools...</p>
          </div>
        ) : activeTab === 'swap' ? (
          <div className="bg-[#161b22] rounded-2xl p-4 border border-[#30363d]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Swap</h2>
              {selectedPool && (
                <div className="text-xs text-[#8b949e]">
                  Pool: {formatDenom(selectedPool.denomA)}/{formatDenom(selectedPool.denomB)}
                </div>
              )}
            </div>

            {pools.length === 0 ? (
              <div className="text-center py-8 text-[#8b949e]">
                <p>No pools available</p>
                <p className="text-sm mt-2">Start gnodev and create a pool first</p>
              </div>
            ) : (
              <>
                {/* From Token */}
                <div className="bg-[#0d1117] rounded-xl p-4 mb-2">
                  <div className="flex justify-between text-sm text-[#8b949e] mb-2">
                    <span>From</span>
                    <span>Balance: --</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={fromAmount}
                      onChange={(e) => setFromAmount(e.target.value)}
                      className="bg-transparent text-2xl font-medium w-full outline-none text-white placeholder-[#8b949e]"
                    />
                    <div className="flex items-center gap-2 bg-[#161b22] px-3 py-2 rounded-xl border border-[#30363d]">
                      <TokenIcon token={formatDenom(fromToken)} />
                      <span className="font-medium">{formatDenom(fromToken)}</span>
                    </div>
                  </div>
                </div>

                {/* Swap Direction Button */}
                <div className="flex justify-center -my-2 relative z-10">
                  <button
                    onClick={handleSwapDirection}
                    className="bg-[#161b22] border border-[#30363d] rounded-xl p-2 hover:bg-[#1c2128] transition"
                  >
                    <SwapIcon />
                  </button>
                </div>

                {/* To Token */}
                <div className="bg-[#0d1117] rounded-xl p-4 mt-2">
                  <div className="flex justify-between text-sm text-[#8b949e] mb-2">
                    <span>To</span>
                    <span>Balance: --</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={quoteLoading ? '...' : toAmount}
                      readOnly
                      className="bg-transparent text-2xl font-medium w-full outline-none text-white placeholder-[#8b949e]"
                    />
                    <div className="flex items-center gap-2 bg-[#161b22] px-3 py-2 rounded-xl border border-[#30363d]">
                      <TokenIcon token={formatDenom(toToken)} />
                      <span className="font-medium">{formatDenom(toToken)}</span>
                    </div>
                  </div>
                </div>

                {/* Price Info */}
                {selectedPool && selectedPool.reserveA > 0 && (
                  <div className="mt-4 p-3 bg-[#0d1117] rounded-xl text-sm">
                    <div className="flex justify-between text-[#8b949e]">
                      <span>Price</span>
                      <span>
                        1 {formatDenom(selectedPool.denomA)} ={" "}
                        {calculatePrice(
                          selectedPool.reserveA,
                          selectedPool.reserveB,
                          selectedPool.denomA,
                          selectedPool.denomB
                        ).toFixed(6)}{" "}
                        {formatDenom(selectedPool.denomB)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[#8b949e] mt-1">
                      <span>Fee</span>
                      <span>{Number(selectedPool.feeBPS) / 100}%</span>
                    </div>
                    <div className="flex justify-between text-[#8b949e] mt-1">
                      <span>Liquidity</span>
                      <span>{formatAmount(selectedPool.reserveA, 6)} / {formatAmount(selectedPool.reserveB, 6)}</span>
                    </div>
                  </div>
                )}

                {/* Swap Button */}
                <button 
                  disabled={!connected || !fromAmount || !toAmount}
                  className={`w-full mt-4 py-4 rounded-xl font-semibold text-lg transition ${
                    connected && fromAmount && toAmount
                      ? 'bg-[#238636] hover:bg-[#2ea043] text-white'
                      : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'
                  }`}
                >
                  {!connected ? 'Connect Wallet to Swap' : !fromAmount ? 'Enter Amount' : 'Swap'}
                </button>
              </>
            )}
          </div>
        ) : (
          <PoolCard pools={pools} />
        )}
      </main>

      {/* Stats Section */}
      <section className="max-w-4xl mx-auto mt-16 px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard title="Total Value Locked" value={`${formatAmount(BigInt(Math.floor(totalTVL)), 6)}`} />
          <StatCard title="24h Volume" value="--" />
          <StatCard title="Total Pools" value={pools.length.toString()} />
        </div>
      </section>
    </div>
  )
}

function PoolCard({ pools }: { pools: Pool[] }) {
  return (
    <div className="bg-[#161b22] rounded-2xl p-4 border border-[#30363d]">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Pools</h2>
      </div>

      {pools.length === 0 ? (
        <div className="text-center py-12 text-[#8b949e]">
          <p className="mb-2">No pools found</p>
          <p className="text-sm">Create a pool using gnokey</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pools.map((pool) => (
            <div key={pool.id} className="bg-[#0d1117] rounded-xl p-4 border border-[#30363d]">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <TokenIcon token={formatDenom(pool.denomA)} />
                  <TokenIcon token={formatDenom(pool.denomB)} className="-ml-3" />
                  <span className="font-medium ml-1">
                    {formatDenom(pool.denomA)}/{formatDenom(pool.denomB)}
                  </span>
                </div>
                <span className="text-xs bg-[#161b22] px-2 py-1 rounded text-[#8b949e]">
                  {Number(pool.feeBPS) / 100}% fee
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm text-[#8b949e] mt-3">
                <div>
                  <p className="text-xs">Reserve {formatDenom(pool.denomA)}</p>
                  <p className="text-white">{formatAmount(pool.reserveA, 6)}</p>
                </div>
                <div>
                  <p className="text-xs">Reserve {formatDenom(pool.denomB)}</p>
                  <p className="text-white">{formatAmount(pool.reserveB, 6)}</p>
                </div>
                <div>
                  <p className="text-xs">Total LP Tokens</p>
                  <p className="text-white">{formatAmount(pool.totalLP, 6)}</p>
                </div>
                <div>
                  <p className="text-xs">Price</p>
                  <p className="text-white">
                    1:
                    {calculatePrice(
                      pool.reserveA,
                      pool.reserveB,
                      pool.denomA,
                      pool.denomB
                    ).toFixed(4)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CLMM Preview */}
      <div className="mt-4 p-4 bg-[#0d1117] rounded-xl border border-dashed border-[#30363d]">
        <p className="text-[#8b949e] text-sm text-center">
          🚧 CLMM concentrated liquidity positions coming soon
        </p>
      </div>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-[#161b22] rounded-xl p-4 border border-[#30363d]">
      <p className="text-[#8b949e] text-sm">{title}</p>
      <p className="text-xl font-semibold mt-1">{value}</p>
    </div>
  )
}

function TokenIcon({ token, className = '' }: { token: string; className?: string }) {
  const colors: Record<string, string> = {
    GNOT: '#238636',
    USDC: '#2775ca',
    GNS: '#ff6b6b',
    ATOM: '#6f7390',
  }
  return (
    <div
      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 border-[#0d1117] ${className}`}
      style={{ backgroundColor: colors[token] || '#8b949e' }}
    >
      {token[0]}
    </div>
  )
}

function SwapIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" />
    </svg>
  )
}
