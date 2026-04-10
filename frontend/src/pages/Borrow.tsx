import { useState, useEffect } from "react";
import { GlassCard } from "@/components/GlassCard";
import { CreditScoreGauge } from "@/components/CreditScoreGauge";
import { motion } from "framer-motion";
import { useWallet } from "@/contexts/WalletContext";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Shield, Zap, Clock, AlertTriangle, ExternalLink, CreditCard, Activity, Calendar, TrendingUp, Wallet, FileCheck, AlertOctagon } from "lucide-react";

export default function Borrow() {
  const { account, isConnected } = useWallet();
  const [agentData, setAgentData] = useState<any>(null);
  const [loanTerms, setLoanTerms] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [borrowAmount, setBorrowAmount] = useState("");
  const [loading, setLoading] = useState(false);

  // Fetch agent data and loan terms
  useEffect(() => {
    if (account) {
      setIsLoading(true);
      Promise.all([
        api.getAgent(account).catch(() => null),
        api.getLoanTerms(account).catch(() => null)
      ])
        .then(([agent, terms]) => {
          setAgentData(agent);
          setLoanTerms(terms);
        })
        .finally(() => setIsLoading(false));
    }
  }, [account]);

  // Calculate score-based loan tiers
  const creditScore = agentData?.score || 0;
  const minCreditScore = 500; // Minimum score to borrow
  
  // Score-based loan tiers
  const getMaxLoanByScore = (score: number): number => {
    if (score < 500) return 5;      // $5 for poor credit
    if (score < 650) return 50;     // $50 for fair credit  
    if (score < 750) return 200;    // $200 for good credit
    return 500;                     // $500 for excellent credit
  };
  
  const maxLoanByScore = getMaxLoanByScore(creditScore);
  const apiMaxLoan = loanTerms?.maxLoan || 0;
  const maxBorrowable = Math.min(maxLoanByScore, apiMaxLoan);
  const canBorrow = creditScore >= minCreditScore && maxBorrowable > 0;
  
  // Fixed repayment split at 30% of x402 revenue
  const repaymentSplit = 30;

  const handleBorrow = async () => {
    if (!isConnected) {
      toast.error("Connect your wallet first");
      return;
    }
    if (creditScore < minCreditScore) {
      toast.error(`Credit score too low. Minimum ${minCreditScore} required to borrow.`);
      return;
    }
    if (!borrowAmount || parseFloat(borrowAmount) <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (parseFloat(borrowAmount) > maxBorrowable) {
      toast.error("Amount exceeds available credit");
      return;
    }
    
    setLoading(true);
    try {
      // Call real API to request loan
      const result = await api.requestLoan({
        borrower_address: account!,
        amount: parseFloat(borrowAmount)
      });
      
      toast.success(`Loan request submitted! Amount: ${borrowAmount} USDT`);
      setBorrowAmount("");
      
      // Refresh loan terms after borrowing
      const updatedTerms = await api.getLoanTerms(account!);
      setLoanTerms(updatedTerms);
    } catch (error: any) {
      console.error("Loan request failed:", error);
      toast.error(error.message || "Failed to request loan");
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1 className="text-3xl font-bold gradient-text">Borrow</h1>
          <p className="text-muted-foreground mt-1">Loading your agent data...</p>
        </motion.div>
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!agentData) {
    return (
      <div className="space-y-8">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1 className="text-3xl font-bold gradient-text">Borrow</h1>
          <p className="text-muted-foreground mt-1">AI agents can borrow credit based on reputation score</p>
        </motion.div>
        <GlassCard className="text-center py-12">
          <AlertTriangle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Agent Found</h3>
          <p className="text-muted-foreground mb-6">You need to register an agent before you can borrow.</p>
          <button
            onClick={() => window.location.href = '/register'}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:shadow-lg hover:shadow-primary/20 transition-all"
          >
            Register Agent
          </button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-3xl font-bold gradient-text">Borrow</h1>
        <p className="text-muted-foreground mt-1">AI agents can borrow credit based on reputation score</p>
      </motion.div>

      {/* Agent Insights Section */}
      <GlassCard delay={0.1}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">Agent Insights</h3>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.open(`https://testnet.kitescan.ai/address/${account}`, '_blank')}
              className="flex items-center gap-2 px-4 py-2 bg-muted/50 hover:bg-muted rounded-lg text-sm font-medium transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Verify on KiteScan
            </button>
            <button
              onClick={() => toast.info("Agent passport verification coming soon!")}
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-sm font-medium transition-colors"
            >
              <FileCheck className="w-4 h-4" />
              Connect Passport
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">Transaction Volume</span>
            </div>
            <p className="text-xl font-bold">${(agentData?.transactionVolume || 0).toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Total payments processed</p>
          </div>
          
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">Account Age</span>
            </div>
            <p className="text-xl font-bold">{agentData?.accountAgeDays || 0} days</p>
            <p className="text-xs text-muted-foreground mt-1">Since registration</p>
          </div>
          
          <div className="bg-muted/30 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">x402 Reliability</span>
            </div>
            <p className="text-xl font-bold">{((agentData?.x402Reliability || 0) * 100).toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {agentData?.totalPayments || 0} payments, {agentData?.failedPayments || 0} failed
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Credit Score */}
        <GlassCard delay={0.2} className="flex flex-col items-center">
          <h3 className="text-lg font-semibold mb-6">Your Credit Score</h3>
          <CreditScoreGauge score={Math.min(Math.max(agentData?.score || 0, 300), 850)} maxScore={850} />
          <div className="mt-6 w-full space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Range</span>
              <span className="font-medium">300 - 850</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Agent Name</span>
              <span className="font-medium">{agentData?.name || 'N/A'}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <motion.div
                className="bg-primary rounded-full h-2"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(((agentData?.score || 300) - 300) / 5.5, 100)}%` }}
                transition={{ duration: 1, delay: 0.5 }}
              />
            </div>
          </div>
        </GlassCard>

        {/* Borrow Form */}
        <GlassCard delay={0.3} className="lg:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold">Borrowing Portal</h3>
            <div className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
              Score Tier: {creditScore < 500 ? 'Poor' : creditScore < 650 ? 'Fair' : creditScore < 750 ? 'Good' : 'Excellent'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            {[
              { label: "Max Borrowable", value: `$${maxBorrowable.toLocaleString()}`, subtext: `Tier: $${maxLoanByScore}`, icon: Zap },
              { label: "Interest Rate", value: `${(loanTerms?.interestRate || 5).toFixed(1)}%`, subtext: "Variable APY", icon: Shield },
              { label: "Your Score", value: creditScore, subtext: `Min required: ${minCreditScore}`, icon: Clock },
              { label: "Agent Type", value: agentData?.passport?.agentType || 'N/A', subtext: agentData?.passport?.kiteIdentityStatus || 'Unverified', icon: AlertTriangle },
            ].map((item, i) => (
              <div key={item.label} className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <item.icon className="w-3 h-3 text-primary" />
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
                <p className="text-lg font-bold">{item.value}</p>
                <p className="text-xs text-muted-foreground">{item.subtext}</p>
              </div>
            ))}
          </div>

          {/* Loan Terms Box */}
          <div className="bg-muted/30 rounded-lg p-4 mb-6 space-y-3">
            <h4 className="font-medium flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-primary" />
              Loan Terms
            </h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Interest Rate</span>
                <p className="font-semibold">{(loanTerms?.interestRate || 5).toFixed(1)}% APY</p>
              </div>
              <div>
                <span className="text-muted-foreground">Repayment Split</span>
                <p className="font-semibold">{repaymentSplit}% of x402 revenue</p>
              </div>
              <div>
                <span className="text-muted-foreground">Term</span>
                <p className="font-semibold">30 days</p>
              </div>
            </div>
            
            {/* Reputation Risk Warning */}
            {creditScore < 600 && (
              <div className="flex items-start gap-2 mt-3 p-3 bg-yellow-500/10 rounded-lg">
                <AlertOctagon className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <span className="font-medium text-yellow-500">Reputation Risk</span>
                  <p className="text-muted-foreground text-xs mt-1">
                    Low credit scores may result in higher interest rates and lower loan limits. 
                    Improve your score by maintaining successful transactions.
                  </p>
                </div>
              </div>
            )}
          </div>

          {!canBorrow ? (
            <div className="text-center py-8">
              <AlertTriangle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
              <h4 className="font-semibold mb-2">Cannot Borrow</h4>
              <p className="text-sm text-muted-foreground">
                {creditScore < minCreditScore 
                  ? `Your credit score (${creditScore}) is below the minimum required (${minCreditScore}). Build your reputation first.`
                  : "No credit available. Maximum loan amount is 0."
                }
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">Borrow Amount (USDT)</label>
                <input
                  type="number"
                  value={borrowAmount}
                  onChange={(e) => setBorrowAmount(e.target.value)}
                  placeholder="0.00"
                  max={maxBorrowable}
                  className="w-full mt-1 bg-muted/50 border border-border rounded-lg px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
              </div>

              <input
                type="range"
                min="0"
                max={maxBorrowable}
                step="50"
                value={parseFloat(borrowAmount) || 0}
                onChange={(e) => setBorrowAmount(e.target.value)}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>Max: {maxBorrowable.toLocaleString()} USDT</span>
              </div>

              {borrowAmount && parseFloat(borrowAmount) > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-muted/30 rounded-lg p-4 space-y-2 text-sm"
                >
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Interest Rate</span>
                    <span className="text-primary font-medium">{(loanTerms?.interestRate || 0).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monthly Payment</span>
                    <span className="font-medium">${(parseFloat(borrowAmount) * (loanTerms?.interestRate || 0) / 100 / 12).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Repayment</span>
                    <span className="font-medium">${(parseFloat(borrowAmount) * (1 + (loanTerms?.interestRate || 0) / 100)).toFixed(2)}</span>
                  </div>
                </motion.div>
              )}

              <button
                onClick={handleBorrow}
                disabled={loading || !borrowAmount || parseFloat(borrowAmount) <= 0}
                className="w-full py-3 rounded-lg bg-gradient-to-r from-accent to-primary text-primary-foreground font-semibold text-sm transition-all hover:shadow-lg hover:shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Executing...
                  </>
                ) : (
                  <>
                    <Wallet className="w-4 h-4" />
                    Execute Loan
                  </>
                )}
              </button>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Loan History */}
      <GlassCard delay={0.4}>
        <h3 className="text-lg font-semibold mb-4">Loan History</h3>
        <div className="space-y-3">
          {[
            { id: "#1042", amount: "1,200 USDT", rate: "5.2%", status: "Active", date: "Mar 15, 2024" },
            { id: "#1038", amount: "800 USDT", rate: "4.8%", status: "Repaid", date: "Feb 20, 2024" },
            { id: "#1025", amount: "2,000 USDT", rate: "5.5%", status: "Repaid", date: "Jan 10, 2024" },
          ].map((loan, i) => (
            <motion.div
              key={loan.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 + i * 0.1 }}
              className="flex items-center justify-between py-3 border-b border-border/30 last:border-0"
            >
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-muted-foreground">{loan.id}</span>
                <span className="font-medium">{loan.amount}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">{loan.rate}</span>
                <span className="text-xs text-muted-foreground">{loan.date}</span>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  loan.status === "Active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  {loan.status}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
