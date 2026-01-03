package gnomo

import (
	"strconv"
	"strings"
)

// Pool represents a liquidity pool for two token denoms
type Pool struct {
	ID       uint64
	DenomA   string
	DenomB   string
	ReserveA uint64
	ReserveB uint64
	TotalLP  uint64
	FeeBPS   uint64
}

var (
	pools      []*Pool
	nextPoolID uint64
	lpBalances map[uint64]map[string]uint64
)

func init() {
	lpBalances = make(map[uint64]map[string]uint64)
}

// CreatePool creates a new liquidity pool
func CreatePool(_ realm, denomA, denomB string, feeBPS uint64) uint64 {
	if denomA == "" || denomB == "" {
		panic("invalid denom")
	}
	if denomA == denomB {
		panic("denoms must be different")
	}
	if denomA > denomB {
		denomA, denomB = denomB, denomA
	}
	for _, p := range pools {
		if p.DenomA == denomA && p.DenomB == denomB {
			panic("pool already exists")
		}
	}
	if feeBPS == 0 {
		feeBPS = 30
	}
	if feeBPS > 1000 {
		panic("fee too high")
	}

	pool := &Pool{
		ID:     nextPoolID,
		DenomA: denomA,
		DenomB: denomB,
		FeeBPS: feeBPS,
	}
	pools = append(pools, pool)
	lpBalances[nextPoolID] = make(map[string]uint64)
	nextPoolID++
	return pool.ID
}

// AddLiquidity adds liquidity to a pool and mints LP tokens
// For demo: caller provides amounts, we mint LP shares
// In production: would use Banker to receive actual coins
func AddLiquidity(_ realm, poolID uint64, amountA, amountB uint64, caller string) uint64 {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	if amountA == 0 || amountB == 0 {
		panic("amounts must be positive")
	}
	if caller == "" {
		panic("caller required")
	}

	p := pools[poolID]
	var lpMinted uint64

	if p.TotalLP == 0 {
		// First liquidity: LP = sqrt(amountA * amountB)
		lpMinted = sqrt(amountA * amountB)
		if lpMinted == 0 {
			panic("insufficient initial liquidity")
		}
	} else {
		// Subsequent: mint proportional to contribution
		// LP = min(amountA * totalLP / reserveA, amountB * totalLP / reserveB)
		lpFromA := (amountA * p.TotalLP) / p.ReserveA
		lpFromB := (amountB * p.TotalLP) / p.ReserveB
		lpMinted = min(lpFromA, lpFromB)
		if lpMinted == 0 {
			panic("insufficient liquidity minted")
		}
	}

	// Update reserves
	p.ReserveA += amountA
	p.ReserveB += amountB
	p.TotalLP += lpMinted

	// Credit LP to caller
	lpBalances[poolID][caller] += lpMinted

	return lpMinted
}

// RemoveLiquidity burns LP tokens and returns proportional reserves
func RemoveLiquidity(_ realm, poolID uint64, lpAmount uint64, caller string) (uint64, uint64) {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	if lpAmount == 0 {
		panic("amount must be positive")
	}
	if caller == "" {
		panic("caller required")
	}

	p := pools[poolID]
	callerLP := lpBalances[poolID][caller]
	if callerLP < lpAmount {
		panic("insufficient LP balance")
	}

	// Calculate proportional amounts
	amountA := (lpAmount * p.ReserveA) / p.TotalLP
	amountB := (lpAmount * p.ReserveB) / p.TotalLP

	// Update state
	p.ReserveA -= amountA
	p.ReserveB -= amountB
	p.TotalLP -= lpAmount
	lpBalances[poolID][caller] -= lpAmount

	return amountA, amountB
}

// SwapExactIn swaps exact input amount for output
// tokenIn: "A" or "B" to indicate which token is being sold
func SwapExactIn(_ realm, poolID uint64, tokenIn string, amountIn uint64) uint64 {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	if amountIn == 0 {
		panic("amount must be positive")
	}
	if tokenIn != "A" && tokenIn != "B" {
		panic("tokenIn must be A or B")
	}

	p := pools[poolID]
	if p.ReserveA == 0 || p.ReserveB == 0 {
		panic("pool has no liquidity")
	}

	var amountOut uint64
	// Apply fee: amountInWithFee = amountIn * (10000 - feeBPS) / 10000
	amountInWithFee := (amountIn * (10000 - p.FeeBPS)) / 10000

	if tokenIn == "A" {
		// Selling A for B: amountOut = (amountInWithFee * reserveB) / (reserveA + amountInWithFee)
		amountOut = (amountInWithFee * p.ReserveB) / (p.ReserveA + amountInWithFee)
		p.ReserveA += amountIn
		p.ReserveB -= amountOut
	} else {
		// Selling B for A
		amountOut = (amountInWithFee * p.ReserveA) / (p.ReserveB + amountInWithFee)
		p.ReserveB += amountIn
		p.ReserveA -= amountOut
	}

	if amountOut == 0 {
		panic("insufficient output amount")
	}

	return amountOut
}

// GetQuote returns expected output without executing swap
func GetQuote(poolID uint64, tokenIn string, amountIn uint64) uint64 {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	p := pools[poolID]
	if p.ReserveA == 0 || p.ReserveB == 0 {
		return 0
	}

	amountInWithFee := (amountIn * (10000 - p.FeeBPS)) / 10000

	if tokenIn == "A" {
		return (amountInWithFee * p.ReserveB) / (p.ReserveA + amountInWithFee)
	}
	return (amountInWithFee * p.ReserveA) / (p.ReserveB + amountInWithFee)
}

// GetPool returns pool info
func GetPool(poolID uint64) (string, string, uint64, uint64, uint64, uint64) {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	p := pools[poolID]
	return p.DenomA, p.DenomB, p.ReserveA, p.ReserveB, p.TotalLP, p.FeeBPS
}

// GetPoolCount returns number of pools
func GetPoolCount() uint64 {
	return uint64(len(pools))
}

// GetLPBalance returns LP balance for an address
func GetLPBalance(poolID uint64, addr string) uint64 {
	if poolID >= uint64(len(pools)) {
		return 0
	}
	return lpBalances[poolID][addr]
}

// Helper functions
func sqrt(x uint64) uint64 {
	if x == 0 {
		return 0
	}
	z := x
	y := (z + 1) / 2
	for y < z {
		z = y
		y = (z + x/z) / 2
	}
	return z
}

func min(a, b uint64) uint64 {
	if a < b {
		return a
	}
	return b
}

// Render displays pool information
func Render(path string) string {
	var sb strings.Builder
	sb.WriteString("# Gnomo DEX\n\n")

	if len(pools) == 0 {
		sb.WriteString("No pools created yet.\n")
		return sb.String()
	}

	sb.WriteString("## Pools\n\n")
	for _, p := range pools {
		sb.WriteString("### Pool " + strconv.FormatUint(p.ID, 10) + ": " + p.DenomA + "/" + p.DenomB + "\n\n")
		sb.WriteString("| Metric | Value |\n")
		sb.WriteString("|--------|-------|\n")
		sb.WriteString("| Reserve " + p.DenomA + " | " + strconv.FormatUint(p.ReserveA, 10) + " |\n")
		sb.WriteString("| Reserve " + p.DenomB + " | " + strconv.FormatUint(p.ReserveB, 10) + " |\n")
		sb.WriteString("| Total LP | " + strconv.FormatUint(p.TotalLP, 10) + " |\n")
		sb.WriteString("| Fee | " + strconv.FormatUint(p.FeeBPS, 10) + " bps |\n")

		if p.ReserveA > 0 && p.ReserveB > 0 {
			// Price with 6 decimal precision
			priceAtoB := (p.ReserveB * 1000000) / p.ReserveA
			priceBtoA := (p.ReserveA * 1000000) / p.ReserveB
			sb.WriteString("| Price (1 " + p.DenomA + ") | " + formatPrice(priceAtoB) + " " + p.DenomB + " |\n")
			sb.WriteString("| Price (1 " + p.DenomB + ") | " + formatPrice(priceBtoA) + " " + p.DenomA + " |\n")
		}
		sb.WriteString("\n")
	}

	sb.WriteString("## Functions\n\n")
	sb.WriteString("- `CreatePool(denomA, denomB, feeBPS)` - Create new pool\n")
	sb.WriteString("- `AddLiquidity(poolID, amountA, amountB, caller)` - Add liquidity\n")
	sb.WriteString("- `RemoveLiquidity(poolID, lpAmount, caller)` - Remove liquidity\n")
	sb.WriteString("- `SwapExactIn(poolID, tokenIn, amountIn)` - Swap tokens (tokenIn: \"A\" or \"B\")\n")
	sb.WriteString("- `GetQuote(poolID, tokenIn, amountIn)` - Get swap quote\n")

	return sb.String()
}

func formatPrice(microPrice uint64) string {
	whole := microPrice / 1000000
	frac := microPrice % 1000000
	if frac == 0 {
		return strconv.FormatUint(whole, 10)
	}
	fracStr := strconv.FormatUint(frac, 10)
	// Pad with leading zeros
	for len(fracStr) < 6 {
		fracStr = "0" + fracStr
	}
	// Trim trailing zeros
	fracStr = strings.TrimRight(fracStr, "0")
	return strconv.FormatUint(whole, 10) + "." + fracStr
}
