const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const currentTimestamp = Date.now().toString();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "x-agent-signature": "bypass_for_ui_demo",
    "x-timestamp": currentTimestamp,
    ...(options?.headers || {}),
  };

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  health: () => request<{ status: string }>("/api/health"),

  getAgent: (address: string) =>
    request<{
      name: string;
      address: string;
      score: number;
      transactionVolume: number;
      accountAgeDays: number;
      x402Reliability: number;
      failedPayments: number;
      totalPayments: number;
      passport: {
        agentType: string;
        modelHash: string;
        kiteIdentityStatus: "Verified" | "Pending" | "Unverified";
        registeredOn: string;
      };
    }>(`/api/agents/${encodeURIComponent(address)}`),

  getAgents: () =>
    request<Array<{
      address: string;
      name: string;
      score: number;
      agent_type: string;
    }>>("/api/agents"),

  registerAgent: (data: {
    address: string;
    name?: string;
    agent_type?: string;
    model_hash?: string;
  }) =>
    request("/api/agents", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getAgentTransactions: (address: string, limit = 20) =>
    request<Array<{
      id: string;
      from_address: string;
      to_address: string;
      amount: number;
      service_name: string;
      status: string;
      repayment_portion: number;
      agent_portion: number;
      created_at: string;
    }>>(`/api/agents/${encodeURIComponent(address)}/transactions?limit=${limit}`),

  getLoanTerms: (address: string) =>
    request<{
      eligible: boolean;
      maxLoan: number;
      interestRate: number;
      repaymentSplit: number;
      message?: string;
    }>(`/api/loans/terms/${encodeURIComponent(address)}`),

  requestLoan: (data: { borrower_address: string; amount: number }) =>
    request<{ loan: Record<string, unknown>; terms: Record<string, unknown> }>("/api/loans/borrow", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getLoans: (address: string) =>
    request<Array<Record<string, unknown>>>(`/api/loans/${encodeURIComponent(address)}`),

  getActiveLoan: (address: string) =>
    request<Record<string, unknown> | null>(`/api/loans/active/${encodeURIComponent(address)}`),

  getPoolStats: () =>
    request<{
      tvl: number;
      totalBorrowed: number;
      totalRepaid: number;
      totalInterestEarned: number;
      defaultRate: number;
      averageApy: number;
      activeLoans: number;
    }>("/api/pool"),

  deposit: (data: { lender_address: string; amount: number }) =>
    request("/api/lending/deposit", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  withdraw: (data: { lender_address: string; amount: number }) =>
    request("/api/lending/withdraw", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getLenderPosition: (address: string) =>
    request<{
      lender_address: string;
      deposited_amount: number;
      earned_interest: number;
    }>(`/api/lending/${encodeURIComponent(address)}`),

  recordTransaction: (data: {
    from_address: string;
    to_address: string;
    amount: number;
    service_name?: string;
    status?: string;
  }) =>
    request<{
      transaction: Record<string, unknown>;
      repayment: {
        loanId: string;
        repaymentPortion: number;
        agentPortion: number;
        loanFullyRepaid: boolean;
      } | null;
    }>("/api/transactions", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getRecentTransactions: () =>
    request<Array<Record<string, unknown>>>("/api/transactions/recent"),
};
