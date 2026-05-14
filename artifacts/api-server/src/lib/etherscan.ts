const ETHERSCAN_API = "https://api.etherscan.io/api";
const USDT_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const USDT_DECIMALS = 6;
const REQUIRED_CONFIRMATIONS = 6;

export interface EtherscanTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol: string;
  tokenDecimal: string;
  confirmations: string;
  timeStamp: string;
  blockNumber: string;
}

function getApiKey(): string {
  return process.env.ETHERSCAN_API_KEY || "";
}

function usdtToRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDT_DECIMALS));
}

/** Tolerance: ±1 cent in USDT raw value */
function amountMatches(rawValue: string, expectedUsdt: number): boolean {
  const raw = BigInt(rawValue);
  const expected = usdtToRaw(expectedUsdt);
  const tolerance = BigInt(10000); // 0.01 USDT
  return raw >= expected - tolerance && raw <= expected + tolerance;
}

export async function getTransactionByHash(txHash: string): Promise<{
  ok: boolean;
  confirmations: number;
  from: string;
  to: string;
  value: string;
  error?: string;
}> {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, confirmations: 0, from: "", to: "", value: "", error: "No API key" };

  try {
    const url = new URL(ETHERSCAN_API);
    url.searchParams.set("module", "proxy");
    url.searchParams.set("action", "eth_getTransactionByHash");
    url.searchParams.set("txhash", txHash);
    url.searchParams.set("apikey", apiKey);

    const txRes = await fetch(url.toString());
    const txData = await txRes.json() as any;
    const tx = txData.result;
    if (!tx) return { ok: false, confirmations: 0, from: "", to: "", value: "", error: "TX not found" };

    // Get current block for confirmation count
    const blockUrl = new URL(ETHERSCAN_API);
    blockUrl.searchParams.set("module", "proxy");
    blockUrl.searchParams.set("action", "eth_blockNumber");
    blockUrl.searchParams.set("apikey", apiKey);
    const blockRes = await fetch(blockUrl.toString());
    const blockData = await blockRes.json() as any;
    const currentBlock = parseInt(blockData.result, 16);
    const txBlock = parseInt(tx.blockNumber, 16);
    const confirmations = isNaN(txBlock) ? 0 : Math.max(0, currentBlock - txBlock);

    return {
      ok: true,
      confirmations,
      from: (tx.from as string).toLowerCase(),
      to: (tx.to as string).toLowerCase(),
      value: tx.value as string,
    };
  } catch (err) {
    return { ok: false, confirmations: 0, from: "", to: "", value: "", error: String(err) };
  }
}

export async function findMatchingUsdtTransfer(
  walletAddress: string,
  expectedAmountUsdt: number,
  afterTimestamp?: number
): Promise<{ found: boolean; txHash?: string; confirmations?: number; error?: string }> {
  const apiKey = getApiKey();
  if (!apiKey) return { found: false, error: "ETHERSCAN_API_KEY not configured — manual verification active" };

  try {
    const url = new URL(ETHERSCAN_API);
    url.searchParams.set("module", "account");
    url.searchParams.set("action", "tokentx");
    url.searchParams.set("contractaddress", USDT_CONTRACT);
    url.searchParams.set("address", walletAddress.toLowerCase());
    url.searchParams.set("sort", "desc");
    url.searchParams.set("page", "1");
    url.searchParams.set("offset", "50");
    url.searchParams.set("apikey", apiKey);

    const res = await fetch(url.toString());
    const data = await res.json() as any;

    if (data.status !== "1" || !Array.isArray(data.result)) {
      return { found: false, error: data.message || "No transactions found" };
    }

    const txs: EtherscanTx[] = data.result;
    const walletLower = walletAddress.toLowerCase();

    // Filter: incoming USDT transfers to our wallet, after the invoice was created
    const cutoff = afterTimestamp ? afterTimestamp / 1000 : 0;
    const match = txs.find(tx =>
      tx.to.toLowerCase() === walletLower &&
      tx.tokenSymbol === "USDT" &&
      amountMatches(tx.value, expectedAmountUsdt) &&
      parseInt(tx.timeStamp) >= cutoff - 300 // 5 min grace period
    );

    if (!match) return { found: false };

    const confirmations = parseInt(match.confirmations);
    return {
      found: true,
      txHash: match.hash,
      confirmations,
    };
  } catch (err) {
    return { found: false, error: String(err) };
  }
}

export { REQUIRED_CONFIRMATIONS };
