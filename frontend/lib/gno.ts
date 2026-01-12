// frontend/lib/gno.ts
// Gno RPC client helpers for Gnomo DEX

// Environment-based configuration for local dev vs testnet
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:26657";
export const PKG_PATH = process.env.NEXT_PUBLIC_GNOMO_PKG_PATH || "gno.land/r/dev/gnomo";

function stringToHex(str: string): string {
  return Array.from(str)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

function decodeBase64(base64: string): string {
  if (typeof window !== "undefined") return atob(base64);
  return Buffer.from(base64, "base64").toString("utf-8");
}

async function abciQuery(path: string, dataStr: string): Promise<string> {
  const hexData = stringToHex(dataStr);
  const url = `${RPC_URL}/abci_query?path="${encodeURIComponent(path)}"&data=0x${hexData}`;

  const res = await fetch(url);
  const json = await res.json();

  const dataB64 = json?.result?.response?.ResponseBase?.Data;
  if (!dataB64) return "";

  return decodeBase64(dataB64);
}

export async function queryRender(path: string = ""): Promise<string> {
  return abciQuery("vm/qrender", `${PKG_PATH}:${path}`);
}

export async function queryEval(expr: string): Promise<string> {
  return abciQuery("vm/qeval", `${PKG_PATH}.${expr}`);
}

export type PoolInfo = {
  id: number;
  poolID: number;
  denomA: string;
  denomB: string;
  reserveA: bigint;
  reserveB: bigint;
  totalLP: bigint;
  feeBps: number;
  feeBPS: bigint;
};

function parseFirstInt(str: string): number {
  const m = str.match(/\(\s*(-?\d+)\s+(?:u?int(?:64)?)\s*\)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function parseFirstBigInt(str: string): bigint {
  const m = str.match(/\(\s*(-?\d+)\s+(?:u?int(?:64)?)\s*\)/i);
  return m ? BigInt(m[1]) : 0n;
}

export async function getPoolCount(): Promise<number> {
  const out = await queryEval("GetPoolCount()");
  return parseFirstInt(out);
}

export async function getPool(poolID: number): Promise<PoolInfo | null> {
  const out = await queryEval(`GetPool(${poolID})`);

  const strMatches = Array.from(out.matchAll(/\(\s*"([^"]+)"\s+string\s*\)/g)).map((m) => m[1]);
  const intMatches = Array.from(out.matchAll(/\(\s*(-?\d+)\s+(?:u?int(?:64)?)\s*\)/gi)).map((m) => m[1]);

  if (strMatches.length < 2 || intMatches.length < 4) {
    return null;
  }

  const denomA = strMatches[0];
  const denomB = strMatches[1];
  const reserveA = BigInt(intMatches[0]);
  const reserveB = BigInt(intMatches[1]);
  const totalLP = BigInt(intMatches[2]);
  const feeBps = parseInt(intMatches[3], 10);

  return { 
    id: poolID, 
    poolID, 
    denomA, 
    denomB, 
    reserveA, 
    reserveB, 
    totalLP, 
    feeBps,
    feeBPS: BigInt(feeBps)
  };
}

export async function getAllPools(): Promise<PoolInfo[]> {
  const count = await getPoolCount();
  const pools: PoolInfo[] = [];
  for (let i = 0; i < count; i++) {
    const p = await getPool(i);
    if (p) pools.push(p);
  }
  return pools;
}

export async function getQuote(poolID: number, tokenIn: "A" | "B", amountIn: bigint): Promise<bigint> {
  const out = await queryEval(`GetQuote(${poolID}, "${tokenIn}", ${amountIn.toString()})`);
  return parseFirstBigInt(out);
}

// Get user's LP token balance for a specific pool
export async function getLPBalance(poolID: number, address: string): Promise<bigint> {
  const out = await queryEval(`GetLPBalance(${poolID}, "${address}")`);
  return parseFirstBigInt(out);
}

// Get LP balances for all pools for a user
export async function getAllLPBalances(address: string, poolCount: number): Promise<Map<number, bigint>> {
  const balances = new Map<number, bigint>();
  for (let i = 0; i < poolCount; i++) {
    const balance = await getLPBalance(i, address);
    if (balance > 0n) {
      balances.set(i, balance);
    }
  }
  return balances;
}

// ---------------------- UI compatibility helpers ----------------------

type DenomLike =
  | string
  | { denom?: unknown; Denom?: unknown }
  | null
  | undefined;

type AmountLike =
  | bigint
  | number
  | string
  | { amount?: unknown; Amount?: unknown }
  | null
  | undefined;

function normalizeDenom(d: DenomLike): string {
  if (typeof d === "string") return d;
  if (d && typeof d === "object") {
    const v = (d as any).denom ?? (d as any).Denom;
    if (typeof v === "string") return v;
    if (v != null) return String(v);
  }
  return "";
}

function normalizeAmount(a: AmountLike): bigint {
  if (typeof a === "bigint") return a;
  if (typeof a === "number") return BigInt(Math.trunc(a));
  if (typeof a === "string") {
    const m = a.match(/-?\d+/);
    return BigInt(m ? m[0] : "0");
  }
  if (a && typeof a === "object") {
    const v = (a as any).amount ?? (a as any).Amount;
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string") {
      const m = v.match(/-?\d+/);
      return BigInt(m ? m[0] : "0");
    }
    if (v != null) {
      const m = String(v).match(/-?\d+/);
      return BigInt(m ? m[0] : "0");
    }
  }
  return 0n;
}

export function formatDenom(denomLike: DenomLike): string {
  const denom = normalizeDenom(denomLike);
  if (!denom) return "";

  const last = denom.includes(":") ? denom.split(":").pop()! : denom;

  if (last === "ugnot") return "GNOT";
  return last.toUpperCase();
}

function decimalsForDenom(denomLike: DenomLike): number {
  const denom = normalizeDenom(denomLike);
  if (!denom) return 6; // default to 6 decimals
  const d = denom.toLowerCase();

  if (d.includes("usdc")) return 6;

  const last = d.includes(":") ? d.split(":").pop()! : d;
  if (last.startsWith("u")) return 6;

  return 6; // default to 6 for LP tokens and others
}

export function formatAmount(
  amountLike: AmountLike,
  denomLike: DenomLike,
  maxFrac = 6
): string {
  const amount = normalizeAmount(amountLike);
  const dec = decimalsForDenom(denomLike);

  const neg = amount < 0n;
  const v = neg ? -amount : amount;

  if (dec === 0) return `${neg ? "-" : ""}${v.toString()}`;

  const base = 10n ** BigInt(dec);
  const whole = v / base;
  const fracRaw = (v % base).toString().padStart(dec, "0");
  const frac = fracRaw.slice(0, Math.min(dec, maxFrac)).replace(/0+$/, "");

  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

export function calculatePrice(
  reserveA: AmountLike,
  reserveB: AmountLike,
  denomA: DenomLike,
  denomB: DenomLike,
  precision = 12
): number {
  const a = normalizeAmount(reserveA);
  const b = normalizeAmount(reserveB);
  if (a === 0n) return 0;

  const decA = decimalsForDenom(denomA);
  const decB = decimalsForDenom(denomB);

  const scaleA = 10n ** BigInt(decA);
  const scaleB = 10n ** BigInt(decB);

  const prec = 10n ** BigInt(Math.max(0, Math.min(18, precision)));
  const numerator = b * scaleA * prec;
  const denominator = a * scaleB;

  if (denominator === 0n) return 0;

  const scaled = numerator / denominator;
  const asNumber = Number(scaled) / Number(prec);

  if (!Number.isFinite(asNumber)) return 0;

  return asNumber;
}
