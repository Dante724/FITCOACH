import { api } from "@/lib/api";

export function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

// Creates an order, opens Razorpay checkout, verifies the signature on success.
export async function payWithRazorpay({ orderPayload, user, onSuccess, onError }) {
  try {
    const ok = await loadRazorpayScript();
    if (!ok) throw new Error("Could not load the payment gateway.");
    const { data } = await api.post("/payments/order", orderPayload);
    const rzp = new window.Razorpay({
      key: data.key_id,
      amount: data.amount,
      currency: data.currency,
      name: "FitCoach",
      description: { plan: "Membership", pack: "Session pack", session: "Training session" }[orderPayload.type] || "FitCoach",
      order_id: data.order_id,
      prefill: { name: user?.name || "", email: user?.email || "" },
      theme: { color: "#0f4a3a" },
      handler: async (res) => {
        try {
          await api.post("/payments/verify", {
            razorpay_order_id: res.razorpay_order_id,
            razorpay_payment_id: res.razorpay_payment_id,
            razorpay_signature: res.razorpay_signature,
          });
          onSuccess && onSuccess();
        } catch (e) {
          onError && onError(e);
        }
      },
      modal: { ondismiss: () => onError && onError(new Error("Payment cancelled.")) },
    });
    rzp.open();
  } catch (e) {
    onError && onError(e);
  }
}

// Auto-renewing membership: create a Razorpay subscription, open checkout, verify the first charge.
export async function subscribeWithRazorpay({ planId, user, onSuccess, onError }) {
  try {
    const ok = await loadRazorpayScript();
    if (!ok) throw new Error("Could not load the payment gateway.");
    const { data } = await api.post("/payments/subscription", { plan_id: planId });
    const rzp = new window.Razorpay({
      key: data.key_id,
      subscription_id: data.subscription_id,
      name: "FitCoach",
      description: `${data.plan_name} · renews automatically`,
      prefill: { name: user?.name || "", email: user?.email || "" },
      theme: { color: "#0f4a3a" },
      handler: async (res) => {
        try {
          await api.post("/payments/subscription/verify", {
            razorpay_payment_id: res.razorpay_payment_id,
            razorpay_subscription_id: res.razorpay_subscription_id,
            razorpay_signature: res.razorpay_signature,
          });
          onSuccess && onSuccess();
        } catch (e) {
          onError && onError(e);
        }
      },
      modal: { ondismiss: () => onError && onError(new Error("Payment cancelled.")) },
    });
    rzp.open();
  } catch (e) {
    onError && onError(e);
  }
}
