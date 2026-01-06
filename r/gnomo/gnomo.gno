package gnomo

import (
	"chain"
	"chain/banker"
	"chain/runtime"
	"strconv"
	"strings"
)

// Pool represents a liquidity pool for two token denoms
type Pool struct {
	ID       uint64
	DenomA   string
	DenomB   string
	ReserveA int64
	ReserveB int64
	TotalLP  int64
	FeeBPS   int64
}

var (
	pools      []*Pool
	nextPoolID uint64
	lpBalances map[uint64]map[string]int64
)

func init() {
	lpBalances = make(map[uint64]map[string]int64)
}

// GetRealmTokenDenom returns the full denom for a realm-issued token
// e.g., "usdc" -> "/gno.land/r/dev/gnomo:usdc"
func GetRealmTokenDenom(baseName string) string {
	return runtime.CurrentRealm().CoinDenom(baseName)
}

// MintTestTokens mints test tokens to the caller (for testing only)
// This allows testing the DEX without needing external tokens
func MintTestTokens(_ realm, baseName string, amount int64) string {
	if amount <= 0 {
		panic("amount must be positive")
	}
	if baseName == "" {
		panic("baseName required")
	}

	caller := runtime.OriginCaller()
	bnk := banker.NewBanker(banker.BankerTypeRealmIssue)
	
	denom := runtime.CurrentRealm().CoinDenom(baseName)
	bnk.IssueCoin(caller, denom, amount)
	
	return denom
}

// CreatePool creates a new liquidity pool
func CreatePool(_ realm, denomA, denomB string, feeBPS int64) uint64 {
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
	lpBalances[nextPoolID] = make(map[string]int64)
	nextPoolID++
	return pool.ID
}

// AddLiquidity adds liquidity to a pool
// User must send both tokens with the transaction
func AddLiquidity(_ realm, poolID uint64) int64 {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}

	p := pools[poolID]
	caller := string(runtime.OriginCaller())
	
	sentCoins := banker.OriginSend()
	amountA := sentCoins.AmountOf(p.DenomA)
	amountB := sentCoins.AmountOf(p.DenomB)

	if amountA <= 0 || amountB <= 0 {
		panic("must send both tokens: " + p.DenomA + " and " + p.DenomB)
	}

	var lpMinted int64

	if p.TotalLP == 0 {
		lpMinted = sqrt64(amountA * amountB)
		if lpMinted == 0 {
			panic("insufficient initial liquidity")
		}
	} else {
		lpFromA := (amountA * p.TotalLP) / p.ReserveA
		lpFromB := (amountB * p.TotalLP) / p.ReserveB
		lpMinted = min64(lpFromA, lpFromB)
		if lpMinted == 0 {
			panic("insufficient liquidity minted")
		}
	}

	p.ReserveA += amountA
	p.ReserveB += amountB
	p.TotalLP += lpMinted
	lpBalances[poolID][caller] += lpMinted

	return lpMinted
}

// RemoveLiquidity burns LP tokens and returns proportional reserves
func RemoveLiquidity(_ realm, poolID uint64, lpAmount int64) {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	if lpAmount <= 0 {
		panic("amount must be positive")
	}

	p := pools[poolID]
	caller := string(runtime.OriginCaller())
	callerLP := lpBalances[poolID][caller]
	
	if callerLP < lpAmount {
		panic("insufficient LP balance")
	}

	amountA := (lpAmount * p.ReserveA) / p.TotalLP
	amountB := (lpAmount * p.ReserveB) / p.TotalLP

	if amountA <= 0 || amountB <= 0 {
		panic("insufficient output amounts")
	}

	p.ReserveA -= amountA
	p.ReserveB -= amountB
	p.TotalLP -= lpAmount
	lpBalances[poolID][caller] -= lpAmount

	bnk := banker.NewBanker(banker.BankerTypeRealmSend)
	realmAddr := runtime.CurrentRealm().Address()
	callerAddr := runtime.OriginCaller()

	coins := chain.NewCoins(
		chain.NewCoin(p.DenomA, amountA),
		chain.NewCoin(p.DenomB, amountB),
	)
	bnk.SendCoins(realmAddr, callerAddr, coins)
}

// Swap swaps exact input amount for output
func Swap(_ realm, poolID uint64, tokenIn string, minAmountOut int64) int64 {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	if tokenIn != "A" && tokenIn != "B" {
		panic("tokenIn must be A or B")
	}

	p := pools[poolID]
	if p.ReserveA == 0 || p.ReserveB == 0 {
		panic("pool has no liquidity")
	}

	caller := runtime.OriginCaller()
	sentCoins := banker.OriginSend()

	var amountIn int64
	var denomOut string
	
	if tokenIn == "A" {
		denomOut = p.DenomB
		amountIn = sentCoins.AmountOf(p.DenomA)
	} else {
		denomOut = p.DenomA
		amountIn = sentCoins.AmountOf(p.DenomB)
	}

	if amountIn <= 0 {
		panic("must send input token")
	}

	var amountOut int64
	amountInWithFee := (amountIn * (10000 - p.FeeBPS)) / 10000

	if tokenIn == "A" {
		amountOut = (amountInWithFee * p.ReserveB) / (p.ReserveA + amountInWithFee)
		p.ReserveA += amountIn
		p.ReserveB -= amountOut
	} else {
		amountOut = (amountInWithFee * p.ReserveA) / (p.ReserveB + amountInWithFee)
		p.ReserveB += amountIn
		p.ReserveA -= amountOut
	}

	if amountOut <= 0 {
		panic("insufficient output amount")
	}
	if amountOut < minAmountOut {
		panic("slippage: output " + strconv.FormatInt(amountOut, 10) + " < min " + strconv.FormatInt(minAmountOut, 10))
	}

	bnk := banker.NewBanker(banker.BankerTypeRealmSend)
	realmAddr := runtime.CurrentRealm().Address()
	
	outCoins := chain.NewCoins(chain.NewCoin(denomOut, amountOut))
	bnk.SendCoins(realmAddr, caller, outCoins)

	return amountOut
}

// GetQuote returns expected output without executing swap
func GetQuote(poolID uint64, tokenIn string, amountIn int64) int64 {
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
func GetPool(poolID uint64) (string, string, int64, int64, int64, int64) {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	p := pools[poolID]
	return p.DenomA, p.DenomB, p.ReserveA, p.ReserveB, p.TotalLP, p.FeeBPS
}

func GetPoolCount() uint64 {
	return uint64(len(pools))
}

func GetLPBalance(poolID uint64, addr string) int64 {
	if poolID >= uint64(len(pools)) {
		return 0
	}
	return lpBalances[poolID][addr]
}

func GetRealmAddress() string {
	return string(runtime.CurrentRealm().Address())
}

// Helper functions
func sqrt64(x int64) int64 {
	if x <= 0 {
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

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// Render displays pool information
func Render(path string) string {
	var sb strings.Builder
	sb.WriteString("# Gnomo DEX\n\n")
	sb.WriteString("**Contract Address:** `" + string(runtime.CurrentRealm().Address()) + "`\n\n")

	// Show test token denom
	testDenom := runtime.CurrentRealm().CoinDenom("usdc")
	sb.WriteString("**Test Token (usdc):** `" + testDenom + "`\n\n")

	if len(pools) == 0 {
		sb.WriteString("No pools created yet.\n\n")
	} else {
		sb.WriteString("## Pools\n\n")
		for _, p := range pools {
			sb.WriteString("### Pool " + strconv.FormatUint(p.ID, 10) + ": " + p.DenomA + " / " + p.DenomB + "\n\n")
			sb.WriteString("| Metric | Value |\n")
			sb.WriteString("|--------|-------|\n")
			sb.WriteString("| Reserve A | " + strconv.FormatInt(p.ReserveA, 10) + " |\n")
			sb.WriteString("| Reserve B | " + strconv.FormatInt(p.ReserveB, 10) + " |\n")
			sb.WriteString("| Total LP | " + strconv.FormatInt(p.TotalLP, 10) + " |\n")
			sb.WriteString("| Fee | " + strconv.FormatInt(p.FeeBPS, 10) + " bps |\n")

			if p.ReserveA > 0 && p.ReserveB > 0 {
				priceAtoB := (p.ReserveB * 1000000) / p.ReserveA
				priceBtoA := (p.ReserveA * 1000000) / p.ReserveB
				sb.WriteString("| Price A→B | " + formatPrice(priceAtoB) + " |\n")
				sb.WriteString("| Price B→A | " + formatPrice(priceBtoA) + " |\n")
			}
			sb.WriteString("\n")
		}
	}

	sb.WriteString("## Quick Start\n\n")
	sb.WriteString("### 1. Get Test Tokens\n")
	sb.WriteString("```\n")
	sb.WriteString("gnokey maketx call -func MintTestTokens -args \"usdc\" -args \"10000000\" ...\n")
	sb.WriteString("```\n\n")
	sb.WriteString("### 2. Create Pool (ugnot + test usdc)\n")
	sb.WriteString("```\n")
	sb.WriteString("gnokey maketx call -func CreatePool -args \"ugnot\" -args \"" + testDenom + "\" -args \"30\" ...\n")
	sb.WriteString("```\n\n")
	sb.WriteString("### 3. Add Liquidity\n")
	sb.WriteString("```\n")
	sb.WriteString("gnokey maketx call -send \"1000000ugnot,2000000" + testDenom + "\" -func AddLiquidity -args \"0\" ...\n")
	sb.WriteString("```\n\n")
	sb.WriteString("### 4. Swap\n")
	sb.WriteString("```\n")
	sb.WriteString("gnokey maketx call -send \"100000ugnot\" -func Swap -args \"0\" -args \"A\" -args \"0\" ...\n")
	sb.WriteString("```\n\n")

	return sb.String()
}

func formatPrice(microPrice int64) string {
	whole := microPrice / 1000000
	frac := microPrice % 1000000
	if frac == 0 {
		return strconv.FormatInt(whole, 10)
	}
	fracStr := strconv.FormatInt(frac, 10)
	for len(fracStr) < 6 {
		fracStr = "0" + fracStr
	}
	fracStr = strings.TrimRight(fracStr, "0")
	return strconv.FormatInt(whole, 10) + "." + fracStr
}
