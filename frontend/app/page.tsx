'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAllPools, getQuote, formatDenom, PoolInfo, getLPBalance } from '@/lib/gno'
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
  collectCLMMFees,
  PKG_PATH,
} from '@/lib/adena'
import {
  getAllCLMMPools,
  getPositionsByOwner,
  getPosition,
  getCLMMQuote,
  getPositionFees,
  CLMMPool,
  CLMMPosition,
  formatCLMMDenom,
  formatPriceX6,
  tickToPrice,
  priceToTick,
} from '@/lib/clmm'
import {
  useToast,
  ConfirmModal,
  PoolCardSkeleton,
  PositionCardSkeleton,
  Tooltip,
  HelpTooltip,
  CLMM_TOOLTIPS,
  NoPoolsEmpty,
  NoPositionsEmpty,
  WalletNotConnectedEmpty,
  PriceChart,
  Sparkline,
  PriceChange,
} from '@/components'
import { parseContractError, isUserRejection } from '@/lib/errors'
import {
  recordPrice,
  getPriceHistory,
  getPriceStats,
  formatPairName,
  PricePoint,
} from '@/lib/priceHistory'

type BestQuoteResult = {
  pool: PoolInfo | null
  clmmPool: CLMMPool | null
  poolType: 'v2' | 'clmm'
  amountOut: bigint
  tokenIn: 'A' | 'B'
}

// Helper to format token amounts with 6 decimals and commas
function fmtAmt(amount: bigint, maxDecimals = 6): string {
  const num = Number(amount) / 1_000_000
  if (num === 0) return '0'
  if (num < 0.000001) return '<0.000001'

  // Use Intl for proper comma formatting
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(num)

  return formatted
}

// Format with $ sign for USD values
function fmtUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

// Helper to calculate simple price ratio
function calcPrice(reserveA: bigint, reserveB: bigint): string {
  if (reserveA === 0n) return '0.0000'
  const price = Number(reserveB) / Number(reserveA)
  return price.toFixed(4)
}

export default function Home() {
  const toast = useToast()

  const [activeTab, setActiveTab] = useState<'swap' | 'pool' | 'clmm'>('swap')
  const [pools, setPools] = useState<PoolInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [swapLoading, setSwapLoading] = useState(false)

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    title: string
    description?: string
    details?: { label: string; value: string }[]
    confirmText?: string
    confirmVariant?: 'primary' | 'danger'
    onConfirm: () => Promise<void>
  }>({
    isOpen: false,
    title: '',
    onConfirm: async () => {},
  })
  
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
  const [showGettingStarted, setShowGettingStarted] = useState(true)

  const [clmmPools, setClmmPools] = useState<CLMMPool[]>([])
  const [clmmPositions, setClmmPositions] = useState<CLMMPosition[]>([])
  const [positionFees, setPositionFees] = useState<Map<number, { feesA: bigint; feesB: bigint }>>(new Map())
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

  // Price chart state
  const [selectedChartPair, setSelectedChartPair] = useState<string | null>(null)
  const [priceHistoryData, setPriceHistoryData] = useState<Map<string, PricePoint[]>>(new Map())

  // Load price history on mount and when pools change
  useEffect(() => {
    const allPairs = [
      ...pools.map(p => formatPairName(p.denomA, p.denomB)),
      ...clmmPools.map(p => formatPairName(p.denomA, p.denomB)),
    ]
    const uniquePairs = [...new Set(allPairs)]

    const historyMap = new Map<string, PricePoint[]>()
    for (const pair of uniquePairs) {
      const history = getPriceHistory(pair)
      if (history.length > 0) {
        historyMap.set(pair, history)
      }
    }
    setPriceHistoryData(historyMap)

    // Auto-select first pair with history
    if (!selectedChartPair && historyMap.size > 0) {
      setSelectedChartPair([...historyMap.keys()][0])
    }
  }, [pools, clmmPools, selectedChartPair])

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
        setPositionFees(new Map())
        return
      }
      try {
        const positionIds = await getPositionsByOwner(walletAddress)
        const positions: CLMMPosition[] = []
        const fees = new Map<number, { feesA: bigint; feesB: bigint }>()
        for (const id of positionIds) {
          const pos = await getPosition(id)
          if (pos && pos.liquidity > 0n) {
            positions.push(pos)
            // Fetch fees for each position
            try {
              const positionFees = await getPositionFees(id)
              fees.set(id, positionFees)
            } catch (e) {
              fees.set(id, { feesA: 0n, feesB: 0n })
            }
          }
        }
        setClmmPositions(positions)
        setPositionFees(fees)
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
          // Sanity check: contract GetQuote returns theoretical values that can't execute
          // Using liquidity/4 as very conservative max - the contract is severely broken
          const maxOutput = clmmPool.liquidity / 4n
          if (quote > 0n && quote <= maxOutput && (!best || quote > best.amountOut)) {
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
    const loadingToast = toast.loading('Confirming Swap', 'Please confirm in your wallet...')
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
        toast.update(loadingToast, 'success', 'Swap Successful', `${fromAmount} ${formatDenom(fromToken)} → ${toAmount} ${formatDenom(toToken)}`)
        setFromAmount('')
        setToAmount('')
        setBestQuote(null)
        // Quick refresh for balance update
        await new Promise(r => setTimeout(r, 1500))
        await onRefresh()
        setTimeout(() => onRefresh(), 2500)
      } else if (result.code === 4001 || result.code === 4000) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Swap Failed', parseContractError(result))
      }
    } catch (error) {
      console.error('Swap error:', error)
      if (isUserRejection(error)) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Swap Failed', parseContractError(error))
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

  // Auto-select first token when balances load
  useEffect(() => {
    if (balances.size > 0) {
      const tokens = Array.from(balances.keys())
      // Prefer ugnot as Token A if available
      const defaultA = tokens.find(t => t === 'ugnot') || tokens[0]
      if (!tokens.includes(newTokenA)) setNewTokenA(defaultA)
      if (!tokens.includes(newClmmTokenA)) setNewClmmTokenA(defaultA)
    }
  }, [balances])

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

      // Record prices for charts
      for (const pool of poolData) {
        if (pool.reserveA > 0n && pool.reserveB > 0n) {
          const price = Number(pool.reserveB) / Number(pool.reserveA)
          const pairName = formatPairName(pool.denomA, pool.denomB)
          recordPrice(pairName, price)
        }
      }
      for (const pool of clmmData) {
        if (pool.priceX6 > 0n) {
          const price = Number(pool.priceX6) / 1_000_000
          const pairName = formatPairName(pool.denomA, pool.denomB)
          recordPrice(pairName, price)
        }
      }
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
        const fees = new Map<number, { feesA: bigint; feesB: bigint }>()
        for (const id of positionIds) {
          const pos = await getPosition(id)
          if (pos && pos.liquidity > 0n) {
            positions.push(pos)
            try {
              const posFees = await getPositionFees(id)
              fees.set(id, posFees)
            } catch (e) {
              fees.set(id, { feesA: 0n, feesB: 0n })
            }
          }
        }
        setClmmPositions(positions)
        setPositionFees(fees)
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
    const loadingToast = toast.loading('Adding Liquidity', 'Please confirm in your wallet...')
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
        toast.update(loadingToast, 'success', 'Liquidity Added', `Added ${amountA} ${formatDenom(selectedPool.denomA)} and ${amountB} ${formatDenom(selectedPool.denomB)}`)
        setAmountA('')
        setAmountB('')
        await new Promise(r => setTimeout(r, 1500))
        await onRefresh()
        setTimeout(() => onRefresh(), 2500)
      } else if (result.code === 4001 || result.code === 4000) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Add Liquidity Failed', parseContractError(result))
      }
    } catch (error) {
      console.error('Add liquidity error:', error)
      if (isUserRejection(error)) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Add Liquidity Failed', parseContractError(error))
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleRemoveLiquidity = async () => {
    if (!walletAddress || !selectedPool || !lpAmount) return
    setActionLoading(true)
    const loadingToast = toast.loading('Removing Liquidity', 'Please confirm in your wallet...')
    try {
      const lpAmt = BigInt(Math.floor(parseFloat(lpAmount) * 1_000_000))
      const result = await adenaRemoveLiquidity({
        caller: walletAddress,
        poolId: selectedPool.id,
        lpAmount: lpAmt,
      })
      if (result.code === 0) {
        toast.update(loadingToast, 'success', 'Liquidity Removed', 'Your tokens have been returned to your wallet')
        setLpAmount('')
        setSelectedPercent(null)
        await new Promise(r => setTimeout(r, 1500))
        await onRefresh()
        setTimeout(() => onRefresh(), 2500)
      } else if (result.code === 4001 || result.code === 4000) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Remove Liquidity Failed', parseContractError(result))
      }
    } catch (error) {
      console.error('Remove liquidity error:', error)
      if (isUserRejection(error)) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Remove Liquidity Failed', parseContractError(error))
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleCreateClmmPool = async () => {
    if (!walletAddress || !newClmmTokenB) return
    setClmmLoading(true)
    const loadingToast = toast.loading('Creating Pool', 'Please confirm in your wallet...')
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
        toast.update(loadingToast, 'success', 'CLMM Pool Created', 'Now add a position to start earning fees')
        setNewClmmTokenB('')
        setNewClmmInitialPrice('1')
        setClmmTab('pools')
        // Delay to allow chain to commit, then refresh twice to catch slow indexing
        await new Promise(r => setTimeout(r, 2000))
        await onRefresh()
        // Second refresh after additional delay for slow indexing
        setTimeout(() => onRefresh(), 3000)
      } else if (result.code === 4001 || result.code === 4000) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Create Pool Failed', parseContractError(result))
      }
    } catch (error) {
      console.error('Create CLMM pool error:', error)
      if (isUserRejection(error)) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Create Pool Failed', parseContractError(error))
      }
    } finally {
      setClmmLoading(false)
    }
  }

  const handleMintPosition = async () => {
    if (!walletAddress || !selectedClmmPool || !mintAmountA || !mintAmountB) return
    setClmmLoading(true)
    const loadingToast = toast.loading('Creating Position', 'Please confirm in your wallet...')
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
        toast.update(loadingToast, 'success', 'Position Created', `Range: ${mintPriceLower} - ${mintPriceUpper}`)
        setMintAmountA('')
        setMintAmountB('')
        setClmmTab('positions')
        await new Promise(r => setTimeout(r, 1500))
        await onRefresh()
        setTimeout(() => onRefresh(), 2500)
      } else if (result.code === 4001 || result.code === 4000) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Create Position Failed', parseContractError(result))
      }
    } catch (error) {
      console.error('Mint position error:', error)
      if (isUserRejection(error)) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Create Position Failed', parseContractError(error))
      }
    } finally {
      setClmmLoading(false)
    }
  }

  const handleBurnPosition = async (positionId: number) => {
    if (!walletAddress) return
    setClmmLoading(true)
    const loadingToast = toast.loading('Closing Position', 'Please confirm in your wallet...')
    try {
      const result = await burnCLMMPosition({
        caller: walletAddress,
        positionId,
      })
      if (result.code === 0) {
        toast.update(loadingToast, 'success', 'Position Closed', 'Liquidity returned to your wallet')
        await new Promise(r => setTimeout(r, 1500))
        await onRefresh()
        setTimeout(() => onRefresh(), 2500)
      } else if (result.code === 4001 || result.code === 4000) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Close Position Failed', parseContractError(result))
      }
    } catch (error) {
      console.error('Burn position error:', error)
      if (isUserRejection(error)) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Close Position Failed', parseContractError(error))
      }
    } finally {
      setClmmLoading(false)
    }
  }

  const handleCollectFees = async (positionId: number) => {
    if (!walletAddress) return
    setClmmLoading(true)
    const loadingToast = toast.loading('Collecting Fees', 'Please confirm in your wallet...')
    try {
      const result = await collectCLMMFees({
        caller: walletAddress,
        positionId,
      })
      if (result.code === 0) {
        toast.update(loadingToast, 'success', 'Fees Collected', 'Trading fees sent to your wallet')
        await new Promise(r => setTimeout(r, 1500))
        await onRefresh()
        setTimeout(() => onRefresh(), 2500)
      } else if (result.code === 4001 || result.code === 4000) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Collect Fees Failed', parseContractError(result))
      }
    } catch (error) {
      console.error('Collect fees error:', error)
      if (isUserRejection(error)) {
        toast.dismiss(loadingToast)
      } else {
        toast.update(loadingToast, 'error', 'Collect Fees Failed', parseContractError(error))
      }
    } finally {
      setClmmLoading(false)
    }
  }

  const rpcStatus = pools.length > 0 || !loading

  // Calculate total TVL across V2 and CLMM pools in USD
  // Assuming GNOT = $1 for simplicity (or use actual price feed)
  const GNOT_PRICE_USD = 1 // Could be fetched from oracle
  const v2TvlUsd = pools.reduce((sum, pool) => {
    // For V2 pools, TVL = 2 * reserveA (assuming A is the base token valued at $1)
    // Or if denomA is ugnot, use that as the value anchor
    const reserveAUsd = Number(pool.reserveA) / 1_000_000 * GNOT_PRICE_USD
    const reserveBUsd = Number(pool.reserveB) / 1_000_000 * GNOT_PRICE_USD
    return sum + reserveAUsd + reserveBUsd
  }, 0)

  // For CLMM, estimate TVL from liquidity (simplified - would need actual position data for accuracy)
  const clmmTvlUsd = clmmPools.reduce((sum, pool) => {
    // Rough estimate: liquidity value = liquidity / 1e6 * 2 (both tokens)
    const liqValue = Number(pool.liquidity) / 1_000_000 * 2 * GNOT_PRICE_USD
    return sum + liqValue
  }, 0)

  const totalTVL = v2TvlUsd + clmmTvlUsd

  // Helper for fee display - PoolInfo uses feeBps (number)
  const fmtFee = (feeBps: number) => feeBps < 100 ? (feeBps / 100).toFixed(2) : (feeBps / 100).toFixed(1)

  return (
    <div className="min-h-screen bg-[#0d1117]">
      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={async () => {
          await confirmModal.onConfirm()
          setConfirmModal(prev => ({ ...prev, isOpen: false }))
        }}
        title={confirmModal.title}
        description={confirmModal.description}
        details={confirmModal.details}
        confirmText={confirmModal.confirmText}
        confirmVariant={confirmModal.confirmVariant}
        loading={swapLoading || actionLoading || clmmLoading}
      />

      <header className="border-b border-[#21262d] bg-[#161b22]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold text-[#238636]">Gnomo DEX <span className="text-xs font-normal text-[#8b949e]">v0.3.0</span></h1>
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

      {/* Getting Started Guide - Testnet */}
      {showGettingStarted && (
        <div className="bg-gradient-to-r from-[#238636]/20 to-[#58a6ff]/20 border-b border-[#30363d]">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🚀</span>
                  <h3 className="font-semibold text-white">Welcome to Gnomo DEX (Testnet)</h3>
                  <span className="text-xs bg-[#238636] px-2 py-0.5 rounded-full">Beta</span>
                </div>
                <div className="grid md:grid-cols-4 gap-4 text-sm">
                  <div className="bg-[#0d1117]/50 rounded-lg p-3">
                    <div className="font-medium text-[#58a6ff] mb-1">Step 1: Wallet</div>
                    <p className="text-[#8b949e]">Install <a href="https://adena.app" target="_blank" rel="noopener" className="text-[#58a6ff] hover:underline">Adena Wallet</a> and create an account</p>
                  </div>
                  <div className="bg-[#0d1117]/50 rounded-lg p-3">
                    <div className="font-medium text-[#58a6ff] mb-1">Step 2: Network</div>
                    <p className="text-[#8b949e]">Connect wallet - it will auto-add the Staging network</p>
                  </div>
                  <div className="bg-[#0d1117]/50 rounded-lg p-3">
                    <div className="font-medium text-[#58a6ff] mb-1">Step 3: Get GNOT</div>
                    <p className="text-[#8b949e]">Get test GNOT from <a href="https://faucet.gno.land" target="_blank" rel="noopener" className="text-[#58a6ff] hover:underline">faucet.gno.land</a> → Staging</p>
                  </div>
                  <div className="bg-[#0d1117]/50 rounded-lg p-3">
                    <div className="font-medium text-[#58a6ff] mb-1">Step 4: Mint Tokens</div>
                    <p className="text-[#8b949e]">Go to Pool → Create tab and click "Mint Test Tokens"</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowGettingStarted(false)}
                className="text-[#8b949e] hover:text-white p-1 hover:bg-[#21262d] rounded transition"
                title="Dismiss"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-sm text-[#8b949e]">Slippage Tolerance</label>
                    <HelpTooltip content={CLMM_TOOLTIPS.slippage} />
                  </div>
                  <div className="flex gap-2">
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
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#8b949e]">Balance: {fromToken ? formatBalance(fromToken) : '0'}</span>
                    {fromToken && getBalance(fromToken) > 0n && (
                      <button
                        onClick={() => setFromAmount((Number(getBalance(fromToken)) / 1_000_000).toString())}
                        className="px-2 py-0.5 text-xs font-medium bg-[#238636]/20 text-[#238636] rounded hover:bg-[#238636]/30 transition"
                      >
                        MAX
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="text" value={fromAmount} onChange={(e) => setFromAmount(e.target.value)} placeholder="0.00" className="w-full bg-transparent text-3xl font-medium outline-none" />
                  {/* Quick percentage buttons */}
                  {fromToken && getBalance(fromToken) > 0n && (
                    <div className="flex gap-1">
                      {[25, 50, 75].map(pct => (
                        <button
                          key={pct}
                          onClick={() => setFromAmount(((Number(getBalance(fromToken)) / 1_000_000) * pct / 100).toFixed(6))}
                          className="px-1.5 py-0.5 text-xs text-[#8b949e] hover:text-white bg-[#21262d] hover:bg-[#30363d] rounded transition"
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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

              {bestQuote && fromAmount && toAmount && (() => {
                const inputAmt = parseFloat(fromAmount.replace(/,/g, ''))
                const outputAmt = parseFloat(toAmount.replace(/,/g, ''))
                if (inputAmt <= 0 || outputAmt <= 0) return null

                // Get fee info
                const feeBps = bestQuote.poolType === 'v2' && bestQuote.pool
                  ? bestQuote.pool.feeBps
                  : bestQuote.clmmPool?.feeBPS || 0
                const feePercent = feeBps / 100
                const tradingFee = inputAmt * feeBps / 10000

                // Calculate minimum received based on slippage tolerance
                const minReceived = outputAmt * (1 - slippageBps / 10000)

                // Calculate TRUE price impact (excluding fee)
                let priceImpact = 0

                if (bestQuote.poolType === 'v2' && bestQuote.pool) {
                  const pool = bestQuote.pool
                  // For V2: use AMM formula but subtract fee contribution
                  const reserveIn = bestQuote.tokenIn === 'A'
                    ? Number(pool.reserveA) / 1_000_000
                    : Number(pool.reserveB) / 1_000_000

                  if (reserveIn > 0) {
                    // AMM slippage only (fee is shown separately)
                    priceImpact = (inputAmt / (2 * reserveIn)) * 100
                  }
                } else if (bestQuote.poolType === 'clmm' && bestQuote.clmmPool) {
                  // CLMM: compare execution to expected price
                  // priceX6 = price of token B in terms of token A (how much A per B)
                  const priceBA = Number(bestQuote.clmmPool.priceX6) / 1_000_000 // A per B
                  const execPrice = outputAmt / inputAmt
                  const feeMultiplier = 1 - feeBps / 10000

                  if (priceBA > 0) {
                    // tokenIn='B' means swapping B for A: execPrice = A_out/B_in, expected = priceBA
                    // tokenIn='A' means swapping A for B: execPrice = B_out/A_in, expected = 1/priceBA
                    const expectedPrice = bestQuote.tokenIn === 'B' ? priceBA : 1 / priceBA
                    const expectedAfterFee = expectedPrice * feeMultiplier
                    priceImpact = Math.max(0, ((expectedAfterFee - execPrice) / expectedAfterFee) * 100)
                  }
                }

                const impactColor = priceImpact >= 5 ? 'text-[#f85149]' : priceImpact >= 1 ? 'text-[#f0883e]' : 'text-[#238636]'

                return (
                  <div className="mt-3 p-3 bg-[#0d1117] rounded-xl text-sm space-y-2">
                    {/* Rate */}
                    <div className="flex justify-between items-center pb-2 border-b border-[#21262d]">
                      <span className="text-[#8b949e]">1 {formatDenom(fromToken)} =</span>
                      <span className="font-medium">{(outputAmt / inputAmt).toFixed(6)} {formatDenom(toToken)}</span>
                    </div>

                    {/* Route */}
                    <div className="flex justify-between items-center">
                      <span className="text-[#8b949e] flex items-center gap-1">
                        Route
                        <HelpTooltip content="The liquidity pool used for this swap" position="right" />
                      </span>
                      <span className="font-medium">
                        {bestQuote.poolType === 'v2' && bestQuote.pool && (
                          <span className="text-[#238636]">V2 {fmtFee(bestQuote.pool.feeBps)}%</span>
                        )}
                        {bestQuote.poolType === 'clmm' && bestQuote.clmmPool && (
                          <span className="text-[#58a6ff]">CLMM {feePercent.toFixed(2)}%</span>
                        )}
                      </span>
                    </div>

                    {/* Trading Fee */}
                    <div className="flex justify-between items-center">
                      <span className="text-[#8b949e] flex items-center gap-1">
                        Trading Fee
                        <HelpTooltip content={`${feePercent.toFixed(2)}% fee paid to liquidity providers`} position="right" />
                      </span>
                      <span className="text-[#8b949e]">{tradingFee.toFixed(6)} {formatDenom(fromToken)} ({feePercent.toFixed(2)}%)</span>
                    </div>

                    {/* Price Impact */}
                    <div className="flex justify-between items-center">
                      <span className="text-[#8b949e] flex items-center gap-1">
                        Price Impact
                        <HelpTooltip content="The difference between market price and estimated execution price due to trade size" position="right" />
                      </span>
                      <span className={`font-medium ${impactColor}`}>
                        {priceImpact >= 5 && '⚠️ '}{priceImpact < 0.01 ? '<0.01' : priceImpact.toFixed(2)}%
                      </span>
                    </div>

                    {/* Minimum Received */}
                    <div className="flex justify-between items-center">
                      <span className="text-[#8b949e] flex items-center gap-1">
                        Min. Received
                        <HelpTooltip content={`Minimum amount you'll receive after ${(slippageBps / 100).toFixed(2)}% slippage tolerance`} position="right" />
                      </span>
                      <span className="text-[#8b949e]">{minReceived.toFixed(6)} {formatDenom(toToken)}</span>
                    </div>

                    {/* Slippage Tolerance */}
                    <div className="flex justify-between items-center pt-2 border-t border-[#21262d]">
                      <span className="text-[#8b949e] flex items-center gap-1">
                        Slippage Tolerance
                        <HelpTooltip content="Your transaction will revert if the price changes more than this percentage" position="right" />
                      </span>
                      <div className="flex items-center gap-1">
                        {[50, 100, 200].map(bps => (
                          <button
                            key={bps}
                            onClick={() => setSlippageBps(bps)}
                            className={`px-2 py-0.5 text-xs rounded transition ${slippageBps === bps ? 'bg-[#238636] text-white' : 'bg-[#21262d] text-[#8b949e] hover:text-white'}`}
                          >
                            {(bps / 100).toFixed(1)}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Network Fee */}
                    <div className="flex justify-between items-center">
                      <span className="text-[#8b949e] flex items-center gap-1">
                        Network Fee
                        <HelpTooltip content="Estimated gas fee for this transaction" position="right" />
                      </span>
                      <span className="text-[#8b949e]">~1 GNOT</span>
                    </div>
                  </div>
                )
              })()}

              {fromToken && toToken && !bestQuote && !quoteLoading && matchingPools.length === 0 && clmmPools.filter(p => (p.denomA === fromToken && p.denomB === toToken) || (p.denomB === fromToken && p.denomA === toToken)).length === 0 && (
                <div className="mt-3 p-3 bg-[#f8514926] border border-[#f85149] rounded-xl text-sm text-[#f85149]">
                  No pool available for {formatDenom(fromToken)}/{formatDenom(toToken)}
                </div>
              )}

              {(() => {
                const insufficientBalance = fromToken && fromAmount && parseFloat(fromAmount) > 0 &&
                  parseFloat(fromAmount) * 1_000_000 > Number(getBalance(fromToken))

                // Calculate price impact for liquidity check
                let priceImpactCheck = 0
                if (bestQuote && fromAmount && parseFloat(fromAmount) > 0) {
                  const inputAmt = parseFloat(fromAmount) * 1_000_000
                  if (bestQuote.poolType === 'v2' && bestQuote.pool) {
                    const reserveIn = bestQuote.tokenIn === 'A'
                      ? Number(bestQuote.pool.reserveA)
                      : Number(bestQuote.pool.reserveB)
                    if (reserveIn > 0) {
                      priceImpactCheck = (inputAmt / (2 * reserveIn)) * 100
                    }
                  } else if (bestQuote.poolType === 'clmm' && bestQuote.clmmPool) {
                    // priceX6 = price of token B in terms of token A (how much A per B)
                    const priceBA = Number(bestQuote.clmmPool.priceX6) / 1_000_000
                    const outputAmt = Number(bestQuote.amountOut)
                    if (inputAmt > 0 && priceBA > 0) {
                      const execPrice = outputAmt / inputAmt
                      // tokenIn='B': swapping B for A, expected = priceBA
                      // tokenIn='A': swapping A for B, expected = 1/priceBA
                      const expectedPrice = bestQuote.tokenIn === 'B' ? priceBA : 1 / priceBA
                      priceImpactCheck = Math.abs((expectedPrice - execPrice) / expectedPrice) * 100
                    }
                  }
                }

                // Check for insufficient liquidity - output is 0, price impact > 50%, or CLMM output exceeds pool capacity
                // Only check when quote is fresh (not loading)
                const clmmExceedsLiquidity = bestQuote?.poolType === 'clmm' && bestQuote.clmmPool &&
                  bestQuote.amountOut > bestQuote.clmmPool.liquidity / 4n
                const insufficientLiquidity = !quoteLoading && bestQuote && fromAmount && parseFloat(fromAmount) > 0 && (
                  bestQuote.amountOut === 0n || priceImpactCheck > 50 || clmmExceedsLiquidity
                )
                const canSwap = walletAddress && bestQuote && !swapLoading && !insufficientBalance && !insufficientLiquidity
                return (
                  <button
                    onClick={handleSwap}
                    disabled={!canSwap}
                    className={`w-full mt-4 py-4 rounded-xl font-semibold text-lg transition ${canSwap ? 'bg-[#238636] hover:bg-[#2ea043] text-white' : (insufficientBalance || insufficientLiquidity) ? 'bg-[#f8514926] text-[#f85149] border border-[#f85149] cursor-not-allowed' : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'}`}
                  >
                    {swapLoading ? <span className="flex items-center justify-center gap-2"><span className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full" />Swapping...</span> : insufficientBalance ? 'Insufficient Balance' : insufficientLiquidity ? 'Insufficient Liquidity' : !walletAddress ? 'Connect Wallet' : !fromToken || !toToken ? 'Select Tokens' : !fromAmount ? 'Enter Amount' : !bestQuote && !quoteLoading ? 'No Pool Available' : !bestQuote ? 'Finding Best Rate...' : 'Swap'}
                  </button>
                )
              })()}
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
                  {loading ? (
                    <>
                      <PoolCardSkeleton />
                      <PoolCardSkeleton />
                    </>
                  ) : pools.length === 0 ? (
                    <NoPoolsEmpty onCreate={() => setActivePoolTab('create')} />
                  ) : pools.map((pool) => {
                    const share = getUserPoolShare(pool.id, pool)
                    const value = getUserPoolValue(pool.id, pool)
                    return (
                      <div key={pool.id} className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d] card-hover">
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
                            <span className="font-medium text-[#238636]">~${((Number(pool.reserveA) + Number(pool.reserveB)) / 1_000_000).toFixed(2)}</span>
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

              {activePoolTab === 'add' && !selectedPool && (
                <div className="text-center py-8">
                  <p className="text-[#8b949e] mb-4">No V2 pools exist yet</p>
                  <button onClick={() => setActivePoolTab('create')} className="px-6 py-3 bg-[#238636] hover:bg-[#2ea043] text-white rounded-xl font-medium transition">
                    Create First Pool
                  </button>
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

              {activePoolTab === 'remove' && !selectedPool && (
                <div className="text-center py-8">
                  <p className="text-[#8b949e] mb-4">No V2 pools exist yet</p>
                  <button onClick={() => setActivePoolTab('create')} className="px-6 py-3 bg-[#238636] hover:bg-[#2ea043] text-white rounded-xl font-medium transition">
                    Create First Pool
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
                  <div>
                    <label className="text-sm text-[#8b949e] block mb-2">Token A (Base)</label>
                    <select value={newTokenA} onChange={(e) => setNewTokenA(e.target.value)} className="w-full bg-[#161b22] border border-[#30363d] rounded-xl px-3 py-3 text-white">
                      {Array.from(balances.entries()).map(([denom, amount]) => (
                        <option key={denom} value={denom}>{formatDenom(denom)} ({fmtAmt(amount)})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-[#8b949e] block mb-2">Token B (Quote)</label>
                    <select value={newTokenB} onChange={(e) => setNewTokenB(e.target.value)} className="w-full bg-[#161b22] border border-[#30363d] rounded-xl px-3 py-3 text-white">
                      <option value="">Select token...</option>
                      {Array.from(balances.entries()).filter(([denom]) => denom !== newTokenA).map(([denom, amount]) => (
                        <option key={denom} value={denom}>{formatDenom(denom)} ({fmtAmt(amount)})</option>
                      ))}
                    </select>
                  </div>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Fee Tier</label><div className="grid grid-cols-3 gap-2">{[5, 10, 30, 50, 100, 200].map((fee) => <button key={fee} onClick={() => setNewFeeBps(fee)} className={`py-3 rounded-xl text-sm font-medium transition ${newFeeBps === fee ? 'bg-[#238636] text-white' : 'bg-[#161b22] text-[#8b949e] hover:text-white border border-[#30363d]'}`}>{fmtFee(fee)}%</button>)}</div></div>
                  <button onClick={async () => { if (!walletAddress || !newTokenB) return; setActionLoading(true); const loadingToast = toast.loading('Creating Pool', 'Please confirm in your wallet...'); try { const result = await adenaCreatePool({ caller: walletAddress, denomA: newTokenA, denomB: newTokenB, feeBps: newFeeBps }); if (result.code === 0) { toast.update(loadingToast, 'success', 'Pool Created', `${formatDenom(newTokenA)}/${formatDenom(newTokenB)} pool ready for liquidity`); setNewTokenB(''); setActivePoolTab('add'); await new Promise(r => setTimeout(r, 2000)); await onRefresh(); setTimeout(() => onRefresh(), 3000) } else if (result.code === 4001 || result.code === 4000) { toast.dismiss(loadingToast) } else { toast.update(loadingToast, 'error', 'Create Pool Failed', parseContractError(result)) } } catch (e) { console.error(e); if (isUserRejection(e)) { toast.dismiss(loadingToast) } else { toast.update(loadingToast, 'error', 'Create Pool Failed', parseContractError(e)) } } finally { setActionLoading(false) } }} disabled={!walletAddress || !newTokenB || actionLoading} className={`w-full py-4 rounded-xl font-semibold text-lg transition ${walletAddress && newTokenB && !actionLoading ? 'bg-[#238636] hover:bg-[#2ea043] text-white' : 'bg-[#21262d] text-[#8b949e] cursor-not-allowed'}`}>
                    {actionLoading ? 'Creating...' : !walletAddress ? 'Connect Wallet' : 'Create Pool'}
                  </button>
                  <div className="mt-6 p-4 bg-[#0d1117] rounded-xl border border-dashed border-[#30363d]">
                    <p className="text-sm text-[#f0883e] mb-3">🔧 Dev Tools - Mint Test Tokens</p>
                    <div className="flex gap-2 mb-3">
                      <input type="text" value={mintTokenName} onChange={(e) => setMintTokenName(e.target.value.toLowerCase())} placeholder="token name" className="flex-1 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-white text-sm placeholder-[#484f58]" />
                      <input type="text" value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} placeholder="amount" className="w-28 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-white text-sm" />
                    </div>
                    <button onClick={async () => { if (!walletAddress || !mintTokenName) return; setActionLoading(true); const loadingToast = toast.loading('Minting Tokens', 'Please confirm in your wallet...'); try { const result = await adenaMintTokens({ caller: walletAddress, baseName: mintTokenName, amount: BigInt(mintAmount) }); if (result.code === 0) { toast.update(loadingToast, 'success', 'Tokens Minted', `Denom: /${PKG_PATH}:${mintTokenName}`); setMintTokenName(''); await new Promise(r => setTimeout(r, 1500)); await onRefresh(); setTimeout(() => onRefresh(), 2500) } else if (result.code === 4001 || result.code === 4000) { toast.dismiss(loadingToast) } else { toast.update(loadingToast, 'error', 'Mint Failed', parseContractError(result)) } } catch (e) { console.error(e); if (isUserRejection(e)) { toast.dismiss(loadingToast) } else { toast.update(loadingToast, 'error', 'Mint Failed', parseContractError(e)) } } finally { setActionLoading(false) } }} disabled={!walletAddress || !mintTokenName || actionLoading} className="w-full py-2 rounded-lg text-sm font-medium bg-[#f0883e] hover:bg-[#d97706] text-white disabled:bg-[#21262d] disabled:text-[#8b949e] disabled:cursor-not-allowed transition">Mint Tokens</button>
                    {walletAddress && balances.size > 0 && (
                      <div className="mt-3 pt-3 border-t border-[#30363d]">
                        <p className="text-xs text-[#8b949e] mb-2">Your Wallet Balances (click to copy denom):</p>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {Array.from(balances.entries()).map(([denom, amount]) => (
                            <div key={denom} className="flex justify-between text-xs hover:bg-[#21262d] px-1 py-0.5 rounded cursor-pointer" onClick={() => { navigator.clipboard.writeText(denom); toast.success('Copied', `Denom: ${denom}`) }}>
                              <span className="text-[#8b949e] truncate max-w-[200px]" title={denom}>{denom}</span>
                              <span className="text-white">{fmtAmt(amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">CLMM Pools</h3>
                    <HelpTooltip content={CLMM_TOOLTIPS.concentratedLiquidity} position="right" />
                  </div>
                  {loading ? (
                    <>
                      <PoolCardSkeleton />
                      <PoolCardSkeleton />
                    </>
                  ) : clmmPools.length === 0 ? (
                    <NoPoolsEmpty onCreate={() => setClmmTab('create')} />
                  ) : clmmPools.map((pool) => (
                    <div key={pool.id} className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d] card-hover">
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
                        <div><p className="text-[#8b949e]">Active Liquidity</p><p className="font-medium">{fmtAmt(pool.liquidity, 2)}</p></div>
                        <div><p className="text-[#8b949e]">Tick Spacing</p><p className="font-medium">{pool.tickSpacing}</p></div>
                      </div>
                      <div className="mt-2 p-2 bg-[#21262d] rounded-lg text-sm space-y-1">
                        {(() => {
                          // Estimate token amounts from liquidity and price
                          // For CLMM: tokenA ≈ L * sqrt(P), tokenB ≈ L / sqrt(P)
                          const price = Number(pool.priceX6) / 1_000_000
                          const sqrtPrice = Math.sqrt(price)
                          const liq = Number(pool.liquidity) / 1_000_000
                          const estTokenA = liq * sqrtPrice
                          const estTokenB = liq / sqrtPrice
                          return (
                            <>
                              <div className="flex justify-between text-xs">
                                <span className="text-[#8b949e]">Est. {formatDenom(pool.denomA)}</span>
                                <span>~{estTokenA.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-xs">
                                <span className="text-[#8b949e]">Est. {formatDenom(pool.denomB)}</span>
                                <span>~{estTokenB.toFixed(2)}</span>
                              </div>
                            </>
                          )
                        })()}
                        <div className="flex justify-between pt-1 border-t border-[#30363d]">
                          <span className="text-[#8b949e]">TVL</span>
                          <span className="font-medium text-[#238636]">~${(Number(pool.liquidity) / 1_000_000 * 2).toFixed(2)}</span>
                        </div>
                      </div>
                      <button onClick={() => { setSelectedClmmPool(pool); setClmmTab('mint') }} className="w-full mt-3 py-2 rounded-lg text-sm font-medium bg-[#238636] hover:bg-[#2ea043] text-white transition">Add Position</button>
                    </div>
                  ))}
                </div>
              )}

              {clmmTab === 'positions' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">Your Positions</h3>
                    <HelpTooltip content={CLMM_TOOLTIPS.priceRange} />
                  </div>
                  {!walletAddress ? (
                    <WalletNotConnectedEmpty onConnect={connectWallet} />
                  ) : clmmLoading && clmmPositions.length === 0 ? (
                    <>
                      <PositionCardSkeleton />
                      <PositionCardSkeleton />
                    </>
                  ) : clmmPositions.length === 0 ? (
                    <NoPositionsEmpty onAdd={() => setClmmTab('mint')} />
                  ) : clmmPositions.map((pos) => {
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
                      <div key={pos.id} className="p-4 bg-[#0d1117] rounded-xl border border-[#30363d] card-hover">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-2"><TokenIcon token={formatCLMMDenom(pool.denomA)} /><TokenIcon token={formatCLMMDenom(pool.denomB)} /></div>
                            <span className="font-semibold">{formatCLMMDenom(pool.denomA)}/{formatCLMMDenom(pool.denomB)}</span>
                            <span className="text-xs bg-[#21262d] px-2 py-1 rounded-full text-[#8b949e]">{(pool.feeBPS / 100).toFixed(2)}% fee</span>
                            <HelpTooltip content={CLMM_TOOLTIPS.feeTier} position="right" />
                          </div>
                          <Tooltip content={inRange ? CLMM_TOOLTIPS.inRange : CLMM_TOOLTIPS.outOfRange} position="left">
                            <span className={`text-xs px-2 py-1 rounded-full cursor-help ${inRange ? 'bg-[#238636] text-white' : 'bg-[#f85149] text-white'}`}>{inRange ? 'In Range' : 'Out of Range'}</span>
                          </Tooltip>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div><p className="text-[#8b949e]">Liquidity</p><p className="font-medium">{pos.liquidity.toString()}</p></div>
                          <div><p className="text-[#8b949e]">Current Price</p><p className="font-medium">{pC.toFixed(4)}</p></div>
                        </div>
                        {/* Range Visualization */}
                        <div className="mt-3 p-3 bg-[#21262d] rounded-lg">
                          <div className="flex justify-between text-xs text-[#8b949e] mb-1">
                            <span>{pL.toFixed(4)}</span>
                            <span className="text-[#58a6ff]">Current: {pC.toFixed(4)}</span>
                            <span>{pU.toFixed(4)}</span>
                          </div>
                          <div className="relative h-3 bg-[#0d1117] rounded-full overflow-hidden">
                            {/* Position range bar */}
                            <div className={`absolute h-full ${inRange ? 'bg-[#238636]' : 'bg-[#f85149]'} opacity-60`} style={{ left: '0%', right: '0%' }} />
                            {/* Current price marker */}
                            {(() => {
                              // Calculate position of current price within range
                              // Use log scale for better visualization
                              const logPL = Math.log(pL)
                              const logPU = Math.log(pU)
                              const logPC = Math.log(pC)
                              const rangeWidth = logPU - logPL
                              let position = ((logPC - logPL) / rangeWidth) * 100
                              // Clamp to show marker even when out of range
                              const clampedPosition = Math.max(0, Math.min(100, position))
                              const isOutLeft = pC < pL
                              const isOutRight = pC > pU
                              return (
                                <div
                                  className={`absolute top-0 h-full w-0.5 ${inRange ? 'bg-white' : isOutLeft ? 'bg-[#f85149]' : 'bg-[#f85149]'}`}
                                  style={{ left: `${clampedPosition}%`, transform: 'translateX(-50%)' }}
                                >
                                  <div className={`absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full ${inRange ? 'bg-white' : 'bg-[#f85149]'}`} />
                                </div>
                              )
                            })()}
                          </div>
                          <div className="flex justify-between text-xs mt-1">
                            <span className="text-[#8b949e]">Min Price</span>
                            <span className="text-[#8b949e]">Max Price</span>
                          </div>
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
                        {/* Uncollected fees section */}
                        {(() => {
                          const fees = positionFees.get(pos.id)
                          const hasUncollectedFees = fees && (fees.feesA > 0n || fees.feesB > 0n)
                          return hasUncollectedFees ? (
                            <div className="mt-2 p-2 bg-[#238636]/10 border border-[#238636]/30 rounded-lg text-sm">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-[#238636] font-medium">Uncollected Fees</span>
                              </div>
                              <div className="flex justify-between text-xs text-[#8b949e]">
                                <span>{formatCLMMDenom(pool.denomA)}</span>
                                <span className="text-[#238636]">+{fmtAmt(fees.feesA)}</span>
                              </div>
                              <div className="flex justify-between text-xs text-[#8b949e]">
                                <span>{formatCLMMDenom(pool.denomB)}</span>
                                <span className="text-[#238636]">+{fmtAmt(fees.feesB)}</span>
                              </div>
                            </div>
                          ) : null
                        })()}
                        <div className="flex gap-2 mt-3">
                          {(() => {
                            const fees = positionFees.get(pos.id)
                            const hasUncollectedFees = fees && (fees.feesA > 0n || fees.feesB > 0n)
                            return hasUncollectedFees ? (
                              <button onClick={() => handleCollectFees(pos.id)} disabled={clmmLoading} className="flex-1 py-2 rounded-lg text-sm font-medium bg-[#238636] hover:bg-[#2ea043] text-white transition disabled:opacity-50">{clmmLoading ? 'Collecting...' : 'Collect Fees'}</button>
                            ) : null
                          })()}
                          <button onClick={() => handleBurnPosition(pos.id)} disabled={clmmLoading} className={`${positionFees.get(pos.id) && (positionFees.get(pos.id)!.feesA > 0n || positionFees.get(pos.id)!.feesB > 0n) ? 'flex-1' : 'w-full'} py-2 rounded-lg text-sm font-medium bg-[#f85149] hover:bg-[#da3633] text-white transition disabled:opacity-50`}>{clmmLoading ? 'Closing...' : 'Close Position'}</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {clmmTab === 'create' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Create CLMM Pool</h3>
                  <div>
                    <label className="text-sm text-[#8b949e] block mb-2">Token A (Base)</label>
                    <select value={newClmmTokenA} onChange={(e) => setNewClmmTokenA(e.target.value)} className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-3 text-white">
                      {Array.from(balances.entries()).map(([denom, amount]) => (
                        <option key={denom} value={denom}>{formatDenom(denom)} ({fmtAmt(amount)})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-[#8b949e] block mb-2">Token B (Quote)</label>
                    <select value={newClmmTokenB} onChange={(e) => setNewClmmTokenB(e.target.value)} className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-3 text-white">
                      <option value="">Select token...</option>
                      {Array.from(balances.entries()).filter(([denom]) => denom !== newClmmTokenA).map(([denom, amount]) => (
                        <option key={denom} value={denom}>{formatDenom(denom)} ({fmtAmt(amount)})</option>
                      ))}
                    </select>
                  </div>
                  <div><label className="text-sm text-[#8b949e] block mb-2">Fee Tier</label><div className="grid grid-cols-3 gap-2">{[5, 10, 30, 50, 100, 200].map((fee) => <button key={fee} onClick={() => setNewClmmFee(fee)} className={`py-3 rounded-xl text-sm font-medium transition ${newClmmFee === fee ? 'bg-[#238636] text-white' : 'bg-[#0d1117] text-[#8b949e] hover:text-white border border-[#30363d]'}`}>{(fee / 100).toFixed(2)}%</button>)}</div></div>
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

        {/* Price Chart Section */}
        {priceHistoryData.size > 0 && (
          <div className="mt-8 max-w-2xl mx-auto">
            <div className="bg-[#161b22] rounded-2xl border border-[#30363d] p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Price Chart</h3>
                <select
                  value={selectedChartPair || ''}
                  onChange={(e) => setSelectedChartPair(e.target.value)}
                  className="bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-1.5 text-sm text-white"
                >
                  {[...priceHistoryData.keys()].map((pair) => (
                    <option key={pair} value={pair}>{pair}</option>
                  ))}
                </select>
              </div>

              {selectedChartPair && priceHistoryData.get(selectedChartPair) && (
                <>
                  {/* Price Stats */}
                  {(() => {
                    const stats = getPriceStats(selectedChartPair)
                    if (!stats) return null
                    return (
                      <div className="flex items-baseline gap-4 mb-4">
                        <span className="text-2xl font-bold">{stats.current.toFixed(stats.current >= 1 ? 4 : 6)}</span>
                        <PriceChange changePercent={stats.changePercent24h} className="text-sm" />
                        <span className="text-xs text-[#8b949e]">
                          24h: {stats.low24h.toFixed(4)} - {stats.high24h.toFixed(4)}
                        </span>
                      </div>
                    )
                  })()}

                  {/* Chart */}
                  <div className="w-full">
                    <PriceChart
                      data={priceHistoryData.get(selectedChartPair) || []}
                      width={600}
                      height={150}
                      showAxes={true}
                      className="w-full"
                    />
                  </div>

                  <p className="text-xs text-[#8b949e] mt-3 text-center">
                    Price history tracked locally in your browser
                  </p>
                </>
              )}

              {(!selectedChartPair || !priceHistoryData.get(selectedChartPair)) && (
                <div className="text-center text-[#8b949e] py-8">
                  <p>Price data will appear as you use the DEX</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 grid grid-cols-3 gap-4 max-w-2xl mx-auto">
          <StatCard title="Total Value Locked" value={totalTVL > 0 ? `$${totalTVL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'} />
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
