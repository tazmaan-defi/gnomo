'use client'

import { useState } from 'react'

export default function Home() {
  const [activeTab, setActiveTab] = useState<'swap' | 'pool'>('swap')
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [fromToken, setFromToken] = useState('GNOT')
  const [toToken, setToToken] = useState('USDC')

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
          <button className="bg-[#238636] hover:bg-[#2ea043] text-white px-4 py-2 rounded-lg font-medium transition">
            Connect Wallet
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-lg mx-auto mt-12 px-4">
        {activeTab === 'swap' ? (
          <SwapCard
            fromAmount={fromAmount}
            setFromAmount={setFromAmount}
            toAmount={toAmount}
            setToAmount={setToAmount}
            fromToken={fromToken}
            setFromToken={setFromToken}
            toToken={toToken}
            setToToken={setToToken}
          />
        ) : (
          <PoolCard />
        )}
      </main>

      {/* Stats Section */}
      <section className="max-w-4xl mx-auto mt-16 px-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard title="Total Value Locked" value="$0.00" />
          <StatCard title="24h Volume" value="$0.00" />
          <StatCard title="Total Pools" value="0" />
        </div>
      </section>
    </div>
  )
}

function SwapCard({
  fromAmount,
  setFromAmount,
  toAmount,
  setToAmount,
  fromToken,
  setFromToken,
  toToken,
  setToToken,
}: {
  fromAmount: string
  setFromAmount: (v: string) => void
  toAmount: string
  setToAmount: (v: string) => void
  fromToken: string
  setFromToken: (v: string) => void
  toToken: string
  setToToken: (v: string) => void
}) {
  const handleSwapTokens = () => {
    const tempToken = fromToken
    setFromToken(toToken)
    setToToken(tempToken)
    const tempAmount = fromAmount
    setFromAmount(toAmount)
    setToAmount(tempAmount)
  }

  return (
    <div className="bg-[#161b22] rounded-2xl p-4 border border-[#30363d]">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Swap</h2>
        <button className="text-[#8b949e] hover:text-white transition">
          <SettingsIcon />
        </button>
      </div>

      {/* From Token */}
      <div className="bg-[#0d1117] rounded-xl p-4 mb-2">
        <div className="flex justify-between text-sm text-[#8b949e] mb-2">
          <span>From</span>
          <span>Balance: 0.00</span>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="0.00"
            value={fromAmount}
            onChange={(e) => setFromAmount(e.target.value)}
            className="bg-transparent text-2xl font-medium w-full outline-none text-white placeholder-[#8b949e]"
          />
          <TokenSelector token={fromToken} setToken={setFromToken} />
        </div>
      </div>

      {/* Swap Direction Button */}
      <div className="flex justify-center -my-2 relative z-10">
        <button
          onClick={handleSwapTokens}
          className="bg-[#161b22] border border-[#30363d] rounded-xl p-2 hover:bg-[#1c2128] transition"
        >
          <SwapIcon />
        </button>
      </div>

      {/* To Token */}
      <div className="bg-[#0d1117] rounded-xl p-4 mt-2">
        <div className="flex justify-between text-sm text-[#8b949e] mb-2">
          <span>To</span>
          <span>Balance: 0.00</span>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="0.00"
            value={toAmount}
            onChange={(e) => setToAmount(e.target.value)}
            className="bg-transparent text-2xl font-medium w-full outline-none text-white placeholder-[#8b949e]"
          />
          <TokenSelector token={toToken} setToken={setToToken} />
        </div>
      </div>

      {/* Price Info */}
      {fromAmount && toAmount && (
        <div className="mt-4 p-3 bg-[#0d1117] rounded-xl text-sm">
          <div className="flex justify-between text-[#8b949e]">
            <span>Price</span>
            <span>1 {fromToken} = 2.00 {toToken}</span>
          </div>
          <div className="flex justify-between text-[#8b949e] mt-1">
            <span>Price Impact</span>
            <span className="text-[#238636]">&lt;0.01%</span>
          </div>
          <div className="flex justify-between text-[#8b949e] mt-1">
            <span>Fee (0.3%)</span>
            <span>0.003 {fromToken}</span>
          </div>
        </div>
      )}

      {/* Swap Button */}
      <button className="w-full mt-4 bg-[#238636] hover:bg-[#2ea043] text-white py-4 rounded-xl font-semibold text-lg transition">
        Connect Wallet to Swap
      </button>
    </div>
  )
}

function PoolCard() {
  return (
    <div className="bg-[#161b22] rounded-2xl p-4 border border-[#30363d]">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Your Positions</h2>
        <button className="bg-[#238636] hover:bg-[#2ea043] text-white px-4 py-2 rounded-lg font-medium text-sm transition">
          + New Position
        </button>
      </div>

      <div className="text-center py-12 text-[#8b949e]">
        <p className="mb-2">No liquidity positions found</p>
        <p className="text-sm">Add liquidity to earn fees</p>
      </div>

      {/* Future: CLMM Position Visualization */}
      <div className="mt-4 p-4 bg-[#0d1117] rounded-xl border border-dashed border-[#30363d]">
        <p className="text-[#8b949e] text-sm text-center">
          CLMM positions with price range visualization coming soon
        </p>
      </div>
    </div>
  )
}

function TokenSelector({ token, setToken }: { token: string; setToken: (v: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const tokens = ['GNOT', 'USDC', 'GNS', 'ATOM']

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-[#161b22] hover:bg-[#1c2128] px-3 py-2 rounded-xl border border-[#30363d] transition"
      >
        <TokenIcon token={token} />
        <span className="font-medium">{token}</span>
        <ChevronIcon />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 bg-[#161b22] border border-[#30363d] rounded-xl shadow-xl z-20 min-w-[150px]">
          {tokens.map((t) => (
            <button
              key={t}
              onClick={() => {
                setToken(t)
                setIsOpen(false)
              }}
              className="flex items-center gap-2 w-full px-4 py-3 hover:bg-[#1c2128] transition first:rounded-t-xl last:rounded-b-xl"
            >
              <TokenIcon token={t} />
              <span>{t}</span>
            </button>
          ))}
        </div>
      )}
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

function TokenIcon({ token }: { token: string }) {
  const colors: Record<string, string> = {
    GNOT: '#238636',
    USDC: '#2775ca',
    GNS: '#ff6b6b',
    ATOM: '#6f7390',
  }
  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
      style={{ backgroundColor: colors[token] || '#8b949e' }}
    >
      {token[0]}
    </div>
  )
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9L12 15L18 9" />
    </svg>
  )
}
