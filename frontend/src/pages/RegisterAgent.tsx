import { useState, useEffect } from "react";
import { GlassCard } from "@/components/GlassCard";
import { motion } from "framer-motion";
import { useWallet } from "@/contexts/WalletContext";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { UserPlus, CheckCircle, AlertCircle, Bot, Shield, Sparkles, Loader2 } from "lucide-react";

export default function RegisterAgent() {
  const { account, isConnected } = useWallet();
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentType, setAgentType] = useState("DeFi Trader");
  const [loading, setLoading] = useState(false);
  const [checkingRegistration, setCheckingRegistration] = useState(true);
  const [isAlreadyRegistered, setIsAlreadyRegistered] = useState(false);
  const [registeredAgentData, setRegisteredAgentData] = useState<any>(null);
  const [justRegistered, setJustRegistered] = useState(false);

  // Check if agent is already registered on mount
  useEffect(() => {
    if (account) {
      setCheckingRegistration(true);
      api.getAgent(account)
        .then((data) => {
          setIsAlreadyRegistered(true);
          setRegisteredAgentData(data);
        })
        .catch(() => {
          setIsAlreadyRegistered(false);
          setRegisteredAgentData(null);
        })
        .finally(() => setCheckingRegistration(false));
    } else {
      setCheckingRegistration(false);
    }
  }, [account]);

  const handleRegister = async () => {
    if (!isConnected) {
      toast.error("Connect your wallet first");
      return;
    }
    if (!agentName.trim()) {
      toast.error("Enter an agent name");
      return;
    }
    if (!account) {
      toast.error("No wallet account found");
      return;
    }

    // Double-check if already registered
    if (isAlreadyRegistered) {
      toast.error("This wallet already has a registered agent");
      return;
    }

    setLoading(true);
    try {
      // Call the actual API to register the agent
      await api.registerAgent({
        address: account,
        name: agentName.trim(),
        agent_type: agentType,
        model_hash: "0x" + Math.random().toString(16).slice(2, 34).padEnd(32, '0'),
      });

      toast.success("AI Agent registered successfully!");
      setJustRegistered(true);
      setIsAlreadyRegistered(true);
      
      // Fetch the newly registered agent data
      const agentData = await api.getAgent(account);
      setRegisteredAgentData(agentData);
    } catch (error: any) {
      console.error("Registration failed:", error);
      toast.error(error.message || "Failed to register agent. This wallet may already be registered.");
    } finally {
      setLoading(false);
    }
  };

  // Show loading state while checking registration
  if (checkingRegistration) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <GlassCard className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Checking registration status...</p>
        </GlassCard>
      </div>
    );
  }

  // Show already registered state
  if (isAlreadyRegistered && registeredAgentData) {
    return (
      <div className="max-w-lg mx-auto py-16">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", bounce: 0.4 }}
        >
          <GlassCard className="text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3, type: "spring" }}
              className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4"
            >
              <CheckCircle className="w-8 h-8 text-green-500" />
            </motion.div>
            <h2 className="text-2xl font-bold mb-2">
              {justRegistered ? "Agent Registered!" : "Already Registered"}
            </h2>
            <p className="text-muted-foreground mb-6">
              {justRegistered 
                ? `Your AI agent "${registeredAgentData.name}" has been registered successfully.`
                : "This wallet already has a registered agent."
              }
            </p>
            <div className="bg-muted/30 rounded-lg p-4 text-left space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agent Name</span>
                <span className="font-medium">{registeredAgentData.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Wallet</span>
                <span className="font-mono text-xs">{account?.slice(0, 10)}...{account?.slice(-6)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Credit Score</span>
                <span className="text-primary font-medium">{registeredAgentData.score}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agent Type</span>
                <span className="font-medium">{registeredAgentData.passport?.agentType || agentType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="text-green-500">Active ✓</span>
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => window.location.href = '/borrow'}
                className="flex-1 py-3 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:shadow-lg hover:shadow-primary/20 transition-all"
              >
                Go to Borrow
              </button>
              <button
                onClick={() => window.location.href = '/'}
                className="flex-1 py-3 rounded-lg bg-muted text-foreground font-medium text-sm hover:bg-muted/80 transition-colors"
              >
                Back to Home
              </button>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-3xl font-bold gradient-text">Register AI Agent</h1>
        <p className="text-muted-foreground mt-1">Create an on-chain identity for your AI agent</p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard delay={0.1}>
          <div className="flex items-center gap-2 mb-6">
            <UserPlus className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">Agent Details</h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Connected Wallet</label>
              <div className="mt-1 bg-muted/50 border border-border rounded-lg px-4 py-3 font-mono text-sm text-muted-foreground">
                {isConnected ? account : "Not connected"}
              </div>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Agent Name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. TradeBot V2"
                className="w-full mt-1 bg-muted/50 border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Agent Type</label>
              <select
                value={agentType}
                onChange={(e) => setAgentType(e.target.value)}
                className="w-full mt-1 bg-muted/50 border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              >
                <option value="DeFi Trader">DeFi Trader</option>
                <option value="Predictor Bot">Predictor Bot</option>
                <option value="Yield Aggregator">Yield Aggregator</option>
                <option value="Liquidity Provider">Liquidity Provider</option>
                <option value="Arbitrage Bot">Arbitrage Bot</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Description (optional)</label>
              <textarea
                value={agentDescription}
                onChange={(e) => setAgentDescription(e.target.value)}
                placeholder="Describe your agent's purpose..."
                rows={3}
                className="w-full mt-1 bg-muted/50 border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all resize-none"
              />
            </div>
            <button
              onClick={handleRegister}
              disabled={loading || !isConnected || !agentName.trim()}
              className="w-full py-3 rounded-lg bg-gradient-to-r from-primary to-accent text-primary-foreground font-semibold text-sm transition-all hover:shadow-lg hover:shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Registering on-chain...
                </span>
              ) : (
                "Register Agent"
              )}
            </button>
          </div>
        </GlassCard>

        {/* Benefits */}
        <div className="space-y-4">
          {[
            { icon: Bot, title: "On-Chain Identity", desc: "Your agent gets a unique on-chain identity tied to your wallet address." },
            { icon: Shield, title: "Credit Building", desc: "Start with a base credit score of 500 and improve it with successful transactions." },
            { icon: Sparkles, title: "Borrow Access", desc: "Registered agents can access credit lines proportional to their reputation." },
          ].map((item, i) => (
            <GlassCard key={item.title} delay={0.2 + i * 0.1}>
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                  <item.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-semibold">{item.title}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{item.desc}</p>
                </div>
              </div>
            </GlassCard>
          ))}

          {!isConnected && (
            <GlassCard delay={0.5}>
              <div className="flex items-center gap-3" style={{ color: "hsl(45, 93%, 47%)" }}>
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm">Connect your wallet to register an agent.</p>
              </div>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}
