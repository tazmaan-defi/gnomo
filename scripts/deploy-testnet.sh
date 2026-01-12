#!/bin/bash
# Deploy Gnomo DEX contracts to Gno Testnet 5
#
# Prerequisites:
# 1. gnokey installed
# 2. A key with testnet funds (get from faucet: https://faucet.gno.land)
# 3. Set GNOKEY_NAME to your key name

set -e

# Configuration
GNOKEY_NAME="${GNOKEY_NAME:-devkey}"
# Staging is recommended (stable, accessible)
# Alternative: test9 at https://rpc.test9.testnets.gno.land:443
TESTNET_RPC="${TESTNET_RPC:-https://rpc.gno.land:443}"
CHAIN_ID="${CHAIN_ID:-staging}"
GAS_FEE="10000000ugnot"
GAS_WANTED="50000000"

# Package paths for testnet (customize these - must be unique!)
GNOMO_PKG_PATH="${GNOMO_PKG_PATH:-gno.land/r/gnomo/dex}"
CLMM_PKG_PATH="${CLMM_PKG_PATH:-gno.land/r/gnomo/clmm}"

# Get the key address
KEY_ADDRESS=$(gnokey list | grep "$GNOKEY_NAME" | grep -oP 'addr: \K[^\s]+')

if [ -z "$KEY_ADDRESS" ]; then
    echo "Error: Could not find key '$GNOKEY_NAME'"
    echo "Available keys:"
    gnokey list
    exit 1
fi

echo "========================================"
echo "Gnomo DEX Testnet Deployment"
echo "========================================"
echo "Key: $GNOKEY_NAME"
echo "Address: $KEY_ADDRESS"
echo "RPC: $TESTNET_RPC"
echo ""

# Check balance
echo "Checking balance..."
gnokey query bank/balances/$KEY_ADDRESS --remote $TESTNET_RPC || echo "Could not query balance"
echo ""

read -p "Continue with deployment? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

# Deploy V2 AMM (gnomo)
echo ""
echo "========================================"
echo "Deploying V2 AMM contract..."
echo "========================================"

cd "$(dirname "$0")/../r/gnomo"

gnokey maketx addpkg \
    --pkgpath "$GNOMO_PKG_PATH" \
    --pkgdir "." \
    --deposit "1ugnot" \
    --gas-fee "$GAS_FEE" \
    --gas-wanted "$GAS_WANTED" \
    --broadcast \
    --chainid $CHAIN_ID \
    --remote "$TESTNET_RPC" \
    "$GNOKEY_NAME"

echo "V2 AMM deployed to: $GNOMO_PKG_PATH"
echo ""

# Deploy CLMM
echo "========================================"
echo "Deploying CLMM contract..."
echo "========================================"

cd "$(dirname "$0")/../r/clmm"

gnokey maketx addpkg \
    --pkgpath "$CLMM_PKG_PATH" \
    --pkgdir "." \
    --deposit "1ugnot" \
    --gas-fee "$GAS_FEE" \
    --gas-wanted "$GAS_WANTED" \
    --broadcast \
    --chainid $CHAIN_ID \
    --remote "$TESTNET_RPC" \
    "$GNOKEY_NAME"

echo "CLMM deployed to: $CLMM_PKG_PATH"
echo ""

echo "========================================"
echo "Deployment Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Update Vercel environment variables:"
echo "   NEXT_PUBLIC_RPC_URL=$TESTNET_RPC"
echo "   NEXT_PUBLIC_CHAIN_ID=test5"
echo "   NEXT_PUBLIC_CHAIN_NAME=Gno Testnet 5"
echo "   NEXT_PUBLIC_GNOMO_PKG_PATH=$GNOMO_PKG_PATH"
echo "   NEXT_PUBLIC_CLMM_PKG_PATH=$CLMM_PKG_PATH"
echo ""
echo "2. Deploy frontend to Vercel"
echo "3. Test the app at your Vercel URL"
