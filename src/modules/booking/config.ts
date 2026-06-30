// Feature flags for the booking module FE.
//
// ONLINE_PAYMENTS_ENABLED gates the deposit / full_upfront service payment modes.
// Keep false until Razorpay is wired in prod (live order-create + Checkout JS); the
// storefront checkout for those modes currently ends at a "payment not enabled yet"
// placeholder, so vendors shouldn't be able to create such services meanwhile.
// Flip to true in the same change that ships the Razorpay integration.
export const ONLINE_PAYMENTS_ENABLED = false;
