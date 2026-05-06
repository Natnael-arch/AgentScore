import { StatCard } from "@/components/StatCard";
import { GlassCard } from "@/components/GlassCard";
import { TVLChart } from "@/components/TVLChart";
import { CreditScoreGauge } from "@/components/CreditScoreGauge";
import { DollarSign, Users, TrendingUp, Activity, ArrowRight, Wallet, CheckCircle2, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useWallet } from '@/contexts/WalletContext';
import { usePYUSDBalance } from '@/lib/contracts';
import { api } from '@/lib/api';
import { useState, useEffect } from 'react';
import { formatEther } from 'viem';

export default function Dashboard() {
  const { account, isConnected } = useWallet();
  const { data: usdtBalance } = usePYUSDBalance(account);
  const [poolStats, setPoolStats] = useState<any>(null);
  const [isAgentRegistered, setIsAgentRegistered] = useState(false);
  const [agentData, setAgentData] = useState<any>(null);
  const [recentAgents, setRecentAgents] = useState<any[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  // Fetch pool stats
  useEffect(() => {
    api.getPoolStats()
      .then(setPoolStats)
      .catch((err) => console.error("Pool stats error:", err));
  }, []);

  // Check if agent is registered
  useEffect(() => {
    if (account) {
      api.getAgent(account)
        .then((data) => {
          console.log("Agent data fetched:", data);
          setIsAgentRegistered(true);
          setAgentData(data);
        })
        .catch((err) => {
          console.log("Agent not registered:", err);
          setIsAgentRegistered(false);
          setAgentData(null);
        });
    }
  }, [account]);

  // Fetch recent agents with better error handling
  useEffect(() => {
    console.log("Fetching agents...");
    api.getAgents()
      .then((agents) => {
        console.log("Agents fetched:", agents);
        if (Array.isArray(agents)) {
          setRecentAgents(agents.slice(0, 4));
        } else {
          console.error("Agents is not an array:", agents);
          setAgentsError("Invalid response format");
        }
      })
      .catch((err) => {
        console.error("Failed to fetch agents:", err);
        setAgentsError(err.message || "Failed to fetch agents");
      });
  }, []);

  const formattedUSDTBalance = usdtBalance ? Number(formatEther(usdtBalance)).toFixed(2) : '0.00';

  return (
    <div className="space-y-8">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-8"
      >
        <h1 className="text-4xl md:text-5xl font-bold mb-3">
          <span className="gradient-text">KiteCredit</span> Protocol
        </h1>
        <p className="text-muted-foreground text-lg max-w-xl mx-auto">
          AI-powered lending on Kite blockchain. Earn yield, build credit, borrow smart.
        </p>
        {!isConnected && (
          <p className="text-sm text-primary mt-4 animate-pulse">
            Connect your wallet to get started
          </p>
        )}
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total Value Locked" 
          value={poolStats ? `$${(poolStats.tvl / 1000000).toFixed(1)}M` : "$0.0M"} 
          change={poolStats ? `${poolStats.activeLoans} active loans` : "Loading..."} 
          positive icon={DollarSign} 
          delay={0.1} 
        />
        <StatCard 
          title="Active Agents" 
          value={recentAgents.length.toString()} 
          change={isAgentRegistered ? "Your agent active" : "Register your agent"} 
          positive={isAgentRegistered} 
          icon={Users} 
          delay={0.2} 
        />
        <StatCard 
          title="Current APY" 
          value={poolStats ? `${poolStats.averageApy.toFixed(1)}%` : "0.0%"} 
          change="Variable rate" 
          positive icon={TrendingUp} 
          delay={0.3} 
        />
        <StatCard 
          title="Your USDT Balance" 
          value={`${formattedUSDTBalance} USDT`} 
          change={isConnected ? "Ready to lend" : "Connect wallet"} 
          positive={isConnected} 
          icon={Wallet} 
          delay={0.4} 
        />
      </div>

      {/* Charts & Score */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard className="lg:col-span-2" delay={0.5}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Total Value Locked</h2>
            <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-md">Last 10 months</span>
          </div>
          <TVLChart />
        </GlassCard>

        <GlassCard delay={0.6} className="flex flex-col items-center justify-center">
          <h2 className="text-lg font-semibold mb-4">Protocol Health</h2>
          <CreditScoreGauge score={780} />
          <p className="text-xs text-muted-foreground mt-4">Utilization: 32%</p>
        </GlassCard>
      </div>

      {/* User Agent Status */}
      {isConnected && (
        <GlassCard delay={0.7}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {isAgentRegistered ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  Your Agent Status
                </>
              ) : (
                "Register Your Agent"
              )}
            </h2>
            <Link to="/register" className="text-sm text-primary flex items-center gap-1 hover:underline">
              {isAgentRegistered ? "Manage" : "Register"} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {isAgentRegistered && agentData ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Agent Name</p>
                <p className="font-semibold flex items-center gap-2">
                  {agentData.name}
                  {agentData.passportVerified ? (
                    <span title="Kite Passport Verified — cryptographic agent identity" className="text-green-500 cursor-help">
                      <ShieldCheck className="w-4 h-4" />
                    </span>
                  ) : (
                    <span title="No Passport — wallet address only" className="text-gray-400 cursor-help">
                      <ShieldQuestion className="w-4 h-4" />
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Credit Score</p>
                <p className="font-semibold text-primary">{agentData.score}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Agent Type</p>
                <p className="font-semibold">{agentData.passport?.agentType || 'N/A'}</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted-foreground mb-4">No agent registered with this wallet</p>
              <Link to="/register">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-6 py-2 bg-primary text-primary-foreground rounded-lg font-medium"
                >
                  Register Agent
                </motion.button>
              </Link>
            </div>
          )}
        </GlassCard>
      )}

      {/* Recent Agents */}
      <GlassCard delay={0.8}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent AI Agents</h2>
          <Link to="/register" className="text-sm text-primary flex items-center gap-1 hover:underline">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border/50">
                <th className="text-left py-3 font-medium">Agent</th>
                <th className="text-left py-3 font-medium">Address</th>
                <th className="text-left py-3 font-medium">Credit Score</th>
                <th className="text-left py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentAgents.length > 0 ? recentAgents.map((agent, i) => (
                <motion.tr
                  key={agent.address}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.9 + i * 0.1 }}
                  className="border-b border-border/30 last:border-0"
                >
                  <td className="py-3 font-medium">{agent.name}</td>
                  <td className="py-3 font-mono text-muted-foreground">{`${agent.address.slice(0, 6)}...${agent.address.slice(-4)}`}</td>
                  <td className="py-3">
                    <span className={`font-semibold ${agent.score >= 700 ? "text-primary" : agent.score >= 500 ? "text-yellow-400" : "text-destructive"}`}>
                      {agent.score}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className="px-2 py-1 rounded-full text-xs bg-primary/10 text-primary">
                      Active
                    </span>
                  </td>
                </motion.tr>
              )) : (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground">
                    No agents registered yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Start Lending", desc: "Earn yield on your USDT", path: "/lend", color: "from-primary/20 to-primary/5" },
          { label: "Borrow Credit", desc: "AI agents can borrow here", path: "/borrow", color: "from-accent/20 to-accent/5" },
          { label: "Register Agent", desc: "Create on-chain identity", path: "/register", color: "from-primary/10 to-accent/10" },
        ].map((action, i) => (
          <Link key={action.path} to={action.path}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1 + i * 0.1 }}
              className={`glass-card-hover p-6 bg-gradient-to-br ${action.color} group cursor-pointer`}
            >
              <h3 className="font-semibold group-hover:text-primary transition-colors">{action.label}</h3>
              <p className="text-sm text-muted-foreground mt-1">{action.desc}</p>
              <ArrowRight className="w-4 h-4 text-primary mt-3 group-hover:translate-x-1 transition-transform" />
            </motion.div>
          </Link>
        ))}
      </div>
    </div>
  );
}
