// Volume history tracking with localStorage
// Stores swap volume data for 24h statistics

const STORAGE_KEY = 'gnomo_volume_history'
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface VolumeEntry {
  timestamp: number
  amountUSD: number // Volume in USD equivalent
  pair: string
}

interface StorageData {
  entries: VolumeEntry[]
  lastCleanup: number
}

// Get volume history from localStorage
function getStorageData(): StorageData {
  if (typeof window === 'undefined') {
    return { entries: [], lastCleanup: Date.now() }
  }

  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      return JSON.parse(data)
    }
  } catch (e) {
    console.error('Failed to parse volume history:', e)
  }

  return { entries: [], lastCleanup: Date.now() }
}

// Save volume history to localStorage
function setStorageData(data: StorageData): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    console.error('Failed to save volume history:', e)
  }
}

// Clean up entries older than 24 hours
function cleanupOldData(data: StorageData): StorageData {
  const now = Date.now()
  const cutoff = now - MAX_AGE_MS

  return {
    entries: data.entries.filter(e => e.timestamp > cutoff),
    lastCleanup: now,
  }
}

// Record a swap volume
export function recordVolume(pair: string, amountUSD: number): void {
  if (amountUSD <= 0 || !isFinite(amountUSD)) return

  let data = getStorageData()
  const now = Date.now()

  // Cleanup every hour
  if (now - data.lastCleanup > 60 * 60 * 1000) {
    data = cleanupOldData(data)
  }

  data.entries.push({
    timestamp: now,
    amountUSD,
    pair,
  })

  setStorageData(data)
}

// Get total 24h volume across all pairs
export function get24hVolume(): number {
  const data = getStorageData()
  const now = Date.now()
  const cutoff = now - MAX_AGE_MS

  return data.entries
    .filter(e => e.timestamp > cutoff)
    .reduce((sum, e) => sum + e.amountUSD, 0)
}

// Get 24h volume for a specific pair
export function get24hVolumeForPair(pair: string): number {
  const data = getStorageData()
  const now = Date.now()
  const cutoff = now - MAX_AGE_MS

  return data.entries
    .filter(e => e.timestamp > cutoff && e.pair === pair)
    .reduce((sum, e) => sum + e.amountUSD, 0)
}

// Clear all volume history (for debugging)
export function clearVolumeHistory(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
