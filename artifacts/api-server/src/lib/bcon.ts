const BCON_BASE = "https://external-api.bcon.global/api";

function getApiKey(): string {
  const key = process.env.BCON_API_KEY;
  if (!key) throw new Error("BCON_API_KEY environment variable is not set");
  return key;
}

export interface BconAddressResult {
  success: true;
  address: string;
  paymentAmount: string;
  paymentCurrency: string;
}

export interface BconError {
  success: false;
  error: string;
}

/**
 * Create a unique per-payment receiving address via bcon.global.
 * bcon automatically calculates the crypto amount from the USD origin amount.
 */
export async function createPaymentAddress(opts: {
  originAmount: number;
  originCurrency?: string;
  externalId: string;
  paymentCurrency?: string;
  chain?: string;
}): Promise<BconAddressResult | BconError> {
  const apiKey = getApiKey();
  try {
    const body = {
      payment_currency: opts.paymentCurrency ?? "USDT",
      origin_amount: opts.originAmount.toFixed(2),
      origin_currency: opts.originCurrency ?? "USD",
      external_id: opts.externalId,
      chain: opts.chain ?? "tron",
    };

    const res = await fetch(`${BCON_BASE}/v2/address`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as any;

    if (data.status === "Ok" && data.data?.address) {
      return {
        success: true,
        address: data.data.address,
        paymentAmount: String(data.data.payment_amount ?? opts.originAmount),
        paymentCurrency: String(data.data.payment_currency ?? "USDT"),
      };
    }

    return {
      success: false,
      error: data.message ?? data.error ?? JSON.stringify(data),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Check transaction history for a wallet address.
 * Used to verify payment manually when webhook hasn't fired yet.
 */
export async function getAddressHistory(address: string): Promise<{
  success: boolean;
  transactions?: Array<{
    txid: string;
    status: string;
    sum: string;
    currency: string;
    createdAt: string;
  }>;
  error?: string;
}> {
  const apiKey = getApiKey();
  try {
    const res = await fetch(
      `${BCON_BASE}/v1/user/history?address=${encodeURIComponent(address)}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );

    const data = (await res.json()) as any;

    if (data.status === "Ok" && Array.isArray(data.data?.transactions)) {
      return {
        success: true,
        transactions: data.data.transactions.map((tx: any) => ({
          txid: tx.transaction_id,
          status: tx.status,
          sum: tx.sum,
          currency: tx.currency?.iso_name ?? String(tx.currency ?? ""),
          createdAt: tx.created_at,
        })),
      };
    }

    return { success: false, error: data.message ?? "No history returned" };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
