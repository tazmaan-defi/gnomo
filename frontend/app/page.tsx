'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAllPools, getQuote, formatDenom, formatAmount, calculatePrice, PoolInfo, getLPBalance } from '@/lib/gno'
import { 
  isAdenaInstalled, 
  connectAdena, 
  getAdenaAccount, 
  switchToDevNetwork,
  swap as adenaSwap,
  addLiquidity as adenaAddLiquidity,
  removeLiquidity as adenaRemoveLiquidity,
  createPool as adenaCreatePool,
  mintTestTokens as adenaMintTokens,
  getBalances
} from '@/lib/adena'

export default function Home() {
  const [activeTab, setActiveTab] = useState<'swap' | 'pool'>('swap')
  const [pools, setPools] = useState<PoolInfo[]>([])
  const [selectedPool, setSelectedPool] = useState<PoolInfo | null>(null)
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [tokenIn, setTokenIn] = useState<'A' | 'B'>('B')
  const [loading, setLoading] = useState(true)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [swapLoading, setSwapLoading] = useState(false)
  
  // Wallet state
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletConnecting, setWalletConnecting] = useState(false)
  const [adenaAvailable, setAdenaAvailable] = useState(false)
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map())
  const [lpBalances, setLpBalances] = useState<Map<number, bigint>>(new Map())
  
  // Slippage
  const [slippageBps, setSlippageBps] = useState(50)
  const [showSettings, setShowSettings] = useState(false)

  // Check for Adena on mount
  useEffect(() => {
    const checkAdena = () => {
      setAdenaAvailable(isAdenaInstalled())
    }
    checkAdena()
    const timeout = setTimeout(checkAdena, 1000)
    return () => clearTimeout(timeout)
  }, [])

  // Auto-reconnect on mount only (not periodic)
  useEffect(() => {
    const tryReconnect = async () => {
      if (adenaAvailable && !walletAddress) {
        try {
          const account = await getAdenaAccount()
          if (account?.address) {
            setWalletAddress(account.address)
            // Fetch balances immediately
            const b = await getBalances()
            setBalances(b)
          }
        } catch (e) {
          // Wallet might be locked, that's fine
        }
      }
    }
    tryReconnect()
    // No periodic check - user can click Connect button
  }, [adenaAvailable]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch balances when wallet connects
  useEffect(() => {
    const fetchBalances = async () => {
      if (walletAddress) {
        try {
          // Check if wallet is still accessible
          const account = await getAdenaAccount()
          if (!account?.address) {
            // Wallet locked - disconnect
            setWalletAddress(null)
            setBalances(new Map())
            setLpBalances(new Map())
            return
          }
          const b = await getBalances()
          setBalances(b)
        } catch (e) {
          console.error('Failed to fetch balances:', e)
          // Wallet might be locked
          setWalletAddress(null)
          setBalances(new Map())
          setLpBalances(new Map())
        }
      } else {
        setBalances(new Map())
      }
    }
    fetchBalances()
    const interval = setInterval(fetchBalances, 60000)
    return () => clearInterval(interval)
  }, [walletAddress])

  // Fetch LP balances when wallet connects or pools change
  useEffect(() => {
    const fetchLPBalances = async () => {
      if (walletAddress && pools.length > 0) {
        const newLpBalances = new Map<number, bigint>()
        for (const pool of pools) {
          try {
            const balance = await getLPBalance(pool.id, walletAddress)
            if (balance > 0n) {
              newLpBalances.set(pool.id, balance)
            }
          } catch (e) {
            console.error(`Failed to get LP balance for pool ${pool.id}:`, e)
          }
        }
        setLpBalances(newLpBalances)
      } else {
        setLpBalances(new Map())
      }
    }
    fetchLPBalances()
    const interval = setInterval(fetchLPBalances, 60000)
    return () => clearInterval(interval)
  }, [walletAddress, pools])

  // Fetch pools on load
  useEffect(() => {
    const fetchPools = async () => {
      try {
        const poolData = await getAllPools()
        setPools(poolData)
        if (poolData.length > 0 && !selectedPool) {
          setSelectedPool(poolData[0])
        }
      } catch (error) {
        console.error('Failed to fetch pools:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchPools()
    const interval = setInterval(fetchPools, 60000)
    return () => clearInterval(interval)
  }, [selectedPool])

  // Get quote when amount changes
  const updateQuote = useCallback(async () => {
    if (!selectedPool || !fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount('')
      return
    }

    setQuoteLoading(true)
    try {
      const amountIn = BigInt(Math.floor(parseFloat(fromAmount) * 1_000_000))
      const quote = await getQuote(selectedPool.id, tokenIn, amountIn)
      const denomOut = tokenIn === 'A' ? selectedPool.denomB : selectedPool.denomA
      setToAmount(formatAmount(quote, denomOut))
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

  const handleConnectWallet = async () => {
    if (walletAddress) {
      setWalletAddress(null)
      setBalances(new Map())
      setLpBalances(new Map())
      return
    }

    if (!adenaAvailable) {
      window.open('https://adena.app/', '_blank')
      return
    }

    setWalletConnecting(true)
    try {
      // Connect first (this will prompt for password if locked)
      const address = await connectAdena()
      if (address) {
        setWalletAddress(address)
        // Only switch network after successfully connected
        await switchToDevNetwork()
        // Fetch balances immediately after connect
        const b = await getBalances()
        setBalances(b)
      }
    } catch (error: any) {
      console.error('Wallet connection error:', error)
      const msg = error?.message?.toLowerCase() || ''
      // If already connected, just get the account
      if (msg.includes('already connected')) {
        try {
          const account = await getAdenaAccount()
          if (account?.address) {
            setWalletAddress(account.address)
            const b = await getBalances()
            setBalances(b)
          }
        } catch (e) {
          console.error('Failed to get account after already connected:', e)
        }
      } else if (!msg.includes('rejected')) {
        alert(error instanceof Error ? error.message : 'Failed to connect wallet')
      }
    } finally {
      setWalletConnecting(false)
    }
  }

  const handleSwap = async () => {
    if (!walletAddress || !selectedPool || !fromAmount || !toAmount) return

    setSwapLoading(true)
    try {
      const amountIn = BigInt(Math.floor(parseFloat(fromAmount) * 1_000_000))
      const expectedOut = BigInt(Math.floor(parseFloat(toAmount) * 1_000_000))
      const minAmountOut = expectedOut - (expectedOut * BigInt(slippageBps) / 10000n)
      const denomIn = tokenIn === 'A' ? selectedPool.denomA : selectedPool.denomB

      const result = await adenaSwap({
        caller: walletAddress,
        poolId: selectedPool.id,
        tokenIn,
        amountIn,
        minAmountOut,
        denomIn,
      })

      if (result.code === 0) {
        alert('Swap successful!')
        setFromAmount('')
        setToAmount('')
        await refreshData()
      } else if (result.code === 4001 || result.code === 4000) {
        // Transaction timed out or was cancelled - silent
        console.log('Transaction timed out or cancelled')
      } else {
        alert(`Swap failed: ${result.message || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Swap error:', error)
      const msg = error instanceof Error ? error.message : ''
      if (!msg.includes('rejected') && !msg.includes('timed out')) {
        alert(msg || 'Swap failed')
      }
    } finally {
      setSwapLoading(false)
    }
  }

  const refreshData = async () => {
    const poolData = await getAllPools()
    setPools(poolData)
    if (selectedPool) {
      const updated = poolData.find(p => p.id === selectedPool.id)
      if (updated) setSelectedPool(updated)
    }
    if (walletAddress) {
      const b = await getBalances()
      setBalances(b)
      const newLpBalances = new Map<number, bigint>()
      for (const pool of poolData) {
        try {
          const balance = await getLPBalance(pool.id, walletAddress)
          if (balance > 0n) {
            newLpBalances.set(pool.id, balance)
          }
        } catch (e) {
          console.error(`Failed to get LP balance for pool ${pool.id}:`, e)
        }
      }
      setLpBalances(newLpBalances)
    }
  }

  const fromToken = selectedPool ? (tokenIn === 'A' ? selectedPool.denomA : selectedPool.denomB) : ''
  const toToken = selectedPool ? (tokenIn === 'A' ? selectedPool.denomB : selectedPool.denomA) : ''

  const totalTVL = pools.reduce((acc, pool) => {
    return acc + Number(pool.reserveA) + Number(pool.reserveB)
  }, 0)

  const shortAddress = walletAddress 
    ? `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}`
    : null

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
            <div className={`flex items-center gap-2 text-sm ${pools.length > 0 ? 'text-[#238636]' : 'text-[#f85149]'}`}>
              <div className={`w-2 h-2 rounded-full ${pools.length > 0 ? 'bg-[#238636]' : 'bg-[#f85149]'}`} />
              {pools.length > 0 ? 'RPC Connected' : 'RPC Disconnected'}
            </div>
            <button 
              onClick={handleConnectWallet}
              disabled={walletConnecting}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                walletAddress 
                  ? 'bg-[#21262d] hover:bg-[#30363d] text-white border border-[#30363d]'
                  : 'bg-[#238636] hover:bg-[#2ea043] text-white'
              }`}
            >
              {walletConnecting ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Connecting...
                </span>
              ) : walletAddress ? (
                shortAddress
              ) : adenaAvailable ? (
                'Connect Adena'
              ) : (
                'Install Adena'
              )}
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
              <div className="flex items-center gap-2">
                {selectedPool && (
                  <div className="text-xs text-[#8b949e]">
                    Pool: {formatDenom(selectedPool.denomA)}/{formatDenom(selectedPool.denomB)}
                  </div>
                )}
                <button 
                  onClick={() => setShowSettings(!showSettings)}
                  className="text-[#8b949e] hover:text-white transition p-1"
                >
                  <SettingsIcon />
                </button>
              </div>
            </div>

            {showSettings && (
              <div className="mb-4 p-3 bg-[#0d1117] rounded-xl border border-[#30363d]">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-[#8b949e]">Slippage Tolerance</span>
                  <div className="flex gap-2">
                    {[10, 50, 100].map((bps) => (
                      <button
                        key={bps}
                        onClick={() => setSlippageBps(bps)}
                        className={`px-2 py-1 text-xs rounded ${
                          slippageBps === bps 
                            ? 'bg-[#238636] text-white' 
                            : 'bg-[#21262d] text-[#8b949e] hover:text-white'
                        }`}
                      >
                        {bps / 100}%
                      </button>
                    ))}
                    <input
                      type="number"
                      value={slippageBps / 100}
                      onChange={(e) => setSlippageBps(Math.round(parseFloat(e.target.value || '0') * 100))}
                      className="w-16 px-2 py-1 text-xs bg-[#21262d] rounded border border-[#30363d] text-white"
                      step="0.1"
                      min="0"
                      max="50"
                    />
                  </div>
                </div>
              </div>
            )}

            {pools.length === 0 ? (
              <div className="text-center py-8 text-[#8b949e]">
                <p>No pools available</p>
                <p className="text-sm mt-2">Start gnodev and create a pool first</p>
              </div>
            ) : (
              <>
                {/* Pool Selector */}
                {pools.length > 1 && (
                  <div className="mb-4">
                    <select
                      value={selectedPool?.id ?? 0}
                      onChange={(e) => {
                        const pool = pools.find(p => p.id === parseInt(e.target.value))
                        if (pool) setSelectedPool(pool)
                      }}
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white"
                    >
                      {pools.map((pool) => (
                        <option key={pool.id} value={pool.id}>
                          {formatDenom(pool.denomA)}/{formatDenom(pool.denomB)} - Pool #{pool.id}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* From Token */}
                <div className="bg-[#0d1117] rounded-xl p-4 mb-2">
                  <div className="flex justify-between text-sm text-[#8b949e] mb-2">
                    <span>From</span>
                    <span>Balance: {walletAddress && fromToken ? formatAmount(balances.get(fromToken) || 0n, fromToken) : '--'}</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={fromAmount}
                      onChange={(e) => setFromAmount(e.target.value)}
                      className="bg-transparent text-2xl font-medium w-full outline-none text-white placeholder-[#8b949e] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                    <span>Balance: {walletAddress && toToken ? formatAmount(balances.get(toToken) || 0n, toToken) : '--'}</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="0.00"
                      value={quoteLoading ? '...' : toAmount}
                      readOnly
                      className="bg-transparent text-2xl font-medium w-full outline-none text-white placeholder-[#8b949e] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <div className="flex items-center gap-2 bg-[#161b22] px-3 py-2 rounded-xl border border-[#30363d]">
                      <TokenIcon token={formatDenom(toToken)} />
                      <span className="font-medium">{formatDenom(toToken)}</span>
                    </div>
                  </div>
                </div>

                {/* Price Info */}
                {selectedPool && selectedPool.reserveA > 0n && (
                  <div className="mt-4 p-3 bg-[#0d1117] rounded-xl text-sm">
                    <div className="flex justify-between text-[#8b949e]">
                      <span>Price</span>
                      <span>
                        1 {formatDenom(selectedPool.denomA)} ={' '}
                        {calculatePrice(
                          selectedPool.reserveA,
                          selectedPool.reserveB,
                          selectedPool.denomA,
                          selectedPool.denomB
                        ).toFixed(6)}{' '}
                        {formatDenom(selectedPool.denomB)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[#8b949e] mt-1">
                      <span>Fee</span>
                      <span>{Number(selectedPool.feeBPS) / 100}%</span>
                    </div>
                    <div className="flex justify-between text-[#8b949e] mt-1">
                      <span>Slippage</span>
                      <span>{slippageBps / 100}%</span>
                    </div>
                    {fromAmount && toAmount && (
                      <div className="flex justify-between text-[#8b949e] mt-1">
                        <span>Min. Received</span>
                        <span>
                          {(parseFloat(toAmount) * (1 - slippageBps / 10000)).toFixed(6)} {formatDenom(toToken)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Swap Button */}
                <button 
                  onClick={handleSwap}
                  disabled={!walletAddress || !fromAmount || !toAmount || swapLoading}
                  className={`w-full mt-4 py-4 rounded-xl font-semibold text-lg transition ${
                    walletAddress && fromAmount && toAmount && !swapLoading
                      ? 'bg-[#238636] hover:bg-[#2ea043] text-white'
                      : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'
                  }`}
                >
                  {swapLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                      Swapping...
                    </span>
                  ) : !walletAddress ? (
                    'Connect Wallet to Swap'
                  ) : !fromAmount ? (
                    'Enter Amount'
                  ) : (
                    'Swap'
                  )}
                </button>
              </>
            )}
          </div>
        ) : (
          <PoolTab 
            pools={pools} 
            walletAddress={walletAddress}
            balances={balances}
            lpBalances={lpBalances}
            onRefresh={refreshData}
          />
        )}
      </main>

      {/* Stats Section */}
      <section className="max-w-4xl mx-auto mt-16 px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard title="Total Value Locked" value={formatAmount(BigInt(Math.floor(totalTVL)), 'ugnot')} />
          <StatCard title="24h Volume" value="--" />
          <StatCard title="Total Pools" value={pools.length.toString()} />
        </div>
      </section>
    </div>
  )
}

function PoolTab({ 
  pools, 
  walletAddress, 
  balances,
  lpBalances,
  onRefresh
}: { 
  pools: PoolInfo[]
  walletAddress: string | null
  balances: Map<string, bigint>
  lpBalances: Map<number, bigint>
  onRefresh: () => Promise<void>
}) {
  const [activePoolTab, setActivePoolTab] = useState<'list' | 'add' | 'remove' | 'create'>('list')
  const [selectedPoolId, setSelectedPoolId] = useState<number>(pools[0]?.id ?? 0)
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [lpAmount, setLpAmount] = useState('')
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  
  // Create pool state
  const [newTokenA, setNewTokenA] = useState('ugnot')
  const [newTokenB, setNewTokenB] = useState('')
  const [newFeeBps, setNewFeeBps] = useState(30)
  
  // Mint tokens state (dev only)
  const [mintTokenName, setMintTokenName] = useState('')
  const [mintAmount, setMintAmount] = useState('1000000')

  const selectedPool = pools.find(p => p.id === selectedPoolId) || pools[0]
  const userLpBalance = lpBalances.get(selectedPoolId) || 0n

  // Calculate slider percentage
  const sliderPercent = userLpBalance > 0n && lpAmount 
    ? Math.min(100, Math.round((parseFloat(lpAmount) * 1_000_000 / Number(userLpBalance)) * 100))
    : 0

  // Calculate optimal B amount based on A input
  const calculateOptimalB = (aAmount: string): string => {
    if (!selectedPool || !aAmount || parseFloat(aAmount) <= 0) return ''
    if (selectedPool.reserveA === 0n) return aAmount
    
    const a = parseFloat(aAmount) * 1_000_000
    const optimalB = (a * Number(selectedPool.reserveB)) / Number(selectedPool.reserveA)
    return (optimalB / 1_000_000).toFixed(6)
  }

  const handleAmountAChange = (value: string) => {
    setAmountA(value)
    setAmountB(calculateOptimalB(value))
  }

  const handlePercentage = (percent: number) => {
    if (userLpBalance === 0n) return
    setSelectedPercent(percent)
    const amount = (userLpBalance * BigInt(percent)) / 100n
    setLpAmount(formatAmount(amount, 'lp'))
  }

  const handleSliderChange = (value: number) => {
    if (userLpBalance === 0n) return
    setSelectedPercent(null) // Clear button selection when using slider
    const amount = (userLpBalance * BigInt(value)) / 100n
    setLpAmount(formatAmount(amount, 'lp'))
  }

  const handleLpAmountChange = (value: string) => {
    setSelectedPercent(null) // Clear button selection when typing
    setLpAmount(value)
  }

  const handleAddLiquidity = async () => {
    if (!walletAddress || !selectedPool || !amountA || !amountB) return

    setActionLoading(true)
    try {
      const amtA = BigInt(Math.floor(parseFloat(amountA) * 1_000_000))
      const amtB = BigInt(Math.floor(parseFloat(amountB) * 1_000_000))

      const result = await adenaAddLiquidity({
        caller: walletAddress,
        poolId: selectedPool.id,
        amountA: amtA,
        amountB: amtB,
        denomA: selectedPool.denomA,
        denomB: selectedPool.denomB,
      })

      if (result.code === 0) {
        alert('Liquidity added successfully!')
        setAmountA('')
        setAmountB('')
        await onRefresh()
      } else if (result.code === 4001 || result.code === 4000) {
        // Transaction timed out or was cancelled - silent
        console.log('Transaction timed out or cancelled')
      } else {
        alert(`Failed: ${result.message || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Add liquidity error:', error)
      // Don't show alert for timeout errors
      const msg = error instanceof Error ? error.message : ''
      if (!msg.includes('rejected') && !msg.includes('timed out')) {
        alert(msg || 'Failed to add liquidity')
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleRemoveLiquidity = async () => {
    if (!walletAddress || !selectedPool || !lpAmount) return

    setActionLoading(true)
    try {
      const amount = BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000))

      const result = await adenaRemoveLiquidity({
        caller: walletAddress,
        poolId: selectedPool.id,
        lpAmount: amount,
      })

      if (result.code === 0) {
        alert('Liquidity removed successfully!')
        setLpAmount('')
        setSelectedPercent(null)
        await onRefresh()
      } else if (result.code === 4001 || result.code === 4000) {
        // Transaction timed out or was cancelled - silent
        console.log('Transaction timed out or cancelled')
      } else {
        alert(`Failed: ${result.message || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Remove liquidity error:', error)
      const msg = error instanceof Error ? error.message : ''
      if (!msg.includes('rejected') && !msg.includes('timed out')) {
        alert(msg || 'Failed to remove liquidity')
      }
    } finally {
      setActionLoading(false)
    }
  }

  // Calculate user's share of pool
  const getUserPoolShare = (poolId: number, pool: PoolInfo): number => {
    const lpBalance = lpBalances.get(poolId) || 0n
    if (pool.totalLP === 0n || lpBalance === 0n) return 0
    return (Number(lpBalance) / Number(pool.totalLP)) * 100
  }

  return (
    <div className="bg-[#161b22] rounded-2xl p-4 border border-[#30363d]">
      {/* Tab Selector */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActivePoolTab('list')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            activePoolTab === 'list'
              ? 'bg-[#238636] text-white'
              : 'bg-[#21262d] text-[#8b949e] hover:text-white'
          }`}
        >
          Pools
        </button>
        <button
          onClick={() => setActivePoolTab('add')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            activePoolTab === 'add'
              ? 'bg-[#238636] text-white'
              : 'bg-[#21262d] text-[#8b949e] hover:text-white'
          }`}
        >
          Add Liquidity
        </button>
        <button
          onClick={() => setActivePoolTab('remove')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            activePoolTab === 'remove'
              ? 'bg-[#238636] text-white'
              : 'bg-[#21262d] text-[#8b949e] hover:text-white'
          }`}
        >
          Remove
        </button>
        <button
          onClick={() => setActivePoolTab('create')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            activePoolTab === 'create'
              ? 'bg-[#238636] text-white'
              : 'bg-[#21262d] text-[#8b949e] hover:text-white'
          }`}
        >
          Create
        </button>
      </div>

      {activePoolTab === 'list' && (
        <>
          {pools.length === 0 ? (
            <div className="text-center py-12 text-[#8b949e]">
              <p className="mb-2">No pools found</p>
              <p className="text-sm">Use the Create tab to create a new pool</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pools.map((pool) => {
                const userShare = getUserPoolShare(pool.id, pool)
                const userLp = lpBalances.get(pool.id) || 0n
                return (
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
                        <p className="text-white">{formatAmount(pool.reserveA, pool.denomA)}</p>
                      </div>
                      <div>
                        <p className="text-xs">Reserve {formatDenom(pool.denomB)}</p>
                        <p className="text-white">{formatAmount(pool.reserveB, pool.denomB)}</p>
                      </div>
                      <div>
                        <p className="text-xs">Total LP Tokens</p>
                        <p className="text-white">{formatAmount(pool.totalLP, 'lp')}</p>
                      </div>
                      <div>
                        <p className="text-xs">Price</p>
                        <p className="text-white">
                          1:{calculatePrice(
                            pool.reserveA,
                            pool.reserveB,
                            pool.denomA,
                            pool.denomB
                          ).toFixed(4)}
                        </p>
                      </div>
                    </div>
                    
                    {/* User's Position */}
                    {walletAddress && userLp > 0n && (
                      <div className="mt-3 pt-3 border-t border-[#30363d]">
                        <p className="text-xs text-[#238636] mb-2">Your Position</p>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-xs text-[#8b949e]">Your LP Tokens</p>
                            <p className="text-white">{formatAmount(userLp, 'lp')}</p>
                          </div>
                          <div>
                            <p className="text-xs text-[#8b949e]">Pool Share</p>
                            <p className="text-white">{userShare.toFixed(2)}%</p>
                          </div>
                          <div>
                            <p className="text-xs text-[#8b949e]">Your {formatDenom(pool.denomA)}</p>
                            <p className="text-white">
                              {formatAmount(
                                pool.totalLP > 0n ? (userLp * pool.reserveA / pool.totalLP) : 0n,
                                pool.denomA
                              )}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-[#8b949e]">Your {formatDenom(pool.denomB)}</p>
                            <p className="text-white">
                              {formatAmount(
                                pool.totalLP > 0n ? (userLp * pool.reserveB / pool.totalLP) : 0n,
                                pool.denomB
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* CLMM Preview */}
          <div className="mt-4 p-4 bg-[#0d1117] rounded-xl border border-dashed border-[#30363d]">
            <p className="text-[#8b949e] text-sm text-center">
              🚧 CLMM concentrated liquidity positions coming soon
            </p>
          </div>
        </>
      )}

      {activePoolTab === 'add' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Add Liquidity</h3>
          
          {/* Pool Selector */}
          {pools.length > 0 && (
            <select
              value={selectedPoolId}
              onChange={(e) => setSelectedPoolId(parseInt(e.target.value))}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white"
            >
              {pools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {formatDenom(pool.denomA)}/{formatDenom(pool.denomB)} - Pool #{pool.id}
                </option>
              ))}
            </select>
          )}

          {selectedPool && (
            <>
              {/* Token A Input */}
              <div className="bg-[#0d1117] rounded-xl p-4">
                <div className="flex justify-between text-sm text-[#8b949e] mb-2">
                  <span>{formatDenom(selectedPool.denomA)}</span>
                  <span>Balance: {walletAddress ? formatAmount(balances.get(selectedPool.denomA) || 0n, selectedPool.denomA) : '--'}</span>
                </div>
                <input
                  type="number"
                  placeholder="0.00"
                  value={amountA}
                  onChange={(e) => handleAmountAChange(e.target.value)}
                  className="bg-transparent text-2xl font-medium w-full outline-none text-white placeholder-[#8b949e] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>

              <div className="flex justify-center">
                <div className="bg-[#21262d] rounded-lg p-2">
                  <PlusIcon />
                </div>
              </div>

              {/* Token B Input */}
              <div className="bg-[#0d1117] rounded-xl p-4">
                <div className="flex justify-between text-sm text-[#8b949e] mb-2">
                  <span>{formatDenom(selectedPool.denomB)}</span>
                  <span>Balance: {walletAddress ? formatAmount(balances.get(selectedPool.denomB) || 0n, selectedPool.denomB) : '--'}</span>
                </div>
                <input
                  type="number"
                  placeholder="0.00"
                  value={amountB}
                  onChange={(e) => setAmountB(e.target.value)}
                  className="bg-transparent text-2xl font-medium w-full outline-none text-white placeholder-[#8b949e] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>

              {/* Pool Info */}
              <div className="p-3 bg-[#0d1117] rounded-xl text-sm">
                <div className="flex justify-between text-[#8b949e]">
                  <span>Current Price</span>
                  <span>
                    1 {formatDenom(selectedPool.denomA)} = {calculatePrice(
                      selectedPool.reserveA,
                      selectedPool.reserveB,
                      selectedPool.denomA,
                      selectedPool.denomB
                    ).toFixed(6)} {formatDenom(selectedPool.denomB)}
                  </span>
                </div>
                <div className="flex justify-between text-[#8b949e] mt-1">
                  <span>Your Current LP</span>
                  <span>{formatAmount(userLpBalance, 'lp')}</span>
                </div>
                <div className="flex justify-between text-[#8b949e] mt-1">
                  <span>Your Share (after)</span>
                  <span>
                    {selectedPool.totalLP > 0n && amountA
                      ? (((Number(userLpBalance) + parseFloat(amountA) * 1_000_000) / (Number(selectedPool.totalLP) + parseFloat(amountA) * 1_000_000)) * 100).toFixed(2)
                      : getUserPoolShare(selectedPoolId, selectedPool).toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Add Button */}
              <button
                onClick={handleAddLiquidity}
                disabled={!walletAddress || !amountA || !amountB || actionLoading}
                className={`w-full py-4 rounded-xl font-semibold text-lg transition ${
                  walletAddress && amountA && amountB && !actionLoading
                    ? 'bg-[#238636] hover:bg-[#2ea043] text-white'
                    : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'
                }`}
              >
                {actionLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                    Adding...
                  </span>
                ) : !walletAddress ? (
                  'Connect Wallet'
                ) : (
                  'Add Liquidity'
                )}
              </button>
            </>
          )}
        </div>
      )}

      {activePoolTab === 'remove' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Remove Liquidity</h3>
          
          {/* Pool Selector */}
          {pools.length > 0 && (
            <select
              value={selectedPoolId}
              onChange={(e) => {
                setSelectedPoolId(parseInt(e.target.value))
                setLpAmount('')
                setSelectedPercent(null)
              }}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-white"
            >
              {pools.map((pool) => {
                const lp = lpBalances.get(pool.id) || 0n
                return (
                  <option key={pool.id} value={pool.id}>
                    {formatDenom(pool.denomA)}/{formatDenom(pool.denomB)} - Pool #{pool.id}
                    {lp > 0n ? ` (${formatAmount(lp, 'lp')} LP)` : ''}
                  </option>
                )
              })}
            </select>
          )}

          {selectedPool && (
            <>
              {/* Your Position Info */}
              <div className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d]">
                <p className="text-sm text-[#8b949e] mb-3">Your Position</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[#8b949e]">LP Token Balance</p>
                    <p className="text-xl font-semibold text-white">
                      {formatAmount(userLpBalance, 'lp')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8b949e]">Pool Share</p>
                    <p className="text-xl font-semibold text-white">
                      {getUserPoolShare(selectedPoolId, selectedPool).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8b949e]">Your {formatDenom(selectedPool.denomA)}</p>
                    <p className="text-white">
                      {formatAmount(
                        selectedPool.totalLP > 0n ? (userLpBalance * selectedPool.reserveA / selectedPool.totalLP) : 0n,
                        selectedPool.denomA
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#8b949e]">Your {formatDenom(selectedPool.denomB)}</p>
                    <p className="text-white">
                      {formatAmount(
                        selectedPool.totalLP > 0n ? (userLpBalance * selectedPool.reserveB / selectedPool.totalLP) : 0n,
                        selectedPool.denomB
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* Amount Selection */}
              <div className="bg-[#0d1117] rounded-xl p-4">
                <div className="flex justify-between text-sm text-[#8b949e] mb-2">
                  <span>Amount to Remove</span>
                  <span>Available: {formatAmount(userLpBalance, 'lp')}</span>
                </div>
                
                {/* Percentage Buttons */}
                <div className="flex gap-2 mb-4">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => handlePercentage(pct)}
                      disabled={userLpBalance === 0n}
                      className={`flex-1 py-2 text-sm rounded-lg transition font-medium ${
                        selectedPercent === pct
                          ? 'bg-[#238636] text-white'
                          : userLpBalance > 0n
                            ? 'bg-[#21262d] text-[#8b949e] hover:text-white hover:bg-[#30363d]'
                            : 'bg-[#21262d] text-[#484f58] cursor-not-allowed'
                      }`}
                    >
                      {pct === 100 ? 'Max' : `${pct}%`}
                    </button>
                  ))}
                </div>

                {/* Slider */}
                <div className="mb-4">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sliderPercent}
                    onChange={(e) => handleSliderChange(parseInt(e.target.value))}
                    disabled={userLpBalance === 0n}
                    className="w-full h-2 bg-[#21262d] rounded-lg appearance-none cursor-pointer accent-[#238636] disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div className="flex justify-between text-xs text-[#8b949e] mt-1">
                    <span>0%</span>
                    <span className="text-[#238636] font-medium">{sliderPercent}%</span>
                    <span>100%</span>
                  </div>
                </div>

                {/* LP Amount Display */}
                <input
                  type="number"
                  placeholder="0.00"
                  value={lpAmount}
                  onChange={(e) => handleLpAmountChange(e.target.value)}
                  className="bg-transparent text-2xl font-medium w-full outline-none text-white placeholder-[#8b949e] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>

              {/* Expected Output */}
              {lpAmount && parseFloat(lpAmount) > 0 && (
                <div className="p-3 bg-[#0d1117] rounded-xl text-sm">
                  <p className="text-[#8b949e] mb-2">You will receive:</p>
                  <div className="flex justify-between text-white">
                    <span>{formatDenom(selectedPool.denomA)}</span>
                    <span>
                      {formatAmount(
                        BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000 * Number(selectedPool.reserveA) / Number(selectedPool.totalLP))),
                        selectedPool.denomA
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-white mt-1">
                    <span>{formatDenom(selectedPool.denomB)}</span>
                    <span>
                      {formatAmount(
                        BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000 * Number(selectedPool.reserveB) / Number(selectedPool.totalLP))),
                        selectedPool.denomB
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Remove Button */}
              <button
                onClick={handleRemoveLiquidity}
                disabled={!walletAddress || !lpAmount || parseFloat(lpAmount) <= 0 || actionLoading || userLpBalance === 0n}
                className={`w-full py-4 rounded-xl font-semibold text-lg transition ${
                  walletAddress && lpAmount && parseFloat(lpAmount) > 0 && !actionLoading && userLpBalance > 0n
                    ? 'bg-[#f85149] hover:bg-[#da3633] text-white'
                    : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'
                }`}
              >
                {actionLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                    Removing...
                  </span>
                ) : !walletAddress ? (
                  'Connect Wallet'
                ) : userLpBalance === 0n ? (
                  'No LP Tokens'
                ) : (
                  'Remove Liquidity'
                )}
              </button>
            </>
          )}
        </div>
      )}

      {activePoolTab === 'create' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Create New Pool</h3>
          
          <div className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d]">
            <p className="text-sm text-[#8b949e] mb-4">
              Create a new liquidity pool by specifying two tokens and a fee tier.
              After creating the pool, you'll need to add initial liquidity.
            </p>
            
            {/* Token A */}
            <div className="mb-4">
              <label className="text-sm text-[#8b949e] block mb-2">Token A (Base)</label>
              <select
                value={newTokenA}
                onChange={(e) => setNewTokenA(e.target.value)}
                className="w-full bg-[#161b22] border border-[#30363d] rounded-xl px-3 py-3 text-white"
              >
                <option value="ugnot">GNOT (ugnot)</option>
              </select>
              <p className="text-xs text-[#8b949e] mt-1">Native token is recommended as base</p>
            </div>
            
            {/* Token B */}
            <div className="mb-4">
              <label className="text-sm text-[#8b949e] block mb-2">Token B (Quote)</label>
              <input
                type="text"
                value={newTokenB}
                onChange={(e) => setNewTokenB(e.target.value)}
                placeholder="/gno.land/r/dev/gnomo:usdc"
                className="w-full bg-[#161b22] border border-[#30363d] rounded-xl px-3 py-3 text-white placeholder-[#484f58]"
              />
              <p className="text-xs text-[#8b949e] mt-1">Full realm token path (e.g., /gno.land/r/dev/gnomo:tokenname)</p>
            </div>
            
            {/* Fee Tier */}
            <div className="mb-4">
              <label className="text-sm text-[#8b949e] block mb-2">Fee Tier</label>
              <div className="flex gap-2">
                {[30, 50, 100].map((fee) => (
                  <button
                    key={fee}
                    onClick={() => setNewFeeBps(fee)}
                    className={`flex-1 py-3 rounded-xl text-sm font-medium transition ${
                      newFeeBps === fee
                        ? 'bg-[#238636] text-white'
                        : 'bg-[#161b22] text-[#8b949e] hover:text-white border border-[#30363d]'
                    }`}
                  >
                    {(fee / 100).toFixed(1)}%
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#8b949e] mt-2">
                0.3% is standard for most V2 pools
              </p>
            </div>
          </div>

          {/* Pool Preview */}
          {newTokenB && (
            <div className="p-3 bg-[#0d1117] rounded-xl text-sm">
              <p className="text-[#8b949e] mb-2">Pool Preview:</p>
              <div className="flex justify-between text-white">
                <span>Pair</span>
                <span>GNOT / {newTokenB.split(':').pop()?.toUpperCase() || 'TOKEN'}</span>
              </div>
              <div className="flex justify-between text-white mt-1">
                <span>Fee</span>
                <span>{newFeeBps / 100}%</span>
              </div>
            </div>
          )}

          {/* Create Button */}
          <button
            onClick={async () => {
              if (!walletAddress || !newTokenB) return
              
              setActionLoading(true)
              try {
                const result = await adenaCreatePool({
                  caller: walletAddress,
                  denomA: newTokenA,
                  denomB: newTokenB,
                  feeBps: newFeeBps,
                })

                if (result.code === 0) {
                  alert('Pool created successfully! Now add initial liquidity.')
                  setNewTokenB('')
                  setActivePoolTab('add')
                  await onRefresh()
                } else if (result.code === 4001 || result.code === 4000) {
                  console.log('Transaction timed out or cancelled')
                } else {
                  alert(`Failed: ${result.message || 'Unknown error'}`)
                }
              } catch (error) {
                console.error('Create pool error:', error)
                const msg = error instanceof Error ? error.message : ''
                if (!msg.includes('rejected') && !msg.includes('timed out')) {
                  alert(msg || 'Failed to create pool')
                }
              } finally {
                setActionLoading(false)
              }
            }}
            disabled={!walletAddress || !newTokenB || actionLoading}
            className={`w-full py-4 rounded-xl font-semibold text-lg transition ${
              walletAddress && newTokenB && !actionLoading
                ? 'bg-[#238636] hover:bg-[#2ea043] text-white'
                : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'
            }`}
          >
            {actionLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                Creating...
              </span>
            ) : !walletAddress ? (
              'Connect Wallet'
            ) : !newTokenB ? (
              'Enter Token B'
            ) : (
              'Create Pool'
            )}
          </button>

          {/* Dev Tools - Mint Test Tokens */}
          <div className="mt-6 p-4 bg-[#0d1117] rounded-xl border border-dashed border-[#30363d]">
            <p className="text-sm text-[#f0883e] mb-3">🔧 Dev Tools - Mint Test Tokens</p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={mintTokenName}
                onChange={(e) => setMintTokenName(e.target.value.toLowerCase())}
                placeholder="token name (e.g., dai)"
                className="flex-1 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-white text-sm placeholder-[#484f58]"
              />
              <input
                type="text"
                value={mintAmount}
                onChange={(e) => setMintAmount(e.target.value)}
                placeholder="amount"
                className="w-28 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <button
              onClick={async () => {
                if (!walletAddress || !mintTokenName) return
                setActionLoading(true)
                try {
                  const result = await adenaMintTokens({
                    caller: walletAddress,
                    baseName: mintTokenName,
                    amount: BigInt(mintAmount),
                  })
                  if (result.code === 0) {
                    alert(`Minted ${mintAmount} ${mintTokenName.toUpperCase()}! Token path: /gno.land/r/dev/gnomo:${mintTokenName}`)
                    setMintTokenName('')
                    await onRefresh()
                  } else if (result.code !== 4001 && result.code !== 4000) {
                    alert(`Failed: ${result.message}`)
                  }
                } catch (e) {
                  console.error('Mint error:', e)
                } finally {
                  setActionLoading(false)
                }
              }}
              disabled={!walletAddress || !mintTokenName || actionLoading}
              className="w-full py-2 rounded-lg text-sm font-medium bg-[#f0883e] hover:bg-[#d97706] text-white disabled:bg-[#21262d] disabled:text-[#8b949e] disabled:cursor-not-allowed transition"
            >
              Mint Tokens
            </button>
            <p className="text-xs text-[#8b949e] mt-2">
              Creates new test tokens. Use the token path shown after minting to create a pool.
            </p>
          </div>
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
      {token?.[0] || '?'}
    </div>
  )
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
