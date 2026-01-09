// Adena Wallet Integration for Gnomo DEX
// Adena is the primary wallet for Gno.land

declare global {
  interface Window {
    adena?: AdenaWallet;
  }
}

interface AdenaWallet {
  AddEstablish: (name: string) => Promise<AdenaResponse>;
  GetAccount: () => Promise<AdenaAccountResponse>;
  DoContract: (params: DoContractParams) => Promise<AdenaResponse>;
  Sign: (params: SignParams) => Promise<AdenaSignResponse>;
  SwitchNetwork: (chainId: string) => Promise<AdenaResponse>;
  AddNetwork: (network: NetworkConfig) => Promise<AdenaResponse>;
}

interface AdenaResponse {
  code: number;
  status: 'success' | 'failure';
  type: string;
  message: string;
  data?: unknown;
}

interface AdenaAccountResponse extends AdenaResponse {
  data?: {
    accountNumber: string;
    address: string;
    coins: string;
    chainId: string;
    sequence: string;
    status: 'ACTIVE' | 'INACTIVE';
    publicKey: {
      '@type': string;
      value: string;
    };
  };
}

interface AdenaSignResponse extends AdenaResponse {
  data?: {
    encodedTransaction: string;
  };
}

interface DoContractParams {
  messages: ContractMessage[];
  gasFee: number;
  gasWanted: number;
  memo?: string;
}

interface ContractMessage {
  type: '/vm.m_call';
  value: {
    caller: string;
    send: string;
    pkg_path: string;
    func: string;
    args: string[];
  };
}

interface SignParams {
  messages: ContractMessage[];
  gasFee: number;
  gasWanted: number;
  memo?: string;
}

interface NetworkConfig {
  chainId: string;
  chainName: string;
  rpcUrl: string;
}

// Check if Adena is installed
export function isAdenaInstalled(): boolean {
  return typeof window !== 'undefined' && !!window.adena;
}

// Connect to Adena wallet
export async function connectAdena(): Promise<string | null> {
  if (!isAdenaInstalled()) {
    window.open('https://adena.app/', '_blank');
    throw new Error('Adena wallet not installed. Please install it first.');
  }

  try {
    const response = await window.adena!.AddEstablish('Gnomo DEX');
    
    // Code 0 = success, Code 4001 = already connected (both are fine)
    if (response.code !== 0 && response.code !== 4001) {
      throw new Error(response.message || 'Failed to connect to Adena');
    }

    // Get account info after connecting
    const account = await getAdenaAccount();
    return account?.address || null;
  } catch (error: any) {
    // Handle "already connected" message gracefully
    if (error?.message?.includes('already connected')) {
      const account = await getAdenaAccount();
      return account?.address || null;
    }
    console.error('Adena connection error:', error);
    throw error;
  }
}

// Get connected account
export async function getAdenaAccount(): Promise<AdenaAccountResponse['data'] | null> {
  if (!isAdenaInstalled()) {
    return null;
  }

  try {
    const response = await window.adena!.GetAccount();
    
    if (response.code !== 0 || !response.data) {
      return null;
    }

    return response.data;
  } catch (error) {
    console.error('Failed to get Adena account:', error);
    return null;
  }
}

// Switch to local dev network
export async function switchToDevNetwork(): Promise<boolean> {
  if (!isAdenaInstalled()) {
    return false;
  }

  try {
    // First try to add the network
    await window.adena!.AddNetwork({
      chainId: 'dev',
      chainName: 'Gno Dev Local',
      rpcUrl: 'http://127.0.0.1:26657',
    });
  } catch (e) {
    // Network might already exist, that's fine
  }

  try {
    const response = await window.adena!.SwitchNetwork('dev');
    return response.code === 0;
  } catch (error) {
    console.error('Failed to switch network:', error);
    return false;
  }
}

// Execute a contract call (swap, add liquidity, etc.)
export async function executeContract(params: {
  caller: string;
  pkgPath: string;
  func: string;
  args: string[];
  send?: string; // e.g., "1000000ugnot" or "1000000ugnot,2000000/gno.land/r/dev/gnomo:usdc"
  gasFee?: number;
  gasWanted?: number;
  memo?: string;
}): Promise<AdenaResponse> {
  if (!isAdenaInstalled()) {
    throw new Error('Adena wallet not installed');
  }

  const message: ContractMessage = {
    type: '/vm.m_call',
    value: {
      caller: params.caller,
      send: params.send || '',
      pkg_path: params.pkgPath,
      func: params.func,
      args: params.args,
    },
  };

  try {
    const response = await window.adena!.DoContract({
      messages: [message],
      gasFee: params.gasFee || 1000000,
      gasWanted: params.gasWanted || 5000000,
      memo: params.memo || '',
    });

    return response;
  } catch (error) {
    console.error('Contract execution error:', error);
    throw error;
  }
}

// ==================== DEX-specific functions ====================

const PKG_PATH = 'gno.land/r/dev/gnomo';

// Swap tokens
export async function swap(params: {
  caller: string;
  poolId: number;
  tokenIn: 'A' | 'B';
  amountIn: bigint;
  minAmountOut: bigint;
  denomIn: string;
}): Promise<AdenaResponse> {
  // Format the send string based on which token we're sending
  const sendStr = `${params.amountIn}${params.denomIn}`;

  return executeContract({
    caller: params.caller,
    pkgPath: PKG_PATH,
    func: 'Swap',
    args: [
      params.poolId.toString(),
      params.tokenIn,
      params.minAmountOut.toString(),
    ],
    send: sendStr,
    gasWanted: 5000000,
    gasFee: 1000000,
  });
}

// Add liquidity
export async function addLiquidity(params: {
  caller: string;
  poolId: number;
  amountA: bigint;
  amountB: bigint;
  denomA: string;
  denomB: string;
}): Promise<AdenaResponse> {
  // Format send string with both tokens
  const sendStr = `${params.amountA}${params.denomA},${params.amountB}${params.denomB}`;

  return executeContract({
    caller: params.caller,
    pkgPath: PKG_PATH,
    func: 'AddLiquidity',
    args: [params.poolId.toString()],
    send: sendStr,
    gasWanted: 5000000,
    gasFee: 1000000,
  });
}

// Remove liquidity
export async function removeLiquidity(params: {
  caller: string;
  poolId: number;
  lpAmount: bigint;
}): Promise<AdenaResponse> {
  return executeContract({
    caller: params.caller,
    pkgPath: PKG_PATH,
    func: 'RemoveLiquidity',
    args: [params.poolId.toString(), params.lpAmount.toString()],
    gasWanted: 5000000,
    gasFee: 1000000,
  });
}

// Create a new pool
export async function createPool(params: {
  caller: string;
  denomA: string;
  denomB: string;
  feeBps: number;
}): Promise<AdenaResponse> {
  return executeContract({
    caller: params.caller,
    pkgPath: PKG_PATH,
    func: 'CreatePool',
    args: [params.denomA, params.denomB, params.feeBps.toString()],
    gasWanted: 5000000,
    gasFee: 1000000,
  });
}

// Mint test tokens (for development)
export async function mintTestTokens(params: {
  caller: string;
  baseName: string;
  amount: bigint;
}): Promise<AdenaResponse> {
  return executeContract({
    caller: params.caller,
    pkgPath: PKG_PATH,
    func: 'MintTestTokens',
    args: [params.baseName, params.amount.toString()],
    gasWanted: 5000000,
    gasFee: 1000000,
  });
}

// Get user's token balances from Adena account
export async function getBalances(): Promise<Map<string, bigint>> {
  const balances = new Map<string, bigint>();
  
  const account = await getAdenaAccount();
  if (!account?.coins) return balances;
  
  // Parse coins string like "9999000000ugnot,8000000/gno.land/r/dev/gnomo:usdc"
  const coinStrings = account.coins.split(',');
  for (const coinStr of coinStrings) {
    const match = coinStr.trim().match(/^(\d+)(.+)$/);
    if (match) {
      const amount = BigInt(match[1]);
      const denom = match[2];
      balances.set(denom, amount);
    }
  }
  
  return balances;
}
