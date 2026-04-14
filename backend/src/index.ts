import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { agentsRouter } from "./routes/agents.js";
import { loansRouter } from "./routes/loans.js";
import { lendingRouter } from "./routes/lending.js";
import { transactionsRouter } from "./routes/transactions.js";
import { poolRouter } from "./routes/pool.js";
import { startIndexer } from "./services/indexer.js";

const app = express();

// Start the blockchain event indexer
startIndexer().catch(err => console.error("Indexer startup failed:", err));


app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/agents", agentsRouter);
app.use("/api/loans", loansRouter);
app.use("/api/lending", lendingRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/pool", poolRouter);

// Export for Vercel serverless
export default app;

// Only listen if not running in a serverless environment
if (process.env.NODE_ENV !== "production") {
  app.listen(config.port, () => {
    console.log(`KiteCredit API running on http://localhost:${config.port}`);
  });
}

