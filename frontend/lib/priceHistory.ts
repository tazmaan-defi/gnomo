// Price history tracking with localStorage
// Stores price data points for chart visualization

const STORAGE_KEY = 'gnomo_price_history'
const MAX_DATA_POINTS = 100 // Keep last 100 data points per pair
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface PricePoint {
  timestamp: number
  price: number
}

export interface PairHistory {
  pair: string // e.g., "GNOT/USDC"
  points: PricePoint[]
}

interface StorageData {
  pairs: Record<string, PricePoint[]>
  lastCleanup: number
}

// Get all price history from localStorage
function getStorageData(): StorageData {
  if (typeof window === 'undefined') {
    return { pairs: {}, lastCleanup: Date.now() }
  }

  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      return JSON.parse(data)
    }
  } catch (e) {
    console.error('Failed to parse price history:', e)
  }

  return { pairs: {}, lastCleanup: Date.now() }
}

// Save price history to localStorage
function setStorageData(data: StorageData): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    console.error('Failed to save price history:', e)
  }
}

// Clean up old data points
function cleanupOldData(data: StorageData): StorageData {
  const now = Date.now()
  const cutoff = now - MAX_AGE_MS

  const cleanedPairs: Record<string, PricePoint[]> = {}

  for (const [pair, points] of Object.entries(data.pairs)) {
    const filtered = points.filter(p => p.timestamp > cutoff)
    if (filtered.length > 0) {
      // Keep only last MAX_DATA_POINTS
      cleanedPairs[pair] = filtered.slice(-MAX_DATA_POINTS)
    }
  }

  return { pairs: cleanedPairs, lastCleanup: now }
}

// Record a new price point
export function recordPrice(pair: string, price: number): void {
  if (price <= 0 || !isFinite(price)) return

  const data = getStorageData()
  const now = Date.now()

  // Cleanup every hour
  if (now - data.lastCleanup > 60 * 60 * 1000) {
    const cleaned = cleanupOldData(data)
    data.pairs = cleaned.pairs
    data.lastCleanup = now
  }

  // Initialize pair if needed
  if (!data.pairs[pair]) {
    data.pairs[pair] = []
  }

  const points = data.pairs[pair]
  const lastPoint = points[points.length - 1]

  // Don't record if price hasn't changed significantly (0.1%) or too recent (< 30 sec)
  if (lastPoint) {
    const timeDiff = now - lastPoint.timestamp
    const priceDiff = Math.abs(price - lastPoint.price) / lastPoint.price

    if (timeDiff < 30000 && priceDiff < 0.001) {
      return
    }
  }

  // Add new point
  points.push({ timestamp: now, price })

  // Trim to max points
  if (points.length > MAX_DATA_POINTS) {
    data.pairs[pair] = points.slice(-MAX_DATA_POINTS)
  }

  setStorageData(data)
}

// Get price history for a pair
export function getPriceHistory(pair: string): PricePoint[] {
  const data = getStorageData()
  return data.pairs[pair] || []
}

// Get all pairs with history
export function getAllPairsWithHistory(): string[] {
  const data = getStorageData()
  return Object.keys(data.pairs).filter(pair => data.pairs[pair].length > 0)
}

// Get price change stats
export function getPriceStats(pair: string): {
  current: number
  change24h: number
  changePercent24h: number
  high24h: number
  low24h: number
} | null {
  const points = getPriceHistory(pair)
  if (points.length === 0) return null

  const now = Date.now()
  const dayAgo = now - 24 * 60 * 60 * 1000

  const current = points[points.length - 1].price
  const recentPoints = points.filter(p => p.timestamp > dayAgo)

  if (recentPoints.length === 0) {
    return {
      current,
      change24h: 0,
      changePercent24h: 0,
      high24h: current,
      low24h: current,
    }
  }

  const oldestRecent = recentPoints[0].price
  const change24h = current - oldestRecent
  const changePercent24h = (change24h / oldestRecent) * 100

  const prices = recentPoints.map(p => p.price)
  const high24h = Math.max(...prices)
  const low24h = Math.min(...prices)

  return {
    current,
    change24h,
    changePercent24h,
    high24h,
    low24h,
  }
}

// Clear all price history (for debugging)
export function clearPriceHistory(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}

// Format pair name from denoms
export function formatPairName(denomA: string, denomB: string): string {
  const formatDenom = (d: string) => {
    if (d === 'ugnot') return 'GNOT'
    if (d.includes(':')) {
      const parts = d.split(':')
      return parts[parts.length - 1].toUpperCase()
    }
    return d.toUpperCase()
  }

  return `${formatDenom(denomA)}/${formatDenom(denomB)}`
}
