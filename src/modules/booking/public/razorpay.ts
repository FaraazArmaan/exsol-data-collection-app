export interface RazorpayCheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: 'INR';
  name: string;
  prefill: { name: string; contact: string; email?: string };
  handler: () => void;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window { Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void } }
}

let loading: Promise<void> | null = null;

export function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('razorpay_unavailable'));
    script.onerror = () => reject(new Error('razorpay_load_failed'));
    document.head.appendChild(script);
  });
  return loading;
}
