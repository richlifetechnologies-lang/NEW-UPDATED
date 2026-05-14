import crypto from "crypto";

const PAYMENTO_BASE = "https://api.paymento.io/v1";
const GATEWAY_URL = "https://app.paymento.io/gateway";

function getCredentials() {
  const apiKey = process.env.PAYMENTO_API_KEY;
  const apiSecret = process.env.PAYMENTO_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("PAYMENTO_API_KEY and PAYMENTO_API_SECRET must be set");
  return { apiKey, apiSecret };
}

export function buildGatewayUrl(token: string): string {
  return `${GATEWAY_URL}?token=${token}`;
}

export async function createPaymentRequest(opts: {
  fiatAmount: number;
  fiatCurrency: string;
  orderId: string;
  returnUrl: string;
  emailAddress?: string;
}): Promise<{ success: true; token: string } | { success: false; error: string }> {
  const { apiKey } = getCredentials();
  try {
    const body = {
      fiatAmount: opts.fiatAmount.toFixed(2),
      fiatCurrency: opts.fiatCurrency,
      orderId: opts.orderId,
      ReturnUrl: opts.returnUrl,
      Speed: 1,
      ...(opts.emailAddress ? { EmailAddress: opts.emailAddress } : {}),
    };
    const res = await fetch(`${PAYMENTO_BASE}/payment/request`, {
      method: "POST",
      headers: {
        "Api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "text/plain",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json() as any;
    if (data.success && data.body) {
      return { success: true, token: data.body };
    }
    return { success: false, error: data.message || data.error || "Unknown Paymento error" };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function verifyPaymentToken(token: string): Promise<{
  success: boolean;
  orderId?: string;
  token?: string;
  additionalData?: Array<{ key: string; value: string }>;
  error?: string;
}> {
  const { apiKey } = getCredentials();
  try {
    const res = await fetch(`${PAYMENTO_BASE}/payment/verify`, {
      method: "POST",
      headers: {
        "Api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "text/plain",
      },
      body: JSON.stringify({ token }),
    });
    const data = await res.json() as any;
    if (data.success && data.body) {
      return {
        success: true,
        token: data.body.token,
        orderId: data.body.orderId,
        additionalData: data.body.additionalData,
      };
    }
    return { success: false, error: data.message || data.error || "Verification failed" };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function verifyHmacSignature(rawBody: string, signature: string): boolean {
  try {
    const { apiSecret } = getCredentials();
    const calculated = crypto
      .createHmac("sha256", apiSecret)
      .update(rawBody)
      .digest("hex")
      .toUpperCase();
    return calculated === signature.toUpperCase();
  } catch {
    return false;
  }
}

export const ORDER_STATUS = {
  Initialize: 0,
  Pending: 1,
  PartialPaid: 2,
  WaitingToConfirm: 3,
  Timeout: 4,
  UserCanceled: 5,
  Paid: 7,
  Approve: 8,
  Reject: 9,
} as const;
