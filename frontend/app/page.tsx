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
  getBalances,
  createCLMMPool,
  mintCLMMPosition,
  burnCLMMPosition,
  swapCLMM,
} from '@/lib/adena'
import {
  getAllCLMMPools,
  getPositionsByOwner,
  getPosition,
  getCLMMQuote,
  CLMMPool,
  CLMMPosition,
  formatCLMMDenom,
  formatPriceX6,
  tickToPrice,
  priceToTick,
} from '@/lib/clmm'

type BestQuoteResult = {
  pool: PoolInfo | null
  clmmPool: CLMMPool | null
  poolType: 'v2' | 'clmm'
  amountOut: bigint
  tokenIn: 'A' | 'B'
}

// Helper to format token amounts with 6 decimals
function fmtAmt(amount: bigint): string {
  const num = Number(amount) / 1_000_000
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })
}

// Helper to calculate simple price ratio
function calcPrice(reserveA: bigint, reserveB: bigint): string {
  if (reserveA === 0n) return '0.0000'
  const price = Number(reserveB) / Number(reserveA)
  return price.toFixed(4)
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'swap' | 'pool' | 'clmm'>('swap')
  const [pools, setPools] = useState<PoolInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [swapLoading, setSwapLoading] = useState(false)
  
  const [fromToken, setFromToken] = useState<string>('')
  const [toToken, setToToken] = useState<string>('')
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [bestQuote, setBestQuote] = useState<BestQuoteResult | null>(null)
  
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletConnecting, setWalletConnecting] = useState(false)
  const [adenaAvailable, setAdenaAvailable] = useState(false)
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map())
  const [lpBalances, setLpBalances] = useState<Map<number, bigint>>(new Map())
  
  const [slippageBps, setSlippageBps] = useState(50)
  const [showSettings, setShowSettings] = useState(false)

  const [clmmPools, setClmmPools] = useState<CLMMPool[]>([])
  const [clmmPositions, setClmmPositions] = useState<CLMMPosition[]>([])
  const [clmmTab, setClmmTab] = useState<'pools' | 'positions' | 'create' | 'mint'>('pools')
  const [selectedClmmPool, setSelectedClmmPool] = useState<CLMMPool | null>(null)
  const [clmmLoading, setClmmLoading] = useState(false)
  
  const [newClmmTokenA, setNewClmmTokenA] = useState('ugnot')
  const [newClmmTokenB, setNewClmmTokenB] = useState('')
  const [newClmmFee, setNewClmmFee] = useState(30)
  const [newClmmInitialPrice, setNewClmmInitialPrice] = useState('1')
  
  const [mintTickLower, setMintTickLower] = useState(-10)
  const [mintTickUpper, setMintTickUpper] = useState(10)
  const [mintAmountA, setMintAmountA] = useState('')
  const [mintAmountB, setMintAmountB] = useState('')
  const [mintPriceLower, setMintPriceLower] = useState('0.5')
  const [mintPriceUpper, setMintPriceUpper] = useState('2.0')

  const availableTokens = useCallback(() => {
    const tokens = new Set<string>()
    // Add tokens from V2 pools
    pools.forEach(pool => {
      tokens.add(pool.denomA)
      tokens.add(pool.denomB)
    })
    // Add tokens from CLMM pools
    clmmPools.forEach(pool => {
      tokens.add(pool.denomA)
      tokens.add(pool.denomB)
    })
    return Array.from(tokens)
  }, [pools, clmmPools])

  const findPoolsForPair = useCallback((tokenA: string, tokenB: string): PoolInfo[] => {
    if (!tokenA || !tokenB) return []
    return pools.filter(p => 
      (p.denomA === tokenA && p.denomB === tokenB) ||
      (p.denomA === tokenB && p.denomB === tokenA)
    )
  }, [pools])

  const matchingPools = findPoolsForPair(fromToken, toToken)

  useEffect(() => {
    const checkAdena = () => setAdenaAvailable(isAdenaInstalled())
    checkAdena()
    const timeout = setTimeout(checkAdena, 1000)
    return () => clearTimeout(timeout)
  }, [])

  useEffect(() => {
    const tryReconnect = async () => {
      if (adenaAvailable && !walletAddress) {
        try {
          const account = await getAdenaAccount()
          if (account?.address) {
            setWalletAddress(account.address)
            const b = await getBalances()
            setBalances(b)
          }
        } catch (e) { /* wallet locked */ }
      }
    }
    tryReconnect()
  }, [adenaAvailable, walletAddress])

  useEffect(() => {
    const fetchBalances = async () => {
      if (walletAddress) {
        try {
          const account = await getAdenaAccount()
          if (!account?.address) {
            setWalletAddress(null)
            setBalances(new Map())
            setLpBalances(new Map())
            return
          }
          const b = await getBalances()
          setBalances(b)
        } catch (e) {
          console.error('Failed to fetch balances:', e)
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

  useEffect(() => {
    const fetchLPBalances = async () => {
      if (walletAddress && pools.length > 0) {
        const newLpBalances = new Map<number, bigint>()
        for (const pool of pools) {
          try {
            const balance = await getLPBalance(pool.id, walletAddress)
            if (balance > 0n) newLpBalances.set(pool.id, balance)
          } catch (e) { /* ignore */ }
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

  useEffect(() => {
    const fetchPools = async () => {
      try {
        const poolData = await getAllPools()
        setPools(poolData)
        if (poolData.length > 0 && !fromToken && !toToken) {
          setFromToken(poolData[0].denomB)
          setToToken(poolData[0].denomA)
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
  }, [fromToken, toToken])

  useEffect(() => {
    const fetchClmmPools = async () => {
      try {
        const pools = await getAllCLMMPools()
        setClmmPools(pools)
      } catch (e) {
        console.error('Failed to fetch CLMM pools:', e)
      }
    }
    fetchClmmPools()
    const interval = setInterval(fetchClmmPools, 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const fetchClmmPositions = async () => {
      if (!walletAddress) {
        setClmmPositions([])
        return
      }
      try {
        const positionIds = await getPositionsByOwner(walletAddress)
        const positions: CLMMPosition[] = []
        for (const id of positionIds) {
          const pos = await getPosition(id)
          if (pos && pos.liquidity > 0n) positions.push(pos)
        }
        setClmmPositions(positions)
      } catch (e) {
        console.error('Failed to fetch CLMM positions:', e)
      }
    }
    fetchClmmPositions()
    const interval = setInterval(fetchClmmPositions, 60000)
    return () => clearInterval(interval)
  }, [walletAddress])

  useEffect(() => {
    if (selectedClmmPool) {
      // Set default price range based on current price
      const currentPrice = Number(selectedClmmPool.priceX6) / 1_000_000
      const lowerPrice = currentPrice * 0.5  // 50% below
      const upperPrice = currentPrice * 2.0  // 100% above
      setMintPriceLower(lowerPrice.toFixed(4))
      setMintPriceUpper(upperPrice.toFixed(4))
      // Convert to ticks, aligned to spacing
      const spacing = selectedClmmPool.tickSpacing
      const lowerTick = Math.round(priceToTick(lowerPrice) / spacing) * spacing
      const upperTick = Math.round(priceToTick(upperPrice) / spacing) * spacing
      setMintTickLower(lowerTick)
      setMintTickUpper(upperTick)
    }
  }, [selectedClmmPool])

  const updateQuote = useCallback(async () => {
    if (!fromToken || !toToken || !fromAmount || parseFloat(fromAmount) <= 0) {
      setToAmount('')
      setBestQuote(null)
      return
    }

    setQuoteLoading(true)
    try {
      const amountIn = BigInt(Math.floor(parseFloat(fromAmount) * 1_000_000))
      let best: BestQuoteResult | null = null

      // Query V2 pools
      const matching = findPoolsForPair(fromToken, toToken)
      for (const pool of matching) {
        if (pool.reserveA === 0n || pool.reserveB === 0n) continue
        const tokenIn: 'A' | 'B' = pool.denomA === fromToken ? 'A' : 'B'
        try {
          const quote = await getQuote(pool.id, tokenIn, amountIn)
          if (quote > 0n && (!best || quote > best.amountOut)) {
            best = { pool, clmmPool: null, poolType: 'v2', amountOut: quote, tokenIn }
          }
        } catch (e) {
          console.error(`V2 Quote failed for pool ${pool.id}:`, e)
        }
      }

      // Query CLMM pools
      for (const clmmPool of clmmPools) {
        const isAtoB = clmmPool.denomA === fromToken && clmmPool.denomB === toToken
        const isBtoA = clmmPool.denomB === fromToken && clmmPool.denomA === toToken
        if (!isAtoB && !isBtoA) continue
        if (clmmPool.liquidity === 0n) continue

        const tokenIn: 'A' | 'B' = isAtoB ? 'A' : 'B'
        try {
          const quote = await getCLMMQuote(clmmPool.id, tokenIn, amountIn)
          if (quote > 0n && (!best || quote > best.amountOut)) {
            best = { pool: null, clmmPool, poolType: 'clmm', amountOut: quote, tokenIn }
          }
        } catch (e) {
          console.error(`CLMM Quote failed for pool ${clmmPool.id}:`, e)
        }
      }

      if (best) {
        setBestQuote(best)
        setToAmount(fmtAmt(best.amountOut))
      } else {
        setBestQuote(null)
        setToAmount('')
      }
    } catch (error) {
      console.error('Quote error:', error)
      setToAmount('')
      setBestQuote(null)
    } finally {
      setQuoteLoading(false)
    }
  }, [fromToken, toToken, fromAmount, findPoolsForPair, clmmPools])

  useEffect(() => {
    const timer = setTimeout(updateQuote, 300)
    return () => clearTimeout(timer)
  }, [updateQuote])

  const handleSwapDirection = () => {
    setFromToken(toToken)
    setToToken(fromToken)
    setFromAmount(toAmount)
    setToAmount('')
    setBestQuote(null)
  }

  const handleSwap = async () => {
    if (!walletAddress || !bestQuote || !fromAmount) return
    setSwapLoading(true)
    try {
      const amountIn = BigInt(Math.floor(parseFloat(fromAmount) * 1_000_000))
      const minOut = (bestQuote.amountOut * BigInt(10000 - slippageBps)) / 10000n

      let result
      if (bestQuote.poolType === 'v2' && bestQuote.pool) {
        result = await adenaSwap({
          caller: walletAddress,
          poolId: bestQuote.pool.id,
          tokenIn: bestQuote.tokenIn,
          amountIn,
          minAmountOut: minOut,
          denomIn: bestQuote.tokenIn === 'A' ? bestQuote.pool.denomA : bestQuote.pool.denomB,
        })
      } else if (bestQuote.poolType === 'clmm' && bestQuote.clmmPool) {
        result = await swapCLMM({
          caller: walletAddress,
          poolId: bestQuote.clmmPool.id,
          tokenIn: bestQuote.tokenIn,
          amountIn,
          minAmountOut: minOut,
          denomIn: bestQuote.tokenIn === 'A' ? bestQuote.clmmPool.denomA : bestQuote.clmmPool.denomB,
        })
      } else {
        throw new Error('Invalid quote')
      }

      if (result.code === 0) {
        alert('Swap successful!')
        setFromAmount('')
        setToAmount('')
        setBestQuote(null)
        await onRefresh()
      } else if (result.code !== 4001 && result.code !== 4000) {
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

  const [activePoolTab, setActivePoolTab] = useState<'pools' | 'add' | 'remove' | 'create'>('pools')
  const [selectedPoolId, setSelectedPoolId] = useState<number>(0)
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [lpAmount, setLpAmount] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [newTokenA, setNewTokenA] = useState('ugnot')
  const [newTokenB, setNewTokenB] = useState('')
  const [newFeeBps, setNewFeeBps] = useState(30)
  const [mintTokenName, setMintTokenName] = useState('')
  const [mintAmount, setMintAmount] = useState('1000000')
  const [selectedPercent, setSelectedPercent] = useState<number | null>(null)

  const selectedPool = pools.find(p => p.id === selectedPoolId) || pools[0]
  const userLpBalance = lpBalances.get(selectedPoolId) || 0n

  const connectWallet = async () => {
    if (!adenaAvailable) {
      window.open('https://adena.app', '_blank')
      return
    }
    setWalletConnecting(true)
    try {
      await switchToDevNetwork()
      const address = await connectAdena()
      if (address) {
        setWalletAddress(address)
        const b = await getBalances()
        setBalances(b)
      }
    } catch (e) {
      console.error('Connect error:', e)
    } finally {
      setWalletConnecting(false)
    }
  }

  const onRefresh = async () => {
    try {
      const poolData = await getAllPools()
      setPools(poolData)
      const clmmData = await getAllCLMMPools()
      setClmmPools(clmmData)
      if (walletAddress) {
        const b = await getBalances()
        setBalances(b)
        const newLpBalances = new Map<number, bigint>()
        for (const pool of poolData) {
          try {
            const balance = await getLPBalance(pool.id, walletAddress)
            if (balance > 0n) newLpBalances.set(pool.id, balance)
          } catch (e) { /* ignore */ }
        }
        setLpBalances(newLpBalances)
        const positionIds = await getPositionsByOwner(walletAddress)
        const positions: CLMMPosition[] = []
        for (const id of positionIds) {
          const pos = await getPosition(id)
          if (pos && pos.liquidity > 0n) positions.push(pos)
        }
        setClmmPositions(positions)
      }
    } catch (e) {
      console.error('Refresh error:', e)
    }
  }

  const getBalance = (denom: string): bigint => balances.get(denom) || 0n
  const formatBalance = (denom: string): string => fmtAmt(getBalance(denom))

  const getUserPoolShare = (poolId: number, pool: PoolInfo) => {
    const lpBal = lpBalances.get(poolId) || 0n
    if (pool.totalLP === 0n || lpBal === 0n) return 0
    return Number(lpBal * 10000n / pool.totalLP) / 100
  }

  const getUserPoolValue = (poolId: number, pool: PoolInfo) => {
    const lpBal = lpBalances.get(poolId) || 0n
    if (pool.totalLP === 0n || lpBal === 0n) return { amountA: 0n, amountB: 0n }
    return {
      amountA: (pool.reserveA * lpBal) / pool.totalLP,
      amountB: (pool.reserveB * lpBal) / pool.totalLP,
    }
  }

  const [lastEditedField, setLastEditedField] = useState<'A' | 'B' | null>(null)

  useEffect(() => {
    if (selectedPool && activePoolTab === 'add' && lastEditedField === 'A') {
      if (!amountA || parseFloat(amountA) === 0) {
        setAmountB('')
      } else if (selectedPool.reserveA > 0n && selectedPool.reserveB > 0n) {
        // Pool has reserves - calculate based on existing ratio
        const amtA = parseFloat(amountA) * 1_000_000
        const amtB = (amtA * Number(selectedPool.reserveB)) / Number(selectedPool.reserveA)
        setAmountB((amtB / 1_000_000).toFixed(6))
      } else {
        // New pool with no reserves - default to 1:1 ratio
        setAmountB(amountA)
      }
    }
  }, [amountA, selectedPool, activePoolTab, lastEditedField])

  useEffect(() => {
    if (selectedPool && activePoolTab === 'add' && lastEditedField === 'B') {
      if (!amountB || parseFloat(amountB) === 0) {
        setAmountA('')
      } else if (selectedPool.reserveA > 0n && selectedPool.reserveB > 0n) {
        // Pool has reserves - calculate based on existing ratio
        const amtB = parseFloat(amountB) * 1_000_000
        const amtA = (amtB * Number(selectedPool.reserveA)) / Number(selectedPool.reserveB)
        setAmountA((amtA / 1_000_000).toFixed(6))
      } else {
        // New pool with no reserves - default to 1:1 ratio
        setAmountA(amountB)
      }
    }
  }, [amountB, selectedPool, activePoolTab, lastEditedField])

  const handlePercentClick = (value: number) => {
    setSelectedPercent(value)
    const amount = (userLpBalance * BigInt(value)) / 100n
    setLpAmount(fmtAmt(amount))
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
      } else if (result.code !== 4001 && result.code !== 4000) {
        alert(`Failed: ${result.message || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Add liquidity error:', error)
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
      const lpAmt = BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000))
      const result = await adenaRemoveLiquidity({
        caller: walletAddress,
        poolId: selectedPool.id,
        lpAmount: lpAmt,
      })
      if (result.code === 0) {
        alert('Liquidity removed successfully!')
        setLpAmount('')
        setSelectedPercent(null)
        await onRefresh()
      } else if (result.code !== 4001 && result.code !== 4000) {
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

  const handleCreateClmmPool = async () => {
    if (!walletAddress || !newClmmTokenB) return
    setClmmLoading(true)
    try {
      const priceX6 = BigInt(Math.floor(parseFloat(newClmmInitialPrice) * 1_000_000))
      const result = await createCLMMPool({
        caller: walletAddress,
        denomA: newClmmTokenA,
        denomB: newClmmTokenB,
        feeBps: newClmmFee,
        initialPriceX6: priceX6,
      })
      if (result.code === 0) {
        alert('CLMM Pool created! Now add a position.')
        setNewClmmTokenB('')
        setNewClmmInitialPrice('1')
        setClmmTab('pools')
        await onRefresh()
      } else if (result.code !== 4001 && result.code !== 4000) {
        alert(`Failed: ${result.message}`)
      }
    } catch (e) {
      console.error('Create CLMM pool error:', e)
    } finally {
      setClmmLoading(false)
    }
  }

  const handleMintPosition = async () => {
    if (!walletAddress || !selectedClmmPool || !mintAmountA || !mintAmountB) return
    setClmmLoading(true)
    try {
      const amtA = BigInt(Math.floor(parseFloat(mintAmountA) * 1_000_000))
      const amtB = BigInt(Math.floor(parseFloat(mintAmountB) * 1_000_000))
      const result = await mintCLMMPosition({
        caller: walletAddress,
        poolId: selectedClmmPool.id,
        tickLower: mintTickLower,
        tickUpper: mintTickUpper,
        amountA: amtA,
        amountB: amtB,
        denomA: selectedClmmPool.denomA,
        denomB: selectedClmmPool.denomB,
      })
      if (result.code === 0) {
        alert('Position created!')
        setMintAmountA('')
        setMintAmountB('')
        setClmmTab('positions')
        await onRefresh()
      } else if (result.code !== 4001 && result.code !== 4000) {
        alert(`Failed: ${result.message}`)
      }
    } catch (e) {
      console.error('Mint position error:', e)
    } finally {
      setClmmLoading(false)
    }
  }

  const handleBurnPosition = async (positionId: number) => {
    if (!walletAddress) return
    setClmmLoading(true)
    try {
      const result = await burnCLMMPosition({
        caller: walletAddress,
        positionId,
      })
      if (result.code === 0) {
        alert('Position closed!')
        await onRefresh()
      } else if (result.code !== 4001 && result.code !== 4000) {
        alert(`Failed: ${result.message}`)
      }
    } catch (e) {
      console.error('Burn position error:', e)
    } finally {
      setClmmLoading(false)
    }
  }

  const rpcStatus = pools.length > 0 || !loading
  const totalTVL = pools.reduce((sum, pool) => sum + Number(pool.reserveA) + Number(pool.reserveB), 0)

  // Helper for fee display - PoolInfo uses feeBps (number)
  const fmtFee = (feeBps: number) => feeBps < 100 ? (feeBps / 100).toFixed(2) : (feeBps / 100).toFixed(1)

  return (
    <div className="min-h-screen bg-[#0d1117]">
      <header className="border-b border-[#21262d] bg-[#161b22]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold text-[#238636]">Gnomo DEX</h1>
            <nav className="flex gap-1">
              {(['swap', 'pool', 'clmm'] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg font-medium transition capitalize ${activeTab === tab ? 'bg-[#238636] text-white' : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'}`}>{tab}</button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 text-sm ${rpcStatus ? 'text-[#238636]' : 'text-[#f85149]'}`}>
              <span className={`w-2 h-2 rounded-full ${rpcStatus ? 'bg-[#238636]' : 'bg-[#f85149]'}`} />
              {rpcStatus ? 'RPC Connected' : 'RPC Disconnected'}
            </div>
            {walletAddress ? (
              <div className="bg-[#21262d] px-4 py-2 rounded-lg text-sm font-medium">{walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}</div>
            ) : (
              <button onClick={connectWallet} disabled={walletConnecting} className="bg-[#238636] hover:bg-[#2ea043] px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50">
                {walletConnecting ? 'Connecting...' : adenaAvailable ? 'Connect Wallet' : 'Install Adena'}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {activeTab === 'swap' && (
          <div className="max-w-md mx-auto">
            <div className="bg-[#161b22] rounded-2xl border border-[#30363d] p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Swap</h2>
                <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-[#21262d] rounded-lg transition text-[#8b949e] hover:text-white"><SettingsIcon /></button>
              </div>

              {showSettings && (
                <div className="mb-4 p-3 bg-[#0d1117] rounded-xl">
                  <label className="text-sm text-[#8b949e]">Slippage Tolerance</label>
                  <div className="flex gap-2 mt-2">
                    {[10, 50, 100, 200].map((bps) => (
                      <button key={bps} onClick={() => setSlippageBps(bps)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${slippageBps === bps ? 'bg-[#238636] text-white' : 'bg-[#21262d] text-[#8b949e] hover:text-white'}`}>{(bps / 100).toFixed(1)}%</button>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-[#0d1117] rounded-xl p-4 mb-2">
                <div className="flex justify-between mb-2">
                  <select value={fromToken} onChange={(e) => { setFromToken(e.target.value); setFromAmount(''); setToAmount(''); setBestQuote(null) }} className="bg-[#21262d] text-white font-medium px-3 py-2 rounded-lg border border-[#30363d] cursor-pointer">
                    <option value="">Select token</option>
                    {availableTokens().map((token) => <option key={token} value={token}>{formatDenom(token)}</option>)}
                  </select>
                  <span className="text-sm text-[#8b949e]">Balance: {fromToken ? formatBalance(fromToken) : '0'}</span>
                </div>
                <input type="text" value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} placeholder="0.00" className="w-full bg-transparent text-3xl font-medium outline-none" />
              </div>

              <div className="flex justify-center -my-2 relative z-10">
                <button onClick={handleSwapDirection} className="bg-[#21262d] p-2 rounded-xl border-4 border-[#161b22] hover:bg-[#30363d] transition"><SwapIcon /></button>
              </div>

              <div className="bg-[#0d1117] rounded-xl p-4 mt-2">
                <div className="flex justify-between mb-2">
                  <select value={toToken} onChange={(e) => { setToToken(e.target.value); setToAmount(''); setBestQuote(null) }} className="bg-[#21262d] text-white font-medium px-3 py-2 rounded-lg border border-[#30363d] cursor-pointer">
                    <option value="">Select token</option>
                    {availableTokens().map((token) => <option key={token} value={token}>{formatDenom(token)}</option>)}
                  </select>
                  <span className="text-sm text-[#8b949e]">Balance: {toToken ? formatBalance(toToken) : '0'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input type="text" value={toAmount} readOnly placeholder="0.00" className="w-full bg-transparent text-3xl font-medium outline-none text-[#8b949e]" />
                  {quoteLoading && <div className="animate-spin w-5 h-5 border-2 border-[#238636] border-t-transparent rounded-full" />}
                </div>
              </div>

              {bestQuote && (
                <div className="mt-3 p-3 bg-[#0d1117] rounded-xl text-sm">
                  {(matchingPools.length + clmmPools.filter(p => (p.denomA === fromToken && p.denomB === toToken) || (p.denomB === fromToken && p.denomA === toToken)).length) > 1 && (
                    <p className="text-[#8b949e]">Comparing V2 & CLMM pools for best rate</p>
                  )}
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-[#8b949e]">Best route:</span>
                    <span className="font-medium">
                      {bestQuote.poolType === 'v2' && bestQuote.pool && (
                        <span className="text-[#238636]">V2 {fmtFee(bestQuote.pool.feeBps)}% pool</span>
                      )}
                      {bestQuote.poolType === 'clmm' && bestQuote.clmmPool && (
                        <span className="text-[#58a6ff]">CLMM {(bestQuote.clmmPool.feeBPS / 100).toFixed(2)}% pool</span>
                      )}
                    </span>
                  </div>
                  {fromAmount && toAmount && (
                    <div className="flex justify-between text-[#8b949e] mt-1">
                      <span>Rate</span>
                      <span>1 {formatDenom(fromToken)} = {(parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(6)} {formatDenom(toToken)}</span>
                    </div>
                  )}
                </div>
              )}

              {fromToken && toToken && !bestQuote && !quoteLoading && matchingPools.length === 0 && clmmPools.filter(p => (p.denomA === fromToken && p.denomB === toToken) || (p.denomB === fromToken && p.denomA === toToken)).length === 0 && (
                <div className="mt-3 p-3 bg-[#f8514926] border border-[#f85149] rounded-xl text-sm text-[#f85149]">
                  No pool available for {formatDenom(fromToken)}/{formatDenom(toToken)}
                </div>
              )}

              <button onClick={handleSwap} disabled={!walletAddress || !bestQuote || swapLoading} className={`w-full mt-4 py-4 rounded-xl font-semibold text-lg transition ${walletAddress && bestQuote && !swapLoading ? 'bg-[#238636] hover:bg-[#2ea043] text-white' : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'}`}>
                {swapLoading ? <span className="flex items-center justify-center gap-2"><span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />Swapping...</span> : !walletAddress ? 'Connect Wallet' : !fromToken || !toToken ? 'Select Tokens' : !fromAmount ? 'Enter Amount' : !bestQuote && !quoteLoading ? 'No Pool Available' : !bestQuote ? 'Finding Best Rate...' : 'Swap'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'pool' && (
          <div className="max-w-lg mx-auto">
            <div className="bg-[#161b22] rounded-2xl border border-[#30363d] p-4">
              <div className="flex gap-2 mb-6">
                {(['pools', 'add', 'remove', 'create'] as const).map((tab) => (
                  <button key={tab} onClick={() => setActivePoolTab(tab)} className={`px-4 py-2 rounded-lg font-medium transition capitalize ${activePoolTab === tab ? 'bg-[#238636] text-white' : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'}`}>{tab === 'add' ? 'Add Liquidity' : tab}</button>
                ))}
              </div>

              {activePoolTab === 'pools' && (
                <div className="space-y-4">
                  {loading ? <div className="text-center py-8 text-[#8b949e]">Loading pools...</div> : pools.length === 0 ? <div className="text-center py-8 text-[#8b949e]">No pools yet. Create one!</div> : pools.map((pool) => {
                    const share = getUserPoolShare(pool.id, pool)
                    const value = getUserPoolValue(pool.id, pool)
                    return (
                      <div key={pool.id} className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d]">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-2"><TokenIcon token={formatDenom(pool.denomA)} /><TokenIcon token={formatDenom(pool.denomB)} /></div>
                            <span className="font-semibold">{formatDenom(pool.denomA)}/{formatDenom(pool.denomB)}</span>
                          </div>
                          <span className="text-xs bg-[#21262d] px-2 py-1 rounded-full text-[#8b949e]">{fmtFee(pool.feeBps)}% fee</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div><p className="text-[#8b949e]">Reserve {formatDenom(pool.denomA)}</p><p className="font-medium">{fmtAmt(pool.reserveA)}</p></div>
                          <div><p className="text-[#8b949e]">Reserve {formatDenom(pool.denomB)}</p><p className="font-medium">{fmtAmt(pool.reserveB)}</p></div>
                          <div><p className="text-[#8b949e]">Total LP</p><p className="font-medium">{fmtAmt(pool.totalLP)}</p></div>
                          <div><p className="text-[#8b949e]">Price</p><p className="font-medium">1:{calcPrice(pool.reserveA, pool.reserveB)}</p></div>
                        </div>
                        <div className="mt-2 p-2 bg-[#21262d] rounded-lg text-sm">
                          <div className="flex justify-between">
                            <span className="text-[#8b949e]">TVL</span>
                            <span className="font-medium text-[#238636]">~{(Number(pool.reserveA) / 1_000_000 * 2).toFixed(2)} {formatDenom(pool.denomA)}</span>
                          </div>
                        </div>
                        {share > 0 && (
                          <div className="mt-3 pt-3 border-t border-[#30363d]">
                            <p className="text-[#238636] text-sm font-medium mb-2">Your Position</p>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div><p className="text-[#8b949e]">Your LP</p><p className="font-medium">{fmtAmt(lpBalances.get(pool.id) || 0n)}</p></div>
                              <div><p className="text-[#8b949e]">Pool Share</p><p className="font-medium">{share.toFixed(2)}%</p></div>
                              <div><p className="text-[#8b949e]">Your {formatDenom(pool.denomA)}</p><p className="font-medium">{fmtAmt(value.amountA)}</p></div>
                              <div><p className="text-[#8b949e]">Your {formatDenom(pool.denomB)}</p><p className="font-medium">{fmtAmt(value.amountB)}</p></div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  <div className="mt-4 p-4 bg-[#0d1117] rounded-xl border border-dashed border-[#30363d] text-center">
                    <p className="text-[#8b949e]">🌱 Check out the <button onClick={() => setActiveTab('clmm')} className="text-[#238636] hover:underline">CLMM tab</button> for concentrated liquidity</p>
                  </div>
                </div>
              )}

              {activePoolTab === 'add' && selectedPool && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Add Liquidity</h3>
                  <select value={selectedPoolId} onChange={(e) => { setSelectedPoolId(parseInt(e.target.value)); setAmountA(''); setAmountB('') }} className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-3 text-white">
                    {pools.map((pool) => <option key={pool.id} value={pool.id}>{formatDenom(pool.denomA)}/{formatDenom(pool.denomB)} ({fmtFee(pool.feeBps)}%) - Pool #{pool.id}</option>)}
                  </select>
                  <div className="bg-[#0d1117] rounded-xl p-4">
                    <div className="flex justify-between mb-2"><span className="text-[#8b949e]">{formatDenom(selectedPool.denomA)}</span><span className="text-sm text-[#8b949e]">Balance: {formatBalance(selectedPool.denomA)}</span></div>
                    <input type="text" value={amountA} onChange={(e) => { setLastEditedField('A'); setAmountA(e.target.value) }} placeholder="0.00" className="w-full bg-transparent text-2xl font-medium outline-none" />
                  </div>
                  <div className="flex justify-center"><div className="bg-[#21262d] p-2 rounded-xl"><PlusIcon /></div></div>
                  <div className="bg-[#0d1117] rounded-xl p-4">
                    <div className="flex justify-between mb-2"><span className="text-[#8b949e]">{formatDenom(selectedPool.denomB)}</span><span className="text-sm text-[#8b949e]">Balance: {formatBalance(selectedPool.denomB)}</span></div>
                    <input type="text" value={amountB} onChange={(e) => { setLastEditedField('B'); setAmountB(e.target.value) }} placeholder="0.00" className="w-full bg-transparent text-2xl font-medium outline-none" />
                  </div>
                  <div className="p-3 bg-[#0d1117] rounded-xl text-sm space-y-1">
                    <div className="flex justify-between text-[#8b949e]"><span>Current Price</span><span>1 {formatDenom(selectedPool.denomA)} = {calcPrice(selectedPool.reserveA, selectedPool.reserveB)} {formatDenom(selectedPool.denomB)}</span></div>
                    <div className="flex justify-between text-[#8b949e]"><span>Your Current LP</span><span>{fmtAmt(userLpBalance)}</span></div>
                  </div>
                  <button onClick={handleAddLiquidity} disabled={!walletAddress || !amountA || !amountB || actionLoading} className={`w-full py-4 rounded-xl font-semibold text-lg transition ${walletAddress && amountA && amountB && !actionLoading ? 'bg-[#238636] hover:bg-[#2ea043] text-white' : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'}`}>
                    {actionLoading ? <span className="flex items-center justify-center gap-2"><span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />Adding...</span> : !walletAddress ? 'Connect Wallet' : 'Add Liquidity'}
                  </button>
                </div>
              )}

              {activePoolTab === 'remove' && selectedPool && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Remove Liquidity</h3>
                  <select value={selectedPoolId} onChange={(e) => { setSelectedPoolId(parseInt(e.target.value)); setLpAmount(''); setSelectedPercent(null) }} className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-3 text-white">
                    {pools.map((pool) => <option key={pool.id} value={pool.id}>{formatDenom(pool.denomA)}/{formatDenom(pool.denomB)} ({fmtFee(pool.feeBps)}%) - Pool #{pool.id}</option>)}
                  </select>
                  <div className="p-3 bg-[#0d1117] rounded-xl"><p className="text-[#8b949e] text-sm mb-1">Your LP Balance</p><p className="text-xl font-medium">{fmtAmt(userLpBalance)}</p></div>
                  <div className="grid grid-cols-4 gap-2">
                    {[25, 50, 75, 100].map((pct) => <button key={pct} onClick={() => handlePercentClick(pct)} className={`py-2 rounded-lg text-sm font-medium transition ${selectedPercent === pct ? 'bg-[#238636] text-white' : 'bg-[#21262d] text-[#8b949e] hover:text-white'}`}>{pct === 100 ? 'Max' : `${pct}%`}</button>)}
                  </div>
                  <div className="bg-[#0d1117] rounded-xl p-4">
                    <div className="flex justify-between mb-2"><span className="text-[#8b949e]">LP Tokens to Remove</span></div>
                    <input type="text" value={lpAmount} onChange={(e) => { setSelectedPercent(null); setLpAmount(e.target.value) }} placeholder="0.00" className="w-full bg-transparent text-2xl font-medium outline-none" />
                  </div>
                  {lpAmount && parseFloat(lpAmount) > 0 && (
                    <div className="p-3 bg-[#0d1117] rounded-xl text-sm space-y-1">
                      <p className="text-[#8b949e] mb-2">You will receive:</p>
                      <div className="flex justify-between"><span>{formatDenom(selectedPool.denomA)}</span><span>{selectedPool.totalLP > 0n ? fmtAmt((selectedPool.reserveA * BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000))) / selectedPool.totalLP) : '0'}</span></div>
                      <div className="flex justify-between"><span>{formatDenom(selectedPool.denomB)}</span><span>{selectedPool.totalLP > 0n ? fmtAmt((selectedPool.reserveB * BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000))) / selectedPool.totalLP) : '0'}</span></div>
                    </div>
                  )}
                  <button onClick={handleRemoveLiquidity} disabled={!walletAddress || !lpAmount || parseFloat(lpAmount) <= 0 || actionLoading} className={`w-full py-4 rounded-xl font-semibold text-lg transition ${walletAddress && lpAmount && parseFloat(lpAmount) > 0 && !actionLoading ? 'bg-[#f85149] hover:bg-[#da3633] text-white' : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'}`}>
                    {actionLoading ? <span className="flex items-center justify-center gap-2"><span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />Removing...</span> : !walletAddress ? 'Connect Wallet' : 'Remove Liquidity'}
                  </button>
                </div>
              )}

              {activePoolTab === 'create' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Create New Pool</h3>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Token A (Base)</label><input type="text" value={newTokenA} onChange={(e) => setNewTokenA(e.target.value)} placeholder="ugnot" className="w-full bg-[#161b22] border border-[#30363d] rounded-xl px-3 py-3 text-white placeholder-[#484f58]" /></div>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Token B (Quote)</label><input type="text" value={newTokenB} onChange={(e) => setNewTokenB(e.target.value)} placeholder="/gno.land/r/dev/gnomo:usdc" className="w-full bg-[#161b22] border border-[#30363d] rounded-xl px-3 py-3 text-white placeholder-[#484f58]" /></div>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Fee Tier</label><div className="grid grid-cols-3 gap-2">{[5, 10, 30, 50, 100, 200].map((fee) => <button key={fee} onClick={() => setNewFeeBps(fee)} className={`py-3 rounded-xl text-sm font-medium transition ${newFeeBps === fee ? 'bg-[#238636] text-white' : 'bg-[#161b22] text-[#8b949e] hover:text-white border border-[#30363d]'}`}>{fmtFee(fee)}%</button>)}</div></div>
                  <button onClick={async () => { if (!walletAddress || !newTokenB) return; setActionLoading(true); try { const result = await adenaCreatePool({ caller: walletAddress, denomA: newTokenA, denomB: newTokenB, feeBps: newFeeBps }); if (result.code === 0) { alert('Pool created!'); setNewTokenB(''); setActivePoolTab('add'); await onRefresh() } else if (result.code !== 4001 && result.code !== 4000) { alert(`Failed: ${result.message}`) } } catch (e) { console.error(e) } finally { setActionLoading(false) } }} disabled={!walletAddress || !newTokenB || actionLoading} className={`w-full py-4 rounded-xl font-semibold text-lg transition ${walletAddress && newTokenB && !actionLoading ? 'bg-[#238636] hover:bg-[#2ea043] text-white' : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'}`}>
                    {actionLoading ? 'Creating...' : !walletAddress ? 'Connect Wallet' : 'Create Pool'}
                  </button>
                  <div className="mt-6 p-4 bg-[#0d1117] rounded-xl border border-dashed border-[#30363d]">
                    <p className="text-sm text-[#f0883e] mb-3">🔧 Dev Tools - Mint Test Tokens</p>
                    <div className="flex gap-2 mb-3">
                      <input type="text" value={mintTokenName} onChange={(e) => setMintTokenName(e.target.value.toLowerCase())} placeholder="token name" className="flex-1 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-white text-sm placeholder-[#484f58]" />
                      <input type="text" value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} placeholder="amount" className="w-28 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-white text-sm" />
                    </div>
                    <button onClick={async () => { if (!walletAddress || !mintTokenName) return; setActionLoading(true); try { const result = await adenaMintTokens({ caller: walletAddress, baseName: mintTokenName, amount: BigInt(mintAmount) }); if (result.code === 0) { alert(`Minted! Token: /gno.land/r/dev/gnomo:${mintTokenName}`); setMintTokenName(''); await onRefresh() } else if (result.code !== 4001 && result.code !== 4000) { alert(`Failed: ${result.message}`) } } catch (e) { console.error(e) } finally { setActionLoading(false) } }} disabled={!walletAddress || !mintTokenName || actionLoading} className="w-full py-2 rounded-lg text-sm font-medium bg-[#f0883e] hover:bg-[#d97706] text-white disabled:bg-[#21262d] disabled:text-[#8b949e] disabled:cursor-not-allowed transition">Mint Tokens</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'clmm' && (
          <div className="max-w-lg mx-auto">
            <div className="bg-[#161b22] rounded-2xl border border-[#30363d] p-4">
              <div className="flex gap-2 mb-6">
                {(['pools', 'positions', 'create', 'mint'] as const).map((tab) => (
                  <button key={tab} onClick={() => setClmmTab(tab)} className={`px-4 py-2 rounded-lg font-medium transition capitalize ${clmmTab === tab ? 'bg-[#238636] text-white' : 'text-[#8b949e] hover:text-white hover:bg-[#21262d]'}`}>{tab === 'mint' ? 'New Position' : tab}</button>
                ))}
              </div>

              {clmmTab === 'pools' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">CLMM Pools (Concentrated Liquidity)</h3>
                  {clmmPools.length === 0 ? <div className="text-center py-8 text-[#8b949e]">No CLMM pools yet. Create one!</div> : clmmPools.map((pool) => (
                    <div key={pool.id} className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d]">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2"><TokenIcon token={formatCLMMDenom(pool.denomA)} /><TokenIcon token={formatCLMMDenom(pool.denomB)} /></div>
                          <span className="font-semibold">{formatCLMMDenom(pool.denomA)}/{formatCLMMDenom(pool.denomB)}</span>
                        </div>
                        <span className="text-xs bg-[#21262d] px-2 py-1 rounded-full text-[#8b949e]">{(pool.feeBPS / 100).toFixed(2)}% fee</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div><p className="text-[#8b949e]">Current Price</p><p className="font-medium">{formatPriceX6(pool.priceX6)}</p></div>
                        <div><p className="text-[#8b949e]">Current Tick</p><p className="font-medium">{pool.currentTick}</p></div>
                        <div><p className="text-[#8b949e]">Active Liquidity</p><p className="font-medium">{pool.liquidity.toString()}</p></div>
                        <div><p className="text-[#8b949e]">Tick Spacing</p><p className="font-medium">{pool.tickSpacing}</p></div>
                      </div>
                      <button onClick={() => { setSelectedClmmPool(pool); setClmmTab('mint') }} className="w-full mt-3 py-2 rounded-lg text-sm font-medium bg-[#238636] hover:bg-[#2ea043] text-white transition">Add Position</button>
                    </div>
                  ))}
                </div>
              )}

              {clmmTab === 'positions' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Your CLMM Positions</h3>
                  {!walletAddress ? <div className="text-center py-8 text-[#8b949e]">Connect wallet to view positions</div> : clmmPositions.length === 0 ? <div className="text-center py-8 text-[#8b949e]">No positions yet</div> : clmmPositions.map((pos) => {
                    const pool = clmmPools.find(p => p.id === pos.poolId)
                    if (!pool) return null
                    const inRange = pool.currentTick >= pos.tickLower && pool.currentTick < pos.tickUpper
                    // Calculate token amounts from liquidity and price range
                    const pL = tickToPrice(pos.tickLower)
                    const pU = tickToPrice(pos.tickUpper)
                    const pC = Number(pool.priceX6) / 1_000_000
                    const liq = Number(pos.liquidity)
                    let amountA = 0, amountB = 0
                    if (pC <= pL) {
                      // All in token A
                      amountA = liq * (pU - pL) / (pL * pU)
                    } else if (pC >= pU) {
                      // All in token B
                      amountB = liq * (pU - pL)
                    } else {
                      // Split
                      amountA = liq * (pU - pC) / (pC * pU)
                      amountB = liq * (pC - pL)
                    }
                    return (
                      <div key={pos.id} className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d]">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-2"><TokenIcon token={formatCLMMDenom(pool.denomA)} /><TokenIcon token={formatCLMMDenom(pool.denomB)} /></div>
                            <span className="font-semibold">{formatCLMMDenom(pool.denomA)}/{formatCLMMDenom(pool.denomB)}</span>
                            <span className="text-xs bg-[#21262d] px-2 py-1 rounded-full text-[#8b949e]">{(pool.feeBPS / 100).toFixed(2)}% fee</span>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full ${inRange ? 'bg-[#238636] text-white' : 'bg-[#f85149] text-white'}`}>{inRange ? 'In Range' : 'Out of Range'}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div><p className="text-[#8b949e]">Tick Range</p><p className="font-medium">{pos.tickLower} → {pos.tickUpper}</p></div>
                          <div><p className="text-[#8b949e]">Liquidity</p><p className="font-medium">{pos.liquidity.toString()}</p></div>
                          <div><p className="text-[#8b949e]">Min Price</p><p className="font-medium">{tickToPrice(pos.tickLower).toFixed(4)}</p></div>
                          <div><p className="text-[#8b949e]">Max Price</p><p className="font-medium">{tickToPrice(pos.tickUpper).toFixed(4)}</p></div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-[#21262d] grid grid-cols-2 gap-4 text-sm">
                          <div><p className="text-[#8b949e]">{formatCLMMDenom(pool.denomA)} Amount</p><p className="font-medium text-[#238636]">{amountA > 0 ? (amountA / 1_000_000).toFixed(4) : '0'}</p></div>
                          <div><p className="text-[#8b949e]">{formatCLMMDenom(pool.denomB)} Amount</p><p className="font-medium text-[#238636]">{amountB > 0 ? (amountB / 1_000_000).toFixed(4) : '0'}</p></div>
                        </div>
                        <div className="mt-2 p-2 bg-[#21262d] rounded-lg text-sm">
                          <div className="flex justify-between">
                            <span className="text-[#8b949e]">Position Value</span>
                            <span className="font-medium text-[#238636]">
                              {/* Show value in USDC - denomA is USDC since it's sorted first */}
                              ~{((amountA / 1_000_000) + (amountB / 1_000_000) / pC).toFixed(2)} {formatCLMMDenom(pool.denomA)}
                            </span>
                          </div>
                        </div>
                        <button onClick={() => handleBurnPosition(pos.id)} disabled={clmmLoading} className="w-full mt-3 py-2 rounded-lg text-sm font-medium bg-[#f85149] hover:bg-[#da3633] text-white transition disabled:opacity-50">{clmmLoading ? 'Closing...' : 'Close Position'}</button>
                      </div>
                    )
                  })}
                </div>
              )}

              {clmmTab === 'create' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Create CLMM Pool</h3>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Token A (Base)</label><input type="text" value={newClmmTokenA} onChange={(e) => setNewClmmTokenA(e.target.value)} placeholder="ugnot" className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-3 text-white" /></div>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Token B (Quote)</label><input type="text" value={newClmmTokenB} onChange={(e) => setNewClmmTokenB(e.target.value)} placeholder="/gno.land/r/dev/gnomo:usdc" className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-3 text-white" /></div>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Fee Tier</label><div className="grid grid-cols-3 gap-2">{[5, 30, 100].map((fee) => <button key={fee} onClick={() => setNewClmmFee(fee)} className={`py-3 rounded-xl text-sm font-medium transition ${newClmmFee === fee ? 'bg-[#238636] text-white' : 'bg-[#0d1117] text-[#8b949e] hover:text-white border border-[#30363d]'}`}>{(fee / 100).toFixed(2)}%</button>)}</div></div>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Initial Price (B per A)</label><input type="text" value={newClmmInitialPrice} onChange={(e) => setNewClmmInitialPrice(e.target.value)} placeholder="1.0" className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-3 text-white" /></div>
                  <button onClick={handleCreateClmmPool} disabled={!walletAddress || !newClmmTokenB || clmmLoading} className={`w-full py-4 rounded-xl font-semibold text-lg transition ${walletAddress && newClmmTokenB && !clmmLoading ? 'bg-[#238636] hover:bg-[#2ea043] text-white' : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'}`}>{clmmLoading ? 'Creating...' : 'Create CLMM Pool'}</button>
                </div>
              )}

              {clmmTab === 'mint' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">New Position</h3>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Select Pool</label><select value={selectedClmmPool?.id ?? ''} onChange={(e) => setSelectedClmmPool(clmmPools.find(p => p.id === parseInt(e.target.value)) || null)} className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-3 text-white"><option value="">Select a pool</option>{clmmPools.map((pool) => <option key={pool.id} value={pool.id}>{formatCLMMDenom(pool.denomA)}/{formatCLMMDenom(pool.denomB)} ({(pool.feeBPS / 100).toFixed(2)}%)</option>)}</select></div>
                  {selectedClmmPool && (
                    <>
                      <div className="p-3 bg-[#0d1117] rounded-xl text-sm">
                        <div className="flex justify-between text-[#8b949e]"><span>Current Price</span><span>{formatPriceX6(selectedClmmPool.priceX6)} {formatCLMMDenom(selectedClmmPool.denomB)}/{formatCLMMDenom(selectedClmmPool.denomA)}</span></div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-[#0d1117] rounded-xl p-3">
                          <label className="text-sm text-[#8b949e] block mb-2">Min Price</label>
                          <input type="text" value={mintPriceLower} onChange={(e) => { setMintPriceLower(e.target.value); const p = parseFloat(e.target.value); if (p > 0) { const tick = priceToTick(p); const aligned = Math.round(tick / selectedClmmPool.tickSpacing) * selectedClmmPool.tickSpacing; setMintTickLower(aligned) } }} placeholder="0.01" className="w-full bg-transparent text-xl font-medium outline-none" />
                          <input type="range" min={-1000} max={0} step={selectedClmmPool.tickSpacing} value={mintTickLower} onChange={(e) => { const tick = parseInt(e.target.value); setMintTickLower(tick); setMintPriceLower(tickToPrice(tick).toFixed(4)) }} className="w-full mt-2" />
                          <span className="text-xs text-[#484f58]">tick {mintTickLower}</span>
                        </div>
                        <div className="bg-[#0d1117] rounded-xl p-3">
                          <label className="text-sm text-[#8b949e] block mb-2">Max Price</label>
                          <input type="text" value={mintPriceUpper} onChange={(e) => { setMintPriceUpper(e.target.value); const p = parseFloat(e.target.value); if (p > 0) { const tick = priceToTick(p); const aligned = Math.round(tick / selectedClmmPool.tickSpacing) * selectedClmmPool.tickSpacing; setMintTickUpper(aligned) } }} placeholder="100" className="w-full bg-transparent text-xl font-medium outline-none" />
                          <input type="range" min={0} max={1000} step={selectedClmmPool.tickSpacing} value={mintTickUpper} onChange={(e) => { const tick = parseInt(e.target.value); setMintTickUpper(tick); setMintPriceUpper(tickToPrice(tick).toFixed(4)) }} className="w-full mt-2" />
                          <span className="text-xs text-[#484f58]">tick {mintTickUpper}</span>
                        </div>
                      </div>
                      <div className="p-3 bg-[#0d1117] rounded-xl text-sm space-y-2">
                        <div className="flex justify-between text-[#8b949e]"><span>Price Range</span><span>{mintPriceLower} - {mintPriceUpper}</span></div>
                        <div className="text-xs text-[#484f58] border-t border-[#21262d] pt-2">
                          {(() => {
                            const currentPrice = Number(selectedClmmPool.priceX6) / 1_000_000
                            const pL = parseFloat(mintPriceLower) || 0
                            const pU = parseFloat(mintPriceUpper) || 0
                            if (pU <= currentPrice) return <span className="text-[#f0883e]">Range below current price: provide only {formatCLMMDenom(selectedClmmPool.denomA)}</span>
                            if (pL >= currentPrice) return <span className="text-[#f0883e]">Range above current price: provide only {formatCLMMDenom(selectedClmmPool.denomB)}</span>
                            return <span className="text-[#238636]">Range spans current price: provide both tokens</span>
                          })()}
                        </div>
                      </div>
                      {(() => {
                        const currentPrice = Number(selectedClmmPool.priceX6) / 1_000_000
                        const pL = parseFloat(mintPriceLower) || 0
                        const pU = parseFloat(mintPriceUpper) || 0

                        // Determine which tokens are needed based on range
                        let needsA = true, needsB = true
                        if (currentPrice <= pL) {
                          needsA = false // All in token B (above current price)
                        } else if (currentPrice >= pU) {
                          needsB = false // All in token A (below current price)
                        }

                        // Calculate ratio for splitting when in range
                        // Using simplified CLMM math: ratio of (current - lower) / (upper - lower)
                        const calcAmountB = (amtA: number) => {
                          if (!needsB) return 0
                          if (!needsA) return amtA // User entered in wrong field
                          if (pL <= 0 || pU <= pL || currentPrice <= 0) return 0
                          // For in-range: amountB = amountA * currentPrice * (currentPrice - pL) / (pU - currentPrice)
                          const sqrtPL = Math.sqrt(pL)
                          const sqrtPU = Math.sqrt(pU)
                          const sqrtPC = Math.sqrt(currentPrice)
                          // L = amtA * sqrtPC * sqrtPU / (sqrtPU - sqrtPC)
                          // amtB = L * (sqrtPC - sqrtPL)
                          if (sqrtPU <= sqrtPC) return 0
                          const L = amtA * sqrtPC * sqrtPU / (sqrtPU - sqrtPC)
                          return L * (sqrtPC - sqrtPL)
                        }

                        const calcAmountA = (amtB: number) => {
                          if (!needsA) return 0
                          if (!needsB) return amtB // User entered in wrong field
                          if (pL <= 0 || pU <= pL || currentPrice <= 0) return 0
                          const sqrtPL = Math.sqrt(pL)
                          const sqrtPU = Math.sqrt(pU)
                          const sqrtPC = Math.sqrt(currentPrice)
                          // L = amtB / (sqrtPC - sqrtPL)
                          // amtA = L * (sqrtPU - sqrtPC) / (sqrtPC * sqrtPU)
                          if (sqrtPC <= sqrtPL) return 0
                          const L = amtB / (sqrtPC - sqrtPL)
                          return L * (sqrtPU - sqrtPC) / (sqrtPC * sqrtPU)
                        }

                        return (
                          <>
                            <div className="bg-[#0d1117] rounded-xl p-4">
                              <div className="flex justify-between mb-2">
                                <span className="text-[#8b949e]">{formatCLMMDenom(selectedClmmPool.denomA)} {!needsA && <span className="text-xs text-[#f0883e]">(not needed)</span>}</span>
                                <span className="text-sm text-[#8b949e]">Balance: {formatBalance(selectedClmmPool.denomA)}</span>
                              </div>
                              <input
                                type="text"
                                value={mintAmountA}
                                onChange={(e) => {
                                  setMintAmountA(e.target.value)
                                  const amt = parseFloat(e.target.value)
                                  if (amt > 0 && needsA && needsB) {
                                    setMintAmountB(calcAmountB(amt).toFixed(6))
                                  } else if (!needsA) {
                                    setMintAmountA('0')
                                  }
                                }}
                                placeholder="0.00"
                                className={`w-full bg-transparent text-2xl font-medium outline-none ${!needsA ? 'text-[#484f58]' : ''}`}
                                disabled={!needsA}
                              />
                            </div>
                            <div className="bg-[#0d1117] rounded-xl p-4">
                              <div className="flex justify-between mb-2">
                                <span className="text-[#8b949e]">{formatCLMMDenom(selectedClmmPool.denomB)} {!needsB && <span className="text-xs text-[#f0883e]">(not needed)</span>}</span>
                                <span className="text-sm text-[#8b949e]">Balance: {formatBalance(selectedClmmPool.denomB)}</span>
                              </div>
                              <input
                                type="text"
                                value={mintAmountB}
                                onChange={(e) => {
                                  setMintAmountB(e.target.value)
                                  const amt = parseFloat(e.target.value)
                                  if (amt > 0 && needsA && needsB) {
                                    setMintAmountA(calcAmountA(amt).toFixed(6))
                                  } else if (!needsB) {
                                    setMintAmountB('0')
                                  }
                                }}
                                placeholder="0.00"
                                className={`w-full bg-transparent text-2xl font-medium outline-none ${!needsB ? 'text-[#484f58]' : ''}`}
                                disabled={!needsB}
                              />
                            </div>
                            {(parseFloat(mintAmountA) > 0 || parseFloat(mintAmountB) > 0) && (
                              <div className="p-3 bg-[#21262d] rounded-xl text-sm">
                                <div className="flex justify-between">
                                  <span className="text-[#8b949e]">Position Value</span>
                                  <span className="font-medium text-[#238636]">
                                    ~{((parseFloat(mintAmountA) || 0) + (parseFloat(mintAmountB) || 0) / currentPrice).toFixed(2)} {formatCLMMDenom(selectedClmmPool.denomA)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </>
                        )
                      })()}
                    </>
                  )}
                  <button onClick={handleMintPosition} disabled={!walletAddress || !selectedClmmPool || !mintAmountA || !mintAmountB || clmmLoading} className={`w-full py-4 rounded-xl font-semibold text-lg transition ${walletAddress && selectedClmmPool && mintAmountA && mintAmountB && !clmmLoading ? 'bg-[#238636] hover:bg-[#2ea043] text-white' : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'}`}>{clmmLoading ? 'Creating Position...' : 'Create Position'}</button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-3 gap-4 max-w-2xl mx-auto">
          <StatCard title="Total Value Locked" value={totalTVL > 0 ? fmtAmt(BigInt(Math.floor(totalTVL))) : '0'} />
          <StatCard title="24h Volume" value="--" />
          <StatCard title="Total Pools" value={(pools.length + clmmPools.length).toString()} />
        </div>
      </main>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return <div className="bg-[#161b22] rounded-xl p-4 border border-[#30363d]"><p className="text-[#8b949e] text-sm">{title}</p><p className="text-xl font-semibold mt-1">{value}</p></div>
}

function TokenIcon({ token, className = '' }: { token: string; className?: string }) {
  const colors: Record<string, string> = { GNOT: '#238636', USDC: '#2775ca', GNS: '#ff6b6b', ATOM: '#6f7390' }
  return <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 border-[#0d1117] ${className}`} style={{ backgroundColor: colors[token] || '#8b949e' }}>{token?.[0] || '?'}</div>
}

function SettingsIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg> }
function SwapIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16" /></svg> }
function PlusIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg> }
