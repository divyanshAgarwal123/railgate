// Thin Razorpay test-mode client. Raw fetch, no SDK — two endpoints don't need one.

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;

export function checkKeys(): void {
  if (!keyId || !keySecret || keyId.includes("xxxx")) {
    console.error(
      "Missing real Razorpay test-mode keys.\n" +
        "  1. Dashboard → Settings → API Keys → Generate Test Key\n" +
        "  2. cp .env.example .env and fill in RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET\n" +
        "  3. npm run day1  (or day2)",
    );
    process.exit(1);
  }
  if (!keyId.startsWith("rzp_test_")) {
    console.error("Refusing to run: Railgate accepts Razorpay test-mode keys only.");
    process.exit(1);
  }
}

async function post(path: string, body: unknown) {
  const auth = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

export interface RazorpayOrder {
  id: string;
  status: string;
}

export interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  status: string;
}

export async function createOrder(amountPaise: number, receipt: string): Promise<RazorpayOrder> {
  return post("orders", { amount: amountPaise, currency: "INR", receipt }) as Promise<RazorpayOrder>;
}

export async function createPaymentLink(
  amountPaise: number,
  description: string,
  referenceId: string,
): Promise<RazorpayPaymentLink> {
  return post("payment_links", {
    amount: amountPaise,
    currency: "INR",
    description,
    reference_id: referenceId,
    notify: { sms: false, email: false },
    reminder_enable: false,
  }) as Promise<RazorpayPaymentLink>;
}
