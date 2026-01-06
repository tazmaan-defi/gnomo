// frontend/lib/gno.ts
// Gno RPC client helpers for Gnomo DEX

export const RPC_URL = "http://127.0.0.1:26657";
export const PKG_PATH = "gno.land/r/dev/gnomo";

function stringToHex(str: string): string {
  return Array.from(str)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
}

function decodeBase64(base64: string): string {
  if (typeof window !== "undefined") return atob(base64);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

/**
 * qrender expects: "<pkgpath>:<path>"  (note the colon)
 */
export async function queryRender(path: string = ""): Promise<string> {
  return abciQuery("vm/qrender", `${PKG_PATH}:${path}`);
}

/**
 * qeval expects: "<pkgpath>.<expression>"  (note the dot)
 * Example: "gno.land/r/dev/gnomo.GetPoolCount()"
 */
export async function queryEval(expr: string): Promise<string> {
  return abciQuery("vm/qeval", `${PKG_PATH}.${expr}`);
}

export type PoolInfo = {
  id: number;
  denomA: string;
  denomB: string;
  reserveA: bigint;
  reserveB: bigint;
  totalLP: bigint;
  feeBps: bingint;
};

function parseFirstInt(str: string): number {
  // Matches "(1 uint64)" or "(30 int64)"
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

  // Newline format like:
  // ("/gno.land/r/dev/gnomo:usdc" string)
  // ("ugnot" string)
  // (2000000 int64)
  // (1000000 int64)
  // (1414213 int64)
  // (30 int64)

  const strMatches = Array.from(out.matchAll(/\(\s*"([^"]+)"\s+string\s*\)/g)).map((m) => m[1]);
  const intMatches = Array.from(out.matchAll(/\(\s*(-?\d+)\s+(?:u?int(?:64)?)\s*\)/gi)).map((m) => m[1]);

  if (strMatches.length < 2 || intMatches.length < 4) {
    // If this happens, paste `out` and we’ll adjust parser.
    return null;
  }

  const denomA = strMatches[0];
  const denomB = strMatches[1];

  // ints are: reserveA, reserveB, totalLP, feeBps (in that order)
  const reserveA = BigInt(intMatches[0]);
  const reserveB = BigInt(intMatches[1]);
  const totalLP = BigInt(intMatches[2]);
  const feeBps = parseInt(intMatches[3], 10);

  return { id: poolID, poolID, denomA, denomB, reserveA, reserveB, totalLP, feeBps, fee: feeBps, feeBPS: BigInt(feeBps), };
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

/**
 * Assumes your realm has GetQuote(poolID, tokenIn, amountIn) -> int64
 * tokenIn should be "A" or "B"
 */
export async function getQuote(poolID: number, tokenIn: "A" | "B", amountIn: bigint): Promise<bigint> {
  const out = await queryEval(`GetQuote(${poolID}, "${tokenIn}", ${amountIn.toString()})`);
  return parseFirstBigInt(out);
}

// ---------------------- UI compatibility helpers ----------------------
// Your app/page.tsx expects these exports.

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
    // allow "12345" or "12345ugnot" style accidental strings
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
  // examples:
  // "/gno.land/r/dev/gnomo:usdc" -> "usdc"
  // "ugnot" -> "GNOT"
  const denom = normalizeDenom(denomLike);
  if (!denom) return "";

  const last = denom.includes(":") ? denom.split(":").pop()! : denom;

  if (last === "ugnot") return "GNOT";
  return last.toUpperCase();
}

function decimalsForDenom(denomLike: DenomLike): number {
  // Keep it simple & predictable:
  // - micro units like ugnot -> 6
  // - usdc -> 6
  // - otherwise 0
  const denom = normalizeDenom(denomLike);
  const d = denom.toLowerCase();

  if (d.includes("usdc")) return 6;

  const last = d.includes(":") ? d.split(":").pop()! : d;
  if (last.startsWith("u")) return 6;

  return 0;
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

/**
 * Price helper for UI.
 * Returns price of tokenB per tokenA (i.e., how many B for 1 A)
 * using reserves + denom decimals.
 */
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

  // price = (reserveB / 10^decB) / (reserveA / 10^decA)
  //       = reserveB * 10^decA / (reserveA * 10^decB)
  const scaleA = 10n ** BigInt(decA);
  const scaleB = 10n ** BigInt(decB);

  // Use integer math with a precision multiplier, then convert to number.
  // result = (b * scaleA / (a * scaleB))
  // to preserve precision: multiply numerator by 10^precision first.
  const prec = 10n ** BigInt(Math.max(0, Math.min(18, precision))); // clamp to avoid huge numbers
  const numerator = b * scaleA * prec;
  const denominator = a * scaleB;

  if (denominator === 0n) return 0;

  const scaled = numerator / denominator; // bigint
  const asNumber = Number(scaled) / Number(prec);

  // Guard against Number overflow -> Infinity
  if (!Number.isFinite(asNumber)) return 0;

  return asNumber;
}
