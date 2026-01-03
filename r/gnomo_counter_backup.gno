package gnomo

import (
	"std"
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
	FeeBPS   uint64 // fee in basis points (30 = 0.3%)
}

// Global state
var (
	pools      []*Pool
	nextPoolID uint64
	// lpBalances tracks LP shares: poolID -> address -> balance
	lpBalances map[uint64]map[std.Address]uint64
)

func init() {
	lpBalances = make(map[uint64]map[std.Address]uint64)
}

// CreatePool creates a new liquidity pool for two denoms
// Returns the pool ID
func CreatePool(_ realm, denomA, denomB string, feeBPS uint64) uint64 {
	// Validate inputs
	if denomA == "" || denomB == "" {
		panic("invalid denom")
	}
	if denomA == denomB {
		panic("denoms must be different")
	}
	// Normalize order (smaller denom first for consistency)
	if denomA > denomB {
		denomA, denomB = denomB, denomA
	}
	// Check if pool already exists
	for _, p := range pools {
		if p.DenomA == denomA && p.DenomB == denomB {
			panic("pool already exists")
		}
	}
	// Default fee to 30 bps (0.3%) if not specified
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
	lpBalances[nextPoolID] = make(map[std.Address]uint64)
	nextPoolID++
	return pool.ID
}

// GetPool returns pool info by ID
func GetPool(poolID uint64) (string, string, uint64, uint64, uint64, uint64) {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	p := pools[poolID]
	return p.DenomA, p.DenomB, p.ReserveA, p.ReserveB, p.TotalLP, p.FeeBPS
}

// GetPoolCount returns the number of pools
func GetPoolCount() uint64 {
	return uint64(len(pools))
}

// GetLPBalance returns LP balance for an address in a pool
func GetLPBalance(poolID uint64, addr std.Address) uint64 {
	if poolID >= uint64(len(pools)) {
		return 0
	}
	return lpBalances[poolID][addr]
}

// Helper: integer square root (for initial LP minting)
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

// Helper: min of two uint64
func min(a, b uint64) uint64 {
	if a < b {
		return a
	}
	return b
}

// Render displays pool information in gnoweb
func Render(path string) string {
	var sb strings.Builder
	sb.WriteString("# Gnomo DEX\n\n")

	if len(pools) == 0 {
		sb.WriteString("No pools created yet.\n\n")
		sb.WriteString("Use CreatePool(denomA, denomB, feeBPS) to create a pool.\n")
		return sb.String()
	}

	sb.WriteString("## Pools\n\n")
	for _, p := range pools {
		sb.WriteString("### Pool " + strconv.FormatUint(p.ID, 10) + "\n")
		sb.WriteString("- Pair: " + p.DenomA + " / " + p.DenomB + "\n")
		sb.WriteString("- Reserve A: " + strconv.FormatUint(p.ReserveA, 10) + " " + p.DenomA + "\n")
		sb.WriteString("- Reserve B: " + strconv.FormatUint(p.ReserveB, 10) + " " + p.DenomB + "\n")
		sb.WriteString("- Total LP: " + strconv.FormatUint(p.TotalLP, 10) + "\n")
		sb.WriteString("- Fee: " + strconv.FormatUint(p.FeeBPS, 10) + " bps\n")
		if p.ReserveA > 0 && p.ReserveB > 0 {
			// Show price (simplified, integer math)
			priceAtoB := (p.ReserveB * 1000000) / p.ReserveA
			priceBtoA := (p.ReserveA * 1000000) / p.ReserveB
			sb.WriteString("- Price: 1 " + p.DenomA + " = " + strconv.FormatUint(priceAtoB, 10) + " micro-" + p.DenomB + "\n")
			sb.WriteString("- Price: 1 " + p.DenomB + " = " + strconv.FormatUint(priceBtoA, 10) + " micro-" + p.DenomA + "\n")
		}
		sb.WriteString("\n")
	}
	return sb.String()
}
