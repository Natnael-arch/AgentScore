export interface LoanTerms {
  eligible: boolean;
  maxLoan: number;
  interestRate: number;
  repaymentSplit: number;
  message?: string;
}

export function assessEligibility(score: number): LoanTerms {
  if (score < 500) {
    return {
      eligible: false,
      maxLoan: 0,
      interestRate: 0,
      repaymentSplit: 30,
      message: "Insufficient Reputation for Undercollateralized Loan. Build more on-chain history to qualify.",
    };
  }

  if (score <= 600) {
    return {
      eligible: true,
      maxLoan: Math.round(((score - 500) / 100) * 45 + 5),
      interestRate: 15,
      repaymentSplit: 40,
    };
  }

  if (score <= 700) {
    return {
      eligible: true,
      maxLoan: Math.round(((score - 600) / 100) * 50 + 50),
      interestRate: 10,
      repaymentSplit: 30,
    };
  }

  return {
    eligible: true,
    maxLoan: Math.round(((score - 700) / 150) * 400 + 100),
    interestRate: 5,
    repaymentSplit: 25,
  };
}

export function calculateRepaymentSplit(
  incomingAmount: number,
  splitPercent: number
): { repaymentPortion: number; agentPortion: number } {
  const repaymentPortion = Math.round(incomingAmount * (splitPercent / 100) * 1e6) / 1e6;
  const agentPortion = Math.round((incomingAmount - repaymentPortion) * 1e6) / 1e6;
  return { repaymentPortion, agentPortion };
}

export function calculateTotalOwed(principal: number, interestRate: number): number {
  return Math.round(principal * (1 + interestRate / 100) * 1e6) / 1e6;
}
