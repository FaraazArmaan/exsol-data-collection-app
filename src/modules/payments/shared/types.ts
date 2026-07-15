export interface PaymentsDashboard {
  status: 'foundation';
  message: string;
  capabilities: {
    cashReceipts: boolean;
    onlineCollection: boolean;
    refunds: boolean;
    reconciliation: boolean;
  };
}

export interface PaymentProviderConnection {
  provider: 'razorpay';
  mode: 'test';
  enabled: boolean;
  configured: boolean;
  key_id_configured: boolean;
  api_secret_configured: boolean;
  webhook_secret_configured: boolean;
  updated_at: string | null;
}
