// CLMM contract interaction library
// Connects to gnodev on port 26658

export const CLMM_RPC_URL = 'http://127.0.0.1:26657'
export const CLMM_PKG_PATH = 'gno.land/r/dev/clmm'

function stringToHex(str: string): string {
  return Array.from(str)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
}

function decodeBase64(base64: string): string {
  if (typeof window !== 'undefined') return atob(base64)
  return Buffer.from(base64, 'base64').toString('utf-8')
}

async function abciQuery(path: string, dataStr: string): Promise<string> {
  const hexData = stringToHex(dataStr)
  const url = `${CLMM_RPC_URL}/abci_query?path="${encodeURIComponent(path)}"&data=0x${hexData}`

  const res = await fetch(url)
  const json = await res.json()

  const dataB64 = json?.result?.response?.ResponseBase?.Data
  if (!dataB64) return ''

  return decodeBase64(dataB64)
}

async function queryEval(expr: string): Promise<string> {
  return abciQuery('vm/qeval', `${CLMM_PKG_PATH}.${expr}`)
}

// =============================================================================
// Types
// =============================================================================

export interface CLMMPool {
  id: number
  denomA: string
  denomB: string
  priceX6: bigint
  currentTick: number
  liquidity: bigint
  feeBPS: number
  tickSpacing: number
}

export interface CLMMPosition {
  id: number
  poolId: number
  owner: string
  tickLower: number
  tickUpper: number
  liquidity: bigint
}

// =============================================================================
// Parsing helpers
// =============================================================================

function parseGoTuple(response: string): string[] {
  // Handle multi-line format where each value is on its own line:
  // ("value" string)
  // (123 int64)
  const lines = response.trim().split('\n')

  if (lines.length > 1) {
    // Multi-line format
    return lines.map((line) => {
      const quotedMatch = line.match(/\("([^"]*)"\s+\w+\)/)
      if (quotedMatch) return quotedMatch[1]
      const numMatch = line.match(/\((-?\d+)\s+\w+\)/)
      if (numMatch) return numMatch[1]
      return ''
    }).filter(v => v !== '')
  }

  // Single-line format: (value1 type1, value2 type2, ...)
  const inner = response.replace(/^\(|\)$/g, '').trim()
  if (!inner) return []

  const parts: string[] = []
  let current = ''
  let inQuote = false
  let depth = 0

  for (const char of inner) {
    if (char === '"' && depth === 0) {
      inQuote = !inQuote
      current += char
    } else if (char === '(' && !inQuote) {
      depth++
      current += char
    } else if (char === ')' && !inQuote) {
      depth--
      current += char
    } else if (char === ',' && !inQuote && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current) parts.push(current.trim())

  // Extract values (remove type annotations)
  return parts.map((p) => {
    const quotedMatch = p.match(/^"([^"]*)"/)
    if (quotedMatch) return quotedMatch[1]
    const numMatch = p.match(/^(-?\d+)/)
    if (numMatch) return numMatch[1]
    return p
  })
}

// =============================================================================
// Query functions
// =============================================================================

export async function getCLMMPoolCount(): Promise<number> {
  try {
    const result = await queryEval('GetCLMMPoolCount()')
    const match = result.match(/\((\d+)/)
    return match ? parseInt(match[1]) : 0
  } catch (e) {
    console.error('Failed to get CLMM pool count:', e)
    return 0
  }
}

export async function getCLMMPool(poolId: number): Promise<CLMMPool | null> {
  try {
    const result = await queryEval(`GetCLMMPool(${poolId})`)
    const values = parseGoTuple(result)

    if (values.length >= 7) {
      return {
        id: poolId,
        denomA: values[0],
        denomB: values[1],
        priceX6: BigInt(values[2]),
        currentTick: parseInt(values[3]),
        liquidity: BigInt(values[4]),
        feeBPS: parseInt(values[5]),
        tickSpacing: parseInt(values[6]),
      }
    }
    return null
  } catch (e) {
    console.error('Failed to get CLMM pool:', e)
    return null
  }
}

export async function getAllCLMMPools(): Promise<CLMMPool[]> {
  const count = await getCLMMPoolCount()
  const pools: CLMMPool[] = []

  for (let i = 0; i < count; i++) {
    const pool = await getCLMMPool(i)
    if (pool) pools.push(pool)
  }

  return pools
}

export async function getPosition(positionId: number): Promise<CLMMPosition | null> {
  try {
    const result = await queryEval(`GetPosition(${positionId})`)
    const values = parseGoTuple(result)

    if (values.length >= 5) {
      return {
        id: positionId,
        poolId: parseInt(values[0]),
        owner: values[1],
        tickLower: parseInt(values[2]),
        tickUpper: parseInt(values[3]),
        liquidity: BigInt(values[4]),
      }
    }
    return null
  } catch (e) {
    console.error('Failed to get position:', e)
    return null
  }
}

export async function getPositionCount(): Promise<number> {
  try {
    const result = await queryEval('GetPositionCount()')
    const match = result.match(/\((\d+)/)
    return match ? parseInt(match[1]) : 0
  } catch (e) {
    console.error('Failed to get position count:', e)
    return 0
  }
}

export async function getPositionsByOwner(owner: string): Promise<number[]> {
  try {
    const result = await queryEval(`GetPositionsByOwner("${owner}")`)
    // Parse array: (slice[...] []uint64) or (nil []uint64)
    if (result.includes('nil')) return []
    
    const match = result.match(/slice\[([^\]]*)\]/)
    if (match && match[1]) {
      // Format: (1 uint64, 2 uint64, ...)
      const nums = match[1].match(/\d+/g)
      return nums ? nums.map((n) => parseInt(n)) : []
    }
    return []
  } catch (e) {
    console.error('Failed to get positions by owner:', e)
    return []
  }
}

export async function getCLMMQuote(
  poolId: number,
  tokenIn: 'A' | 'B',
  amountIn: bigint
): Promise<bigint> {
  try {
    const result = await queryEval(`GetQuote(${poolId},"${tokenIn}",${amountIn})`)
    const match = result.match(/\((-?\d+)/)
    return match ? BigInt(match[1]) : 0n
  } catch (e) {
    console.error('Failed to get CLMM quote:', e)
    return 0n
  }
}

export async function getPriceAtTick(tick: number): Promise<bigint> {
  try {
    const result = await queryEval(`GetPriceAtTick(${tick})`)
    const match = result.match(/\((-?\d+)/)
    return match ? BigInt(match[1]) : 0n
  } catch (e) {
    console.error('Failed to get price at tick:', e)
    return 0n
  }
}

export async function getTickAtPrice(priceX6: bigint): Promise<number> {
  try {
    const result = await queryEval(`GetTickAtPrice(${priceX6})`)
    const match = result.match(/\((-?\d+)/)
    return match ? parseInt(match[1]) : 0
  } catch (e) {
    console.error('Failed to get tick at price:', e)
    return 0
  }
}

export async function getCLMMRealmAddress(): Promise<string> {
  try {
    const result = await queryEval('GetRealmAddress()')
    const match = result.match(/"([^"]+)"/)
    return match ? match[1] : ''
  } catch (e) {
    console.error('Failed to get CLMM realm address:', e)
    return ''
  }
}

// =============================================================================
// Formatting helpers
// =============================================================================

export function formatPriceX6(priceX6: bigint): string {
  const price = Number(priceX6) / 1_000_000
  return price.toFixed(6)
}

export function formatCLMMDenom(denom: string): string {
  if (denom === 'ugnot') return 'GNOT'
  if (denom.includes(':')) {
    const parts = denom.split(':')
    return parts[parts.length - 1].toUpperCase()
  }
  return denom
}

// Each tick = 1% price change
export function tickToPrice(tick: number, basePrice: number = 1): number {
  return basePrice * Math.pow(1.01, tick)
}

export function priceToTick(price: number, basePrice: number = 1): number {
  return Math.round(Math.log(price / basePrice) / Math.log(1.01))
}

export function tickToPercentage(tick: number): string {
  if (tick === 0) return '0%'
  const multiplier = Math.pow(1.01, tick)
  const pct = (multiplier - 1) * 100
  return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`
}
