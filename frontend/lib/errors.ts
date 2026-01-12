// Error parsing utilities for better user-facing messages

// Common Gno contract error patterns and their user-friendly messages
const ERROR_PATTERNS: [RegExp, string][] = [
  // Slippage errors
  [/slippage.*output.*<.*min/i, 'Price moved too much. Try increasing slippage tolerance.'],
  [/slippage.*LP.*<.*min/i, 'Slippage exceeded. Try increasing slippage tolerance.'],
  [/slippage.*amountA.*<.*min/i, 'Token A output too low. Price may have changed.'],
  [/slippage.*amountB.*<.*min/i, 'Token B output too low. Price may have changed.'],

  // Liquidity errors
  [/insufficient.*liquidity/i, 'Not enough liquidity in the pool for this trade.'],
  [/no liquidity/i, 'This pool has no liquidity yet.'],
  [/insufficient.*LP.*balance/i, 'You don\'t have enough LP tokens.'],
  [/insufficient.*output/i, 'Trade amount too small for meaningful output.'],

  // Balance errors
  [/insufficient.*balance/i, 'Insufficient balance for this transaction.'],
  [/must send.*token/i, 'Please enter an amount to swap.'],
  [/must send both/i, 'Both tokens are required to add liquidity.'],

  // Pool errors
  [/pool not found/i, 'Pool does not exist.'],
  [/pool already exists/i, 'A pool with these tokens already exists.'],
  [/denoms must be different/i, 'Cannot create a pool with the same token.'],

  // Position errors (CLMM)
  [/position not found/i, 'Position does not exist.'],
  [/not owner/i, 'You don\'t own this position.'],
  [/already burned/i, 'This position has already been closed.'],
  [/tick.*out of range/i, 'Price range is outside allowed bounds.'],
  [/ticks must align/i, 'Price range must align with tick spacing.'],
  [/tickLower must be.*tickUpper/i, 'Lower price must be less than upper price.'],

  // Math errors
  [/overflow/i, 'Amount too large for calculation.'],
  [/division by zero/i, 'Invalid calculation - please try different amounts.'],

  // Gas errors
  [/out of gas/i, 'Transaction ran out of gas. Try a smaller trade.'],

  // User rejection
  [/rejected/i, 'Transaction was rejected.'],
  [/user denied/i, 'Transaction was cancelled.'],
  [/timed out/i, 'Request timed out. Please try again.'],

  // Wallet errors
  [/wallet.*locked/i, 'Please unlock your wallet and try again.'],
  [/not connected/i, 'Please connect your wallet first.'],
]

// Parse Adena/Gno error response into user-friendly message
export function parseContractError(error: unknown): string {
  let errorMessage = ''

  // Extract error message from various formats
  if (typeof error === 'string') {
    errorMessage = error
  } else if (error instanceof Error) {
    errorMessage = error.message
  } else if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    // Adena response format
    if (typeof obj.message === 'string') {
      errorMessage = obj.message
    }
    // Nested data format
    if (obj.data && typeof obj.data === 'string') {
      errorMessage = obj.data
    }
  }

  // Try to match against known patterns
  for (const [pattern, friendlyMessage] of ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return friendlyMessage
    }
  }

  // If no pattern matched, clean up the raw message
  if (errorMessage) {
    // Remove technical prefixes
    errorMessage = errorMessage
      .replace(/^(Error:|panic:|VM Error:)\s*/i, '')
      .replace(/\s*\(.*\)\s*$/, '') // Remove trailing technical info
      .trim()

    // Truncate very long messages
    if (errorMessage.length > 150) {
      errorMessage = errorMessage.substring(0, 147) + '...'
    }

    return errorMessage || 'Transaction failed'
  }

  return 'Transaction failed. Please try again.'
}

// Check if error is a user rejection (shouldn't show error toast)
export function isUserRejection(error: unknown): boolean {
  const msg = parseErrorString(error)
  return /rejected|denied|cancelled|timed out/i.test(msg)
}

// Helper to extract string from error
function parseErrorString(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
  }
  return ''
}
