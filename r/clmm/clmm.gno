package clmm

import (
	"chain"
	"chain/banker"
	"chain/runtime"
	"strconv"
	"strings"
)

// =============================================================================
// CONSTANTS
// =============================================================================

const (
	MIN_TICK  = -1000
	MAX_TICK  = 1000
	PRECISION = 1000000
)

// =============================================================================
// DATA STRUCTURES
// =============================================================================

type CLMMPool struct {
	ID          uint64
	DenomA      string
	DenomB      string
	FeeBPS      int64
	TickSpacing int64
	PriceX6     int64
	CurrentTick int64
	Liquidity   int64
	FeeGrowthA  int64
	FeeGrowthB  int64
}

type Position struct {
	ID            uint64
	PoolID        uint64
	Owner         string
	TickLower     int64
	TickUpper     int64
	Liquidity     int64
	FeeGrowthLastA int64
	FeeGrowthLastB int64
	TokensOwedA   int64
	TokensOwedB   int64
}

type TickInfo struct {
	LiquidityGross int64
	LiquidityNet   int64
	Initialized    bool
}

var (
	pools          []*CLMMPool
	nextPoolID     uint64
	positions      []*Position
	nextPositionID uint64
	tickData       map[uint64]map[int64]*TickInfo
)

func init() {
	tickData = make(map[uint64]map[int64]*TickInfo)
}

// =============================================================================
// TICK MATH
// =============================================================================

func getPriceAtTick(tick int64) int64 {
	if tick < MIN_TICK || tick > MAX_TICK {
		panic("tick out of range")
	}

	if tick == 0 {
		return PRECISION
	}

	absTick := tick
	if absTick < 0 {
		absTick = -absTick
	}

	// Use 1.01 per tick (1% price change per tick)
	// Calculate 1.01^absTick using simple iteration
	// This is O(n) but safe from overflow for reasonable tick values
	result := int64(PRECISION) // 1.0 in X6

	for i := int64(0); i < absTick; i++ {
		// result = result * 1.01 = result * 101 / 100
		result = (result * 101) / 100
	}

	if tick < 0 {
		// Invert: 1 / price = PRECISION^2 / result
		if result > 0 {
			return (PRECISION * PRECISION) / result
		}
		return PRECISION
	}

	return result
}

func getTickAtPrice(priceX6 int64) int64 {
	if priceX6 <= 0 {
		panic("invalid price")
	}

	low := int64(MIN_TICK)
	high := int64(MAX_TICK)

	for low < high {
		mid := (low + high + 1) / 2
		priceAtMid := getPriceAtTick(mid)

		if priceAtMid <= priceX6 {
			low = mid
		} else {
			high = mid - 1
		}
	}

	return low
}

// =============================================================================
// LIQUIDITY MATH
// =============================================================================

func getAmountsForLiquidity(pL, pU, pC, liq int64) (int64, int64) {
	if pC <= pL {
		amt0 := (liq * (pU - pL)) / ((pL * pU) / PRECISION)
		return amt0, 0
	} else if pC >= pU {
		amt1 := (liq * (pU - pL)) / PRECISION
		return 0, amt1
	} else {
		amt0 := (liq * (pU - pC)) / ((pC * pU) / PRECISION)
		amt1 := (liq * (pC - pL)) / PRECISION
		return amt0, amt1
	}
}

func getLiquidityForAmounts(pL, pU, pC, amt0, amt1 int64) int64 {
	if pC <= pL {
		if amt0 <= 0 {
			return 0
		}
		return (amt0 * ((pL * pU) / PRECISION)) / (pU - pL)
	} else if pC >= pU {
		if amt1 <= 0 {
			return 0
		}
		return (amt1 * PRECISION) / (pU - pL)
	} else {
		liq0 := (amt0 * ((pC * pU) / PRECISION)) / (pU - pC)
		liq1 := (amt1 * PRECISION) / (pC - pL)
		if liq0 < liq1 {
			return liq0
		}
		return liq1
	}
}

// =============================================================================
// POOL MANAGEMENT
// =============================================================================

func CreateCLMMPool(_ realm, denomA, denomB string, feeBPS int64, initialPriceX6 int64) uint64 {
	if denomA == "" || denomB == "" {
		panic("invalid denom")
	}
	if denomA == denomB {
		panic("denoms must be different")
	}
	if denomA > denomB {
		denomA, denomB = denomB, denomA
		if initialPriceX6 > 0 {
			initialPriceX6 = (PRECISION * PRECISION) / initialPriceX6
		}
	}

	for _, p := range pools {
		if p.DenomA == denomA && p.DenomB == denomB && p.FeeBPS == feeBPS {
			panic("pool already exists")
		}
	}

	if feeBPS <= 0 || feeBPS > 10000 {
		panic("fee must be 1-10000 bps")
	}

	var tickSpacing int64 = 1
	if feeBPS >= 100 {
		tickSpacing = 10
	} else if feeBPS >= 30 {
		tickSpacing = 5
	}

	if initialPriceX6 <= 0 {
		initialPriceX6 = PRECISION
	}

	pool := &CLMMPool{
		ID:          nextPoolID,
		DenomA:      denomA,
		DenomB:      denomB,
		FeeBPS:      feeBPS,
		TickSpacing: tickSpacing,
		PriceX6:     initialPriceX6,
		CurrentTick: getTickAtPrice(initialPriceX6),
		Liquidity:   0,
	}

	pools = append(pools, pool)
	tickData[nextPoolID] = make(map[int64]*TickInfo)
	nextPoolID++

	return pool.ID
}

// =============================================================================
// POSITION MANAGEMENT
// =============================================================================

func MintPosition(_ realm, poolID uint64, tickLower, tickUpper int64) uint64 {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}

	pool := pools[poolID]

	if tickLower >= tickUpper {
		panic("tickLower must be < tickUpper")
	}
	if tickLower < MIN_TICK || tickUpper > MAX_TICK {
		panic("ticks out of range")
	}
	if tickLower%pool.TickSpacing != 0 || tickUpper%pool.TickSpacing != 0 {
		panic("ticks must align with spacing")
	}

	caller := string(runtime.OriginCaller())
	sentCoins := banker.OriginSend()

	amountA := sentCoins.AmountOf(pool.DenomA)
	amountB := sentCoins.AmountOf(pool.DenomB)

	if amountA <= 0 && amountB <= 0 {
		panic("must send tokens")
	}

	pL := getPriceAtTick(tickLower)
	pU := getPriceAtTick(tickUpper)

	liquidity := getLiquidityForAmounts(pL, pU, pool.PriceX6, amountA, amountB)
	if liquidity <= 0 {
		panic("insufficient liquidity")
	}

	// Update ticks
	updateTick(poolID, tickLower, liquidity, true)
	updateTick(poolID, tickUpper, liquidity, false)

	// Update pool liquidity if in range
	if pool.PriceX6 >= pL && pool.PriceX6 < pU {
		pool.Liquidity += liquidity
	}

	position := &Position{
		ID:            nextPositionID,
		PoolID:        poolID,
		Owner:         caller,
		TickLower:     tickLower,
		TickUpper:     tickUpper,
		Liquidity:     liquidity,
		FeeGrowthLastA: pool.FeeGrowthA,
		FeeGrowthLastB: pool.FeeGrowthB,
	}

	positions = append(positions, position)
	nextPositionID++

	return position.ID
}

func BurnPosition(_ realm, positionID uint64) {
	if positionID >= uint64(len(positions)) {
		panic("position not found")
	}

	pos := positions[positionID]
	caller := string(runtime.OriginCaller())

	if pos.Owner != caller {
		panic("not owner")
	}
	if pos.Liquidity == 0 {
		panic("already burned")
	}

	pool := pools[pos.PoolID]
	pL := getPriceAtTick(pos.TickLower)
	pU := getPriceAtTick(pos.TickUpper)

	amount0, amount1 := getAmountsForLiquidity(pL, pU, pool.PriceX6, pos.Liquidity)

	// Update ticks
	updateTick(pos.PoolID, pos.TickLower, -pos.Liquidity, true)
	updateTick(pos.PoolID, pos.TickUpper, -pos.Liquidity, false)

	// Update pool liquidity
	if pool.PriceX6 >= pL && pool.PriceX6 < pU {
		pool.Liquidity -= pos.Liquidity
	}

	pos.Liquidity = 0

	// Send tokens back
	if amount0 > 0 || amount1 > 0 {
		bnk := banker.NewBanker(banker.BankerTypeRealmSend)
		realmAddr := runtime.CurrentRealm().Address()
		callerAddr := runtime.OriginCaller()

		if amount0 > 0 && amount1 > 0 {
			coins := chain.NewCoins(
				chain.NewCoin(pool.DenomA, amount0),
				chain.NewCoin(pool.DenomB, amount1),
			)
			bnk.SendCoins(realmAddr, callerAddr, coins)
		} else if amount0 > 0 {
			bnk.SendCoins(realmAddr, callerAddr, chain.NewCoins(chain.NewCoin(pool.DenomA, amount0)))
		} else {
			bnk.SendCoins(realmAddr, callerAddr, chain.NewCoins(chain.NewCoin(pool.DenomB, amount1)))
		}
	}
}

// =============================================================================
// SWAP
// =============================================================================

func Swap(_ realm, poolID uint64, tokenIn string, minAmountOut int64) int64 {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}

	pool := pools[poolID]
	if pool.Liquidity == 0 {
		panic("no liquidity")
	}

	caller := runtime.OriginCaller()
	sentCoins := banker.OriginSend()

	var zeroForOne bool
	var amountIn int64

	if tokenIn == "A" {
		zeroForOne = true
		amountIn = sentCoins.AmountOf(pool.DenomA)
	} else if tokenIn == "B" {
		zeroForOne = false
		amountIn = sentCoins.AmountOf(pool.DenomB)
	} else {
		panic("tokenIn must be A or B")
	}

	if amountIn <= 0 {
		panic("must send input token")
	}

	// Calculate fee
	feeAmount := (amountIn * pool.FeeBPS) / 10000
	amountAfterFee := amountIn - feeAmount

	// Accumulate fees
	if pool.Liquidity > 0 {
		if zeroForOne {
			pool.FeeGrowthA += (feeAmount * PRECISION) / pool.Liquidity
		} else {
			pool.FeeGrowthB += (feeAmount * PRECISION) / pool.Liquidity
		}
	}

	// Calculate output
	var amountOut int64
	if zeroForOne {
		amountOut = (amountAfterFee * pool.PriceX6) / PRECISION
		newPrice := pool.PriceX6 - (amountOut * PRECISION / pool.Liquidity)
		if newPrice < getPriceAtTick(MIN_TICK) {
			newPrice = getPriceAtTick(MIN_TICK)
		}
		pool.PriceX6 = newPrice
	} else {
		amountOut = (amountAfterFee * PRECISION) / pool.PriceX6
		newPrice := pool.PriceX6 + (amountAfterFee * PRECISION / pool.Liquidity)
		if newPrice > getPriceAtTick(MAX_TICK) {
			newPrice = getPriceAtTick(MAX_TICK)
		}
		pool.PriceX6 = newPrice
	}

	pool.CurrentTick = getTickAtPrice(pool.PriceX6)

	if amountOut < minAmountOut {
		panic("slippage exceeded")
	}

	// Send output
	bnk := banker.NewBanker(banker.BankerTypeRealmSend)
	realmAddr := runtime.CurrentRealm().Address()

	var denomOut string
	if zeroForOne {
		denomOut = pool.DenomB
	} else {
		denomOut = pool.DenomA
	}

	bnk.SendCoins(realmAddr, caller, chain.NewCoins(chain.NewCoin(denomOut, amountOut)))

	return amountOut
}

// =============================================================================
// COLLECT FEES
// =============================================================================

func CollectFees(_ realm, positionID uint64) (int64, int64) {
	if positionID >= uint64(len(positions)) {
		panic("position not found")
	}

	pos := positions[positionID]
	caller := string(runtime.OriginCaller())

	if pos.Owner != caller {
		panic("not owner")
	}

	pool := pools[pos.PoolID]

	// Calculate fees owed since last collection
	// Only collect fees if position is/was in range
	var feesA, feesB int64

	if pos.Liquidity > 0 {
		// Calculate accumulated fees based on fee growth difference
		feeGrowthDeltaA := pool.FeeGrowthA - pos.FeeGrowthLastA
		feeGrowthDeltaB := pool.FeeGrowthB - pos.FeeGrowthLastB

		feesA = (feeGrowthDeltaA * pos.Liquidity) / PRECISION
		feesB = (feeGrowthDeltaB * pos.Liquidity) / PRECISION

		// Update position's last fee growth snapshot
		pos.FeeGrowthLastA = pool.FeeGrowthA
		pos.FeeGrowthLastB = pool.FeeGrowthB
	}

	// Add any previously uncollected tokens
	feesA += pos.TokensOwedA
	feesB += pos.TokensOwedB
	pos.TokensOwedA = 0
	pos.TokensOwedB = 0

	// Send fees to owner
	if feesA > 0 || feesB > 0 {
		bnk := banker.NewBanker(banker.BankerTypeRealmSend)
		realmAddr := runtime.CurrentRealm().Address()
		callerAddr := runtime.OriginCaller()

		if feesA > 0 && feesB > 0 {
			coins := chain.NewCoins(
				chain.NewCoin(pool.DenomA, feesA),
				chain.NewCoin(pool.DenomB, feesB),
			)
			bnk.SendCoins(realmAddr, callerAddr, coins)
		} else if feesA > 0 {
			bnk.SendCoins(realmAddr, callerAddr, chain.NewCoins(chain.NewCoin(pool.DenomA, feesA)))
		} else {
			bnk.SendCoins(realmAddr, callerAddr, chain.NewCoins(chain.NewCoin(pool.DenomB, feesB)))
		}
	}

	return feesA, feesB
}

// GetPositionFees returns uncollected fees for a position
func GetPositionFees(positionID uint64) (int64, int64) {
	if positionID >= uint64(len(positions)) {
		return 0, 0
	}

	pos := positions[positionID]
	pool := pools[pos.PoolID]

	var feesA, feesB int64

	if pos.Liquidity > 0 {
		feeGrowthDeltaA := pool.FeeGrowthA - pos.FeeGrowthLastA
		feeGrowthDeltaB := pool.FeeGrowthB - pos.FeeGrowthLastB

		feesA = (feeGrowthDeltaA * pos.Liquidity) / PRECISION
		feesB = (feeGrowthDeltaB * pos.Liquidity) / PRECISION
	}

	feesA += pos.TokensOwedA
	feesB += pos.TokensOwedB

	return feesA, feesB
}

// =============================================================================
// TICK HELPERS
// =============================================================================

func updateTick(poolID uint64, tick int64, liquidityDelta int64, isLower bool) {
	ticks := tickData[poolID]
	if ticks == nil {
		ticks = make(map[int64]*TickInfo)
		tickData[poolID] = ticks
	}

	info := ticks[tick]
	if info == nil {
		info = &TickInfo{}
		ticks[tick] = info
	}

	info.LiquidityGross += liquidityDelta

	if isLower {
		info.LiquidityNet += liquidityDelta
	} else {
		info.LiquidityNet -= liquidityDelta
	}

	info.Initialized = info.LiquidityGross > 0
}

// =============================================================================
// QUERIES
// =============================================================================

func GetCLMMPool(poolID uint64) (string, string, int64, int64, int64, int64, int64) {
	if poolID >= uint64(len(pools)) {
		panic("pool not found")
	}
	p := pools[poolID]
	return p.DenomA, p.DenomB, p.PriceX6, p.CurrentTick, p.Liquidity, p.FeeBPS, p.TickSpacing
}

func GetCLMMPoolCount() uint64 {
	return uint64(len(pools))
}

func GetPosition(positionID uint64) (uint64, string, int64, int64, int64) {
	if positionID >= uint64(len(positions)) {
		panic("position not found")
	}
	p := positions[positionID]
	return p.PoolID, p.Owner, p.TickLower, p.TickUpper, p.Liquidity
}

func GetPositionCount() uint64 {
	return uint64(len(positions))
}

func GetPositionsByOwner(owner string) []uint64 {
	var result []uint64
	for _, p := range positions {
		if p.Owner == owner && p.Liquidity > 0 {
			result = append(result, p.ID)
		}
	}
	return result
}

func GetQuote(poolID uint64, tokenIn string, amountIn int64) int64 {
	if poolID >= uint64(len(pools)) {
		return 0
	}

	pool := pools[poolID]
	if pool.Liquidity == 0 {
		return 0
	}

	feeAmount := (amountIn * pool.FeeBPS) / 10000
	amountAfterFee := amountIn - feeAmount

	if tokenIn == "A" {
		return (amountAfterFee * pool.PriceX6) / PRECISION
	} else if tokenIn == "B" {
		return (amountAfterFee * PRECISION) / pool.PriceX6
	}
	return 0
}

func GetPriceAtTick(tick int64) int64 {
	return getPriceAtTick(tick)
}

func GetTickAtPrice(priceX6 int64) int64 {
	return getTickAtPrice(priceX6)
}

func GetRealmAddress() string {
	return string(runtime.CurrentRealm().Address())
}

// =============================================================================
// RENDER
// =============================================================================

func Render(path string) string {
	var sb strings.Builder

	sb.WriteString("# Gnomo CLMM\n\n")
	sb.WriteString("**Address:** `" + string(runtime.CurrentRealm().Address()) + "`\n\n")

	if len(pools) == 0 {
		sb.WriteString("No pools yet.\n")
	} else {
		sb.WriteString("## Pools\n\n")
		for _, p := range pools {
			sb.WriteString("### Pool " + strconv.FormatUint(p.ID, 10) + "\n")
			sb.WriteString("- Pair: " + formatDenom(p.DenomA) + "/" + formatDenom(p.DenomB) + "\n")
			sb.WriteString("- Fee: " + strconv.FormatInt(p.FeeBPS, 10) + " bps\n")
			sb.WriteString("- Tick: " + strconv.FormatInt(p.CurrentTick, 10) + "\n")
			sb.WriteString("- Liquidity: " + strconv.FormatInt(p.Liquidity, 10) + "\n")
			priceFloat := float64(p.PriceX6) / float64(PRECISION)
			sb.WriteString("- Price: " + strconv.FormatFloat(priceFloat, 'f', 6, 64) + "\n\n")
		}
	}

	sb.WriteString("## Stats\n")
	sb.WriteString("- Pools: " + strconv.Itoa(len(pools)) + "\n")

	activePos := 0
	for _, p := range positions {
		if p.Liquidity > 0 {
			activePos++
		}
	}
	sb.WriteString("- Positions: " + strconv.Itoa(activePos) + "\n")

	return sb.String()
}

func formatDenom(denom string) string {
	if denom == "ugnot" {
		return "GNOT"
	}
	if strings.Contains(denom, ":") {
		parts := strings.Split(denom, ":")
		return strings.ToUpper(parts[len(parts)-1])
	}
	return denom
}
