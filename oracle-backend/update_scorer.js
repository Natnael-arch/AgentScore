const fs = require('fs');
const content = fs.readFileSync('scorer.ts', 'utf8');

let newContent = content.replace('export interface ScoreResult {', `interface PassportHistory {
  totalPayments:     number;
  successfulPayments: number;
  uniquePayees:      string[];
  firstPaymentAt:    number;  // unix timestamp
  totalAmountSpent:  bigint;
  sessions: {
    id: string;
    maxPerTx: bigint;
    totalSpent: bigint;
    respected: boolean; // never exceeded limit
  }[];
}

async function getPassportHistory(
  agentAddress: string,
  passportToken: string
): Promise<PassportHistory | null> {
  try {
    const response = await fetch(
      \`https://passport.prod.gokite.ai/v1/agents/\${agentAddress}/history\`,
      {
        headers: {
          "Authorization": \`Bearer \${passportToken}\`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function scorePaymentSuccess(history: PassportHistory): number {
  if (history.totalPayments === 0) return 0;
  const rate = history.successfulPayments / history.totalPayments;
  return Math.round(rate * 137); // max 137 pts (25% weight)
}

function scoreVolume(history: PassportHistory): number {
  return Math.min(history.totalPayments, 50) * 2.2;
}

function scoreDiversity(history: PassportHistory): number {
  const unique = new Set(history.uniquePayees).size;
  return Math.min(unique, 10) * 8.2; // max 82 pts
}

function scoreAge(history: PassportHistory): number {
  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - history.firstPaymentAt;
  const ageDays = ageSeconds / 86400;
  return Math.min(ageDays, 30) * 1.83; // max 55 pts
}

function scoreSessionDiscipline(history: PassportHistory): number {
  if (history.sessions.length === 0) return 0;
  const respected = history.sessions.filter(s => s.respected).length;
  const rate = respected / history.sessions.length;
  return Math.round(rate * 27); // max 27 pts
}

export interface ScoreResult {`);

newContent = newContent.replace('  breakdown: {', `  factors?: {
    repayment: number;
    payment: number;
    diversity: number;
    age: number;
    trading: number;
    discipline: number;
  };
  sources?: {
    passport: boolean;
    chainScan: boolean;
  };
  breakdown?: {`);

newContent = newContent.replace('export async function computeScore(agentAddress: string): Promise<ScoreResult> {', `export async function computeScoreLegacy(agentAddress: string): Promise<ScoreResult> {`);

newContent += `

export async function computeScore(
  agentAddress: string,
  passportToken: string = process.env.PASSPORT_USER_JWT || "",
): Promise<ScoreResult> {

  // PRIMARY: Passport history (fast, complete, verified)
  const passportHistory = await getPassportHistory(
    agentAddress, passportToken
  );

  // FALLBACK: blockchain scan if Passport unavailable
  if (!passportHistory) {
    console.warn("Passport history unavailable — falling back to chain scan");
    return computeScoreLegacy(agentAddress);
  }

  // SUPPLEMENTARY: on-chain data Passport doesn't have
  const repaymentPoints = await scoreRepaymentHistory(agentAddress, provider);
  const tradingPoints   = 0; // await scoreTradingPerformance(agentAddress, provider); // Not implemented yet

  // COMPUTE
  const paymentPoints   = scorePaymentSuccess(passportHistory);
  const volumePoints    = scoreVolume(passportHistory);
  const diversityPoints = scoreDiversity(passportHistory);
  const agePoints       = scoreAge(passportHistory);
  const disciplinePoints = scoreSessionDiscipline(passportHistory);

  const finalScore = Math.min(850, Math.max(300,
    300 +
    repaymentPoints   +  // 35% — loan repayment (from chain)
    paymentPoints     +  // 25% — payment success (from Passport)
    diversityPoints   +  // 15% — service diversity (from Passport)
    agePoints         +  // 10% — account age (from Passport)
    tradingPoints     +  // 10% — trading performance (from chain)
    disciplinePoints     //  5% — session discipline (from Passport)
  ));

  const paymentRate = passportHistory.totalPayments > 0 
    ? Math.round((passportHistory.successfulPayments / passportHistory.totalPayments) * 100) 
    : 0;
  const uniquePayeesCount = new Set(passportHistory.uniquePayees).size;
  const now = Math.floor(Date.now() / 1000);
  const ageDays = Math.floor((now - passportHistory.firstPaymentAt) / 86400);

  return {
    score: Math.round(finalScore),
    paymentRate,
    diversity: uniquePayeesCount,
    txCount: passportHistory.totalPayments,
    agentAgeDays: ageDays,
    factors: {
      repayment:   Math.round(repaymentPoints),
      payment:     Math.round(paymentPoints),
      diversity:   Math.round(diversityPoints),
      age:         Math.round(agePoints),
      trading:     Math.round(tradingPoints),
      discipline:  Math.round(disciplinePoints)
    },
    sources: {
      passport: true,
      chainScan: false  // no longer needed as primary source
    }
  };
}
`;

fs.writeFileSync('scorer.ts', newContent);
