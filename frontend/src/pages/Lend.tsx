import { useState, useEffect } from "react";
import { GlassCard } from "@/components/GlassCard";
import { motion } from "framer-motion";
import { useWallet } from "@/contexts/WalletContext";
import { toast } from "sonner";
import { DollarSign, TrendingUp, Clock, ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";
import { usePYUSDBalance, useDepositToLendingPool, useWithdrawFromLendingPool, useLenderPosition } from "@/lib/contracts";
import { api } from "@/lib/api";
import { formatEther, formatUnits } from "viem";

export default function Lend() {
  const { account, isConnected } = useWallet();
  const [amount, setAmount] = useState("");
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [loading, setLoading] = useState(false);
  const [poolStats, setPoolStats] = useState<any>(null);
  const [lenderData, setLenderData] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Optimistic UI state for instant presentation updates
  const [optimisticDeposits, setOptimisticDeposits] = useState<number | null>(null);
  const [optimisticBalance, setOptimisticBalance] = useState<number | null>(null);

  // Contract hooks
  const { data: pyusdBalance, refetch: refetchBalance } = usePYUSDBalance(account);
  const { data: lenderPosition, refetch: refetchPosition } = useLenderPosition(account);
  const { deposit: contractDeposit, isPending: isDepositPending, isConfirming: isDepositConfirming } = useDepositToLendingPool(account);
  const { withdraw: contractWithdraw, isPending: isWithdrawPending, isConfirming: isWithdrawConfirming } = useWithdrawFromLendingPool(account);

  // Fetch pool stats, lender position from API, and transactions
  const fetchLenderData = async () => {
    if (!account) return;
    try {
      // Force Wagmi hooks to fetch latest live on-chain values
      if (refetchBalance) refetchBalance();
      if (refetchPosition) refetchPosition();

      const [stats, position, recentTxs] = await Promise.all([
        api.getPoolStats(),
        api.getLenderPosition(account),
        api.getRecentTransactions()
      ]);
      setPoolStats(stats);
      setLenderData(position);
      // Filter transactions related to this lender
      const lenderTxs = recentTxs?.filter((tx: any) => 
        tx.from_address?.toLowerCase() === account.toLowerCase() ||
        tx.to_address?.toLowerCase() === account.toLowerCase()
      ).slice(0, 10) || [];
      setTransactions(lenderTxs);
    } catch (error) {
      console.error("Failed to fetch lender data:", error);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    setOptimisticDeposits(null);
    setOptimisticBalance(null);
    fetchLenderData();
  }, [account]);

  const formattedPYUSDBalance = pyusdBalance ? Number(formatUnits(pyusdBalance, 18)).toFixed(2) : '0.00';
  // Prioritize live on-chain contract data as the ultimate source of truth, fallback to API data
  const baseDepositedAmount = lenderPosition ? Number(formatUnits(lenderPosition[0], 18)).toFixed(2) : 
    (lenderData ? (lenderData.deposited_amount || 0).toFixed(2) : '0.00');
  
  // Apply optimistic values if set
  const depositedAmount = optimisticDeposits !== null ? optimisticDeposits.toFixed(2) : baseDepositedAmount;
  const displayPYUSDBalance = optimisticBalance !== null ? optimisticBalance.toFixed(2) : formattedPYUSDBalance;

  const earnedInterest = lenderPosition ? Number(formatUnits(lenderPosition[1], 18)).toFixed(2) : 
    (lenderData ? (lenderData.earned_interest || 0).toFixed(2) : '0.00');

  const handleSubmit = async () => {
    console.log("Submit triggered", { tab, amount, isConnected, account });
    
    if (!isConnected) {
      toast.error("Please connect your wallet first");
      return;
    }
    
    const amountNum = parseFloat(amount);
    console.log("Amount parsed:", amountNum);
    
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    
    const balanceNum = parseFloat(displayPYUSDBalance);
    console.log("Balance check:", { amountNum, balanceNum, tab });
    
    if (tab === "deposit") {
      if (amountNum > balanceNum) {
        toast.error(`Insufficient balance. You have ${balanceNum.toFixed(2)} PYUSD available.`);
        return;
      }
      if (balanceNum <= 0) {
        toast.error("You have no PYUSD balance to deposit");
        return;
      }
    }
    
    if (tab === "withdraw") {
      const maxWithdraw = parseFloat(depositedAmount) + parseFloat(earnedInterest);
      console.log("Withdraw check:", { amountNum, maxWithdraw, depositedAmount, earnedInterest });
      if (amountNum > maxWithdraw) {
        toast.error(`Cannot withdraw more than your deposited amount (${maxWithdraw.toFixed(2)} PYUSD)`);
        return;
      }
      if (maxWithdraw <= 0) {
        toast.error("You have no deposited funds to withdraw");
        return;
      }
    }

    try {
      if (tab === "deposit") {
        // Optimistic UI updates - instant visual confirmation for live demo speed
        const currentDep = parseFloat(depositedAmount);
        const currentBal = parseFloat(displayPYUSDBalance);
        setOptimisticDeposits(currentDep + amountNum);
        setOptimisticBalance(Math.max(0, currentBal - amountNum));
        
        toast.success(`Transaction submitted! Depositing ${amountNum} PYUSD in the background...`, {
          duration: 5000,
        });
        setAmount("");

        // Run the contract deposit asynchronously in the background
        contractDeposit(amount).then(async (result) => {
          if (result) {
            await api.deposit({ lender_address: account!, amount: amountNum });
            toast.success(`On-chain deposit of ${amountNum} PYUSD completed!`);
            // Silently sync the latest truth from blockchain/backend
            fetchLenderData();
          }
        }).catch(err => {
          console.error("Background deposit failed:", err);
          // Revert optimistic updates if they explicitly reject or fail
          toast.error("Deposit transaction failed or was rejected.");
          setOptimisticDeposits(null);
          setOptimisticBalance(null);
        });
      } else {
        // Optimistic UI updates - instant visual confirmation for live demo speed
        const currentDep = parseFloat(depositedAmount);
        const currentBal = parseFloat(displayPYUSDBalance);
        setOptimisticDeposits(Math.max(0, currentDep - amountNum));
        setOptimisticBalance(currentBal + amountNum);

        toast.success(`Transaction submitted! Withdrawing ${amountNum} PYUSD in the background...`, {
          duration: 5000,
        });
        setAmount("");

        // Run the contract withdrawal asynchronously in the background
        contractWithdraw(amount).then(async (result) => {
          if (result) {
            await api.withdraw({ lender_address: account!, amount: amountNum });
            toast.success(`On-chain withdrawal of ${amountNum} PYUSD completed!`);
            fetchLenderData();
          }
        }).catch(err => {
          console.error("Background withdrawal failed:", err);
          // Revert optimistic updates if they explicitly reject or fail
          toast.error("Withdrawal transaction failed or was rejected.");
          setOptimisticDeposits(null);
          setOptimisticBalance(null);
        });
      }
    } catch (error: any) {
      toast.error(error.message || `${tab === "deposit" ? "Deposit" : "Withdraw"} failed`);
    }
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-3xl font-bold gradient-text">Lend PYUSD</h1>
        <p className="text-muted-foreground mt-1">Deposit PYUSD to earn yield from AI agent borrowers</p>
      </motion.div>

      {/* Position Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard delay={0.1}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Your Deposits</p>
              <p className="text-2xl font-bold">{`${depositedAmount} PYUSD`}</p>
            </div>
            <DollarSign className="w-5 h-5 text-primary" />
          </div>
        </GlassCard>
        <GlassCard delay={0.2}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Interest Earned</p>
              <p className="text-2xl font-bold">{`${earnedInterest} PYUSD`}</p>
            </div>
            <TrendingUp className="w-5 h-5 text-primary" />
          </div>
        </GlassCard>
        <GlassCard delay={0.3}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Current APY</p>
              <p className="text-2xl font-bold">{poolStats ? `${poolStats.averageApy.toFixed(1)}%` : "0.0%"}</p>
            </div>
            <ArrowUpRight className="w-5 h-5 text-primary" />
          </div>
        </GlassCard>
        <GlassCard delay={0.4}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Available Balance</p>
              <p className="text-2xl font-bold">{`${displayPYUSDBalance} PYUSD`}</p>
            </div>
            <Clock className="w-5 h-5 text-primary" />
          </div>
        </GlassCard>
      </div>

      {/* Deposit/Withdraw Form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard delay={0.4}>
          <div className="flex gap-2 mb-6">
            {(["deposit", "withdraw"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "deposit" ? (
                  <span className="flex items-center justify-center gap-1"><ArrowDownRight className="w-4 h-4" /> Deposit</span>
                ) : (
                  <span className="flex items-center justify-center gap-1"><ArrowUpRight className="w-4 h-4" /> Withdraw</span>
                )}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Amount (PYUSD)</label>
              <div className="relative mt-1">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-muted/50 border border-border rounded-lg px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
                <button
                  onClick={() => {
                    if (tab === "deposit") {
                      setAmount(displayPYUSDBalance);
                    } else {
                      // For withdraw, use deposited amount + earned interest
                      const withdrawable = (parseFloat(depositedAmount) + parseFloat(earnedInterest)).toFixed(2);
                      setAmount(withdrawable);
                    }
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary hover:underline"
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Slider */}
            <div>
              <input
                type="range"
                min="0"
                max={tab === "deposit" ? parseFloat(displayPYUSDBalance) || 10000 : (parseFloat(depositedAmount) + parseFloat(earnedInterest)) || 10000}
                step="100"
                value={parseFloat(amount) || 0}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>
                  {tab === "deposit" 
                    ? `${parseFloat(displayPYUSDBalance).toLocaleString()} PYUSD` 
                    : `${(parseFloat(depositedAmount) + parseFloat(earnedInterest)).toLocaleString()} PYUSD`}
                </span>
              </div>
            </div>

            {/* Validation Messages */}
            {amount && parseFloat(amount) > 0 && (
              <div className="space-y-2">
                {tab === "deposit" && parseFloat(amount) > parseFloat(displayPYUSDBalance) && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <span>❌</span> Amount exceeds wallet balance ({parseFloat(displayPYUSDBalance).toFixed(2)} PYUSD)
                  </p>
                )}
                {tab === "withdraw" && parseFloat(amount) > (parseFloat(depositedAmount) + parseFloat(earnedInterest)) && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <span>❌</span> Amount exceeds deposited funds ({(parseFloat(depositedAmount) + parseFloat(earnedInterest)).toFixed(2)} PYUSD)
                  </p>
                )}
                {tab === "deposit" && parseFloat(amount) <= parseFloat(displayPYUSDBalance) && (
                  <p className="text-xs text-green-500 flex items-center gap-1">
                    <span>✓</span> Valid amount
                  </p>
                )}
                {tab === "withdraw" && parseFloat(amount) <= (parseFloat(depositedAmount) + parseFloat(earnedInterest)) && (
                  <p className="text-xs text-green-500 flex items-center gap-1">
                    <span>✓</span> Valid amount
                  </p>
                )}
              </div>
            )}

            {amount && parseFloat(amount) > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="bg-muted/30 rounded-lg p-4 space-y-2 text-sm"
              >
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimated APY</span>
                  <span className="text-primary font-medium">8.5%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">30-day earnings</span>
                  <span className="font-medium">${(parseFloat(amount) * 0.085 / 12).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Annual earnings</span>
                  <span className="font-medium">${(parseFloat(amount) * 0.085).toFixed(2)}</span>
                </div>
              </motion.div>
            )}

            <button
              onClick={handleSubmit}
              disabled={(() => {
                const amt = parseFloat(amount || '0');
                const bal = parseFloat(displayPYUSDBalance || '0');
                const maxWithdraw = parseFloat(depositedAmount || '0') + parseFloat(earnedInterest || '0');
                if (!amount || amt <= 0) return true;
                if (tab === 'deposit' && amt > bal) return true;
                if (tab === 'withdraw' && amt > maxWithdraw) return true;
                return loading || isDepositPending || isWithdrawPending;
              })()}
              className="w-full py-3 rounded-lg bg-gradient-to-r from-primary to-accent text-primary-foreground font-semibold text-sm transition-all hover:shadow-lg hover:shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {(loading || isDepositPending || isWithdrawPending) ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  {(isDepositConfirming || isWithdrawConfirming) ? "Confirming..." : "Processing..."}
                </span>
              ) : (
                `${tab === "deposit" ? "Deposit" : "Withdraw"} PYUSD`
              )}
            </button>
          </div>
        </GlassCard>

        {/* Transaction History */}
        <GlassCard delay={0.5}>
          <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
          <div className="space-y-3">
            {isLoadingData ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No transactions yet</p>
                <p className="text-xs mt-1">Your deposits and withdrawals will appear here</p>
              </div>
            ) : (
              transactions.map((tx, i) => {
                const isIncoming = tx.to_address?.toLowerCase() === account?.toLowerCase();
                const isOutgoing = tx.from_address?.toLowerCase() === account?.toLowerCase();
                const txType = tx.service_name || (isIncoming ? "Deposit" : isOutgoing ? "Payment" : "Transfer");
                const amount = parseFloat(tx.amount || 0);
                const formattedAmount = amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const timeAgo = tx.created_at ? new Date(tx.created_at).toLocaleDateString() : 'Recently';
                
                return (
                  <motion.div
                    key={tx.id || i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 + i * 0.1 }}
                    className="flex items-center justify-between py-3 border-b border-border/30 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{txType}</p>
                      <p className="text-xs text-muted-foreground">{timeAgo}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-mono ${isIncoming ? "text-primary" : "text-destructive"}`}>
                        {isIncoming ? "+" : "-"}{formattedAmount} PYUSD
                      </p>
                      <p className="text-xs text-primary">✓ {tx.status || "confirmed"}</p>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
