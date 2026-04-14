import { GlassCard } from "./GlassCard";
import { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  positive?: boolean;
  icon: LucideIcon;
  delay?: number;
}

export function StatCard({ title, value, change, positive, icon: Icon, delay = 0 }: StatCardProps) {
  return (
    <GlassCard delay={delay}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <motion.p
            className="text-2xl font-bold mt-1"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: delay + 0.3 }}
          >
            {value}
          </motion.p>
          {change && (
            <p className={`text-xs mt-1 ${positive ? "text-primary" : "text-destructive"}`}>
              {positive ? "↑" : "↓"} {change}
            </p>
          )}
        </div>
        <div className="p-3 rounded-xl bg-primary/10">
          <Icon className="w-5 h-5 text-primary" />
        </div>
      </div>
    </GlassCard>
  );
}
