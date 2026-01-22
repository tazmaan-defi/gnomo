# Gnomo DEX - Production Readiness Checklist

## Contract Changes

### V2 AMM (`r/gnomo/gnomo.gno`)
- [ ] Remove `MintTestTokens` function (line 40) - dev/test only function that mints arbitrary tokens

### CLMM (`r/clmm/clmm.gno`)
- [x] Fix swap/quote scaling bug (sqrtPrecision*PRECISION → PRECISION) - **Fixed in clmm5**
- [x] Fix BurnPosition to return both tokens correctly - **Fixed in clmm5**
- [x] Add refund for unused tokens in MintPosition - **Fixed in clmm5**
- [ ] Security audit
- [ ] Gas optimization review

## Frontend Changes

### Token Decimal Support
- [ ] Query GRC20 token metadata to get decimals per token
- [ ] Cache decimals per denom
- [ ] Replace hardcoded `1_000_000` (6 decimals) with dynamic scaling
- [ ] Update `fmtAmt()` function to use token-specific decimals
- [ ] Update all input parsing to use token-specific decimals

### UI Cleanup
- [ ] Remove "Mint Test Tokens" button/functionality from dev tools
- [ ] Remove router debug console.log statements (added for debugging)
- [ ] Final UI/UX polish

## Testing
- [ ] Comprehensive test suite for V2 AMM
- [ ] Comprehensive test suite for CLMM
- [ ] Multi-hop routing tests
- [ ] Edge case testing (very small/large amounts, price extremes)

## Documentation
- [ ] Developer integration guide
- [ ] API/contract function reference
- [ ] Deployment guide

## Deployment
- [ ] Deploy production V2 contract (without MintTestTokens)
- [ ] Deploy production CLMM contract
- [ ] Update frontend environment variables
- [ ] Verify all functionality on mainnet

---

## Version History

| Version | Network | Contract Path | Notes |
|---------|---------|---------------|-------|
| clmm4 | staging | gno.land/r/gnomo/clmm4 | Buggy - scaling issues, BurnPosition bug |
| clmm5 | staging | gno.land/r/gnomo/clmm5 | Fixed scaling, refunds, BurnPosition |
| dex3 | staging | gno.land/r/gnomo/dex3 | Current V2, has MintTestTokens |
