import { motion } from "framer-motion";

interface CreditScoreGaugeProps {
  score: number;
  maxScore?: number;
  size?: number;
}

export function CreditScoreGauge({ score, maxScore = 850, size = 200 }: CreditScoreGaugeProps) {
  const percentage = (score / maxScore) * 100;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference * 0.75; // 270 degrees

  const getColor = () => {
    if (percentage >= 75) return "hsl(185, 70%, 45%)";
    if (percentage >= 50) return "hsl(45, 93%, 47%)";
    return "hsl(0, 72%, 51%)";
  };

  const getLabel = () => {
    if (percentage >= 75) return "Excellent";
    if (percentage >= 50) return "Good";
    if (percentage >= 25) return "Fair";
    return "Poor";
  };

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="transform rotate-[135deg]"
      >
        {/* Background arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * 0.25}
          strokeLinecap="round"
        />
        {/* Score arc */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 6px ${getColor()})` }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span
          className="text-3xl font-bold"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          style={{ color: getColor() }}
        >
          {score}
        </motion.span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{getLabel()}</span>
      </div>
    </div>
  );
}
