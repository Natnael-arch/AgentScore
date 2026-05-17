# KiteCredit (AgentScore)

> **Decentralized Credit & Lending Protocol for Autonomous AI Agents on the Kite AI Testnet**

KiteCredit bridges human liquidity providers with autonomous AI trading bots through a fully on-chain, reputation-based credit system. Agents earn a verifiable credit score (AgentScore) based on their on-chain history, enabling them to borrow PYUSD from a shared lending pool — with zero collateral required.

[![Network](https://img.shields.io/badge/Network-Kite%20AI%20Testnet-blue)](https://testnet.kitescan.ai)
[![Chain ID](https://img.shields.io/badge/Chain%20ID-2368-blue)](https://rpc-testnet.gokite.ai)
[![PYUSD](https://img.shields.io/badge/Token-PYUSD-green)](https://testnet.kitescan.ai)

---

## 📚 Documentation

[![Docs](https://img.shields.io/badge/Docs-agentscore--docs.vercel.app-blue?logo=vercel)](https://agentscore-docs.vercel.app)

Full technical documentation, architectural deep dives, and component references are available at the **[KiteCredit Official Documentation Site](https://agentscore-docs.vercel.app)**.

---

## 🏗 System Architecture

The KiteCredit ecosystem is a **5-component microservices architecture** deployed across smart contracts, an Express API backend, a React frontend, a standalone oracle, and an autonomous trading agent.

```
┌─────────────────────────────────────────────────────────────┐
│                      Kite AI Testnet                        │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  LendingPool.sol │  │ AgentScore   │  │ X402         │  │
│  │  (PYUSD vault)   │  │ Attestation  │  │ Processor    │  │
│  └──────────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ▲              ▲                        ▲
         │              │                        │
┌────────┴─────┐  ┌─────┴──────┐  ┌─────────────┴──────────┐
│   /backend   │  │  /oracle-  │  │    /trading-agent       │
│ Node/Express │  │  backend   │  │  (Autonomous Bot + WS)  │
│  + Indexer   │  │  + Scorer  │  │  + Account Abstraction  │
└──────┬───────┘  └────────────┘  └────────────────────────┘
       │
┌──────┴───────┐
│  /frontend   │
│  React/Vite  │
│  + Wagmi     │
└──────────────┘
```

---

## 🧩 Component Breakdown

### 1. Smart Contracts (`/contracts` & `/frontend/contracts`)

Deployed on the **Kite AI Testnet** (Chain ID: 2368). Compiled with Hardhat.

| Contract | Address | Description |
| :--- | :--- | :--- |
| `LendingPool.sol` | `0x16c11...067dE` | Central PYUSD vault. Manages deposits, score-gated borrowing, and interest accrual. |
| `AgentScoreAttestation.sol` | `0xF04B3...442C3` | On-chain oracle registry storing agent credit scores attested by the oracle signer. |
| `X402Processor.sol` | `0x18BE0...Fc252` | Implements the X402 standard. Automatically splits trading profits 70% to agent / 30% to pool. |

> ⚠️ **Note**: `LendingPool.sol` and `X402Processor.sol` are compiled under `/frontend/contracts`. `AgentScoreAttestation.sol` is compiled under `/contracts`. Both compiled ABI artifact directories are required for the backend to start.

---

### 2. Frontend DApp (`/frontend`)

**Stack**: React 18 + Vite + TypeScript + TailwindCSS + Shadcn/UI + Wagmi v3 + Viem + Tanstack Query

**4 Pages**:
- **`/` — Dashboard**: Real-time visualization of pool stats, agent scores, and recent loan repayments indexed from the blockchain.
- **`/lend` — Lend**: Lenders deposit PYUSD into the pool with **Optimistic UI** (balance updates instantly while MetaMask confirms in the background).
- **`/borrow` — Borrow**: Agents view their dynamic loan terms (rate and limit determined by their live AgentScore) and can draw PYUSD.
- **`/register` — Register Agent**: Registers an agent wallet address into the system.

---

### 3. Resilient Backend & Indexer (`/backend`)

**Stack**: Node.js + Express 5 + TypeScript + Ethers.js v6 + Supabase

**5 REST API Route Groups**:
| Route | Description |
| :--- | :--- |
| `GET /api/agents` | Lists registered agents and their scores |
| `GET/POST /api/loans` | Loan records and status |
| `GET/POST /api/lending` | Lender position management, gasless PYUSD payouts |
| `GET /api/transactions` | Indexed X402 payment split history |
| `GET /api/pool` | Global pool statistics (TVL, borrowed, available) |

**Key Services**:
- **Blockchain Indexer** (`indexer.ts`): Polls the Kite Testnet every **5 seconds** for `ScoreAttested`, `Borrowed`, and `PaymentSplit` events, caching them to the database.
- **Gasless Transfer Service** (`gasless.ts`): Executes EIP-712 `TransferWithAuthorization` PYUSD payouts via the [Kite Gasless API](https://gasless.gokite.ai/testnet), allowing lenders to receive yield without paying gas.
- **Self-Healing DB Fallback** (`config.ts`): If Supabase is unreachable, the backend silently falls back to a local `db.json` file-based emulator, guaranteeing 100% uptime for local demos.

---

### 4. Oracle Backend (`/oracle-backend`)

**Stack**: Node.js + Express + TypeScript + Ethers.js v6

An independent credit scoring microservice gated behind the **X402 payment standard**.

**How It Works**:
1. Agents (or the trading bot) call `GET /score/:addr`, providing an `X-Payment` header containing a base64-encoded, mined on-chain PYUSD transaction receipt.
2. The oracle verifies the payment on-chain by decoding the transaction hash from the header and checking the ERC-20 `Transfer` log.
3. If verified, it computes the agent's `AgentScore` using a 6-factor hybrid model.
4. The oracle's private key signs and submits the score to `AgentScoreAttestation.sol` on-chain.
5. A `GET /score/:addr/raw` endpoint is also available (ungated) for UI display purposes.

---

### 5. Autonomous Trading Agent (`/trading-agent`)

**Stack**: Node.js + TypeScript + Ethers.js v6 + `gokite-aa-sdk` + WebSocket Server

An autonomous bot designed to simulate the role of an AI borrower in the protocol.

**Key Features**:
- Uses `gokite-aa-sdk` (Account Abstraction) to execute on-chain trades via a smart wallet.
- Evaluates market conditions using the **KiteCredit Signal Engine v1** — a deterministic RSI and momentum-based strategy on live ETH OHLC data from the CoinGecko API.
  - *Signal triggers: RSI < 35 (mean-reversion) or Uptrend confirmed with RSI < 60 (momentum entry).*
- Fetches its score from the oracle, then borrows PYUSD from `LendingPool.sol` based on its credit tier.
- Routes profitable trade closures through the `X402Processor` for automatic 70/30 profit splitting.
- Integrates the **Kite Passport MCP (Model Context Protocol) Client** to sign oracle payment requests with an active session.
- Broadcasts real-time state via a **WebSocket server** (port 4001) to the trading dashboard UI (`/trading-agent/dashboard`).
- Refreshes its on-chain score attestation every 5 trading loops (~5 minutes).

> ⚠️ **Note**: The trading agent requires a valid `AGENT_PRIVATE_KEY` in `.env`. It will crash on startup if the key is missing or invalid.

---

## 🔄 End-to-End Flow

```
1. [Lend]     Lender deposits PYUSD → LendingPool.sol
2. [Register] Agent wallet registered → Backend checks Kite Passport MCP session
3. [Score]    Oracle computes 6-factor AgentScore → Attests to AgentScoreAttestation.sol
4. [Borrow]   Agent requests loan → LendingPool reads score → PYUSD disbursed
5. [Trade]    Agent trades ETH using RSI/momentum signals via Account Abstraction
6. [Repay]    Profit routed via X402Processor → 30% pool, 70% agent (auto-split on-chain)
7. [Yield]    Lenders see Interest Earned grow → Withdraw principal + yield anytime
```

---

## 📊 AgentScore Credit System

Scores range from **300 (minimum)** to **850 (maximum)**. Computed using a 6-factor weighted model:

| Factor | Weight | Max Points | Data Source |
| :--- | :--- | :--- | :--- |
| Loan Repayment History | 35% | 192 pts | `LendingPool.sol` on-chain events |
| Payment Success Rate | 25% | 137 pts | Kite Passport API |
| Service Diversity | 15% | 82 pts | Kite Passport API (unique payees) |
| Account Age | 10% | 55 pts | Kite Passport API |
| Trading Performance | 10% | 55 pts | `TradeVault.sol` on-chain events |
| Session Discipline | 5% | 27 pts | Kite Passport API (budget adherence) |

### Credit Tiers & Borrowing Limits

| Score Range | Grade | Max Loan | Interest Rate (APY) |
| :--- | :--- | :--- | :--- |
| 800 – 850 | Elite | 500 PYUSD | 5% |
| 750 – 799 | Excellent | 200 PYUSD | 5% |
| 700 – 749 | Good | 200 PYUSD | 10% |
| 600 – 699 | Fair | 50 PYUSD | 15% |
| 500 – 599 | Poor | 10 PYUSD | 20% |
| < 500 | New / Rejected | 0 PYUSD | ❌ Rejected |

> Scores are stale after **7 days** — the `LendingPool.sol` contract will reject borrow requests with an outdated attestation.

---

## 🚀 Getting Started

### Prerequisites

- Node.js **v18+**
- npm or yarn
- A wallet connected to the **Kite AI Testnet**
  - RPC: `https://rpc-testnet.gokite.ai`
  - Chain ID: `2368`
- Testnet KITE (for gas) and PYUSD tokens

### Environment Setup

Copy and fill in the `.env.example` files for each service before running:

```bash
cp backend/.env.example backend/.env
cp oracle-backend/.env.example oracle-backend/.env
cp trading-agent/.env.example trading-agent/.env
```

See each `.env.example` file for a full list of required variables.

### Running Locally

> ⚠️ **Step 1 is critical** — the backend will crash without compiled contract ABIs.

**1. Compile Smart Contracts**
```bash
cd contracts
npm install
npx hardhat compile
```

**2. Start the Backend & Indexer**
```bash
cd backend
npm install
npx tsx src/index.ts
```
> Backend runs on `http://localhost:3002`

**3. Start the Frontend**
```bash
cd frontend
npm install
npm run dev
```
> Frontend runs on `http://localhost:8080` (or next available port)

**4. Run the Oracle Backend** *(Optional — required for live score computation)*
```bash
cd oracle-backend
npm install
npx tsx server.ts
```
> Oracle runs on `http://localhost:3001`

**5. Run the Trading Agent** *(Optional — simulates an AI borrower)*
```bash
cd trading-agent
npm install
npx tsx agent.ts
```
> Agent HTTP status at `http://localhost:4000`, WebSocket dashboard at `ws://localhost:4001`

---

## 🌐 Deployment

### Frontend → Vercel
- Connect your GitHub repo to Vercel.
- Set **Root Directory** to `frontend`.
- Vercel auto-detects Vite. No additional config needed.

### Backend & Oracle → Render
Create two separate **Web Services** on [render.com](https://render.com):

| Service | Root Directory | Build Command | Start Command |
| :--- | :--- | :--- | :--- |
| Backend | `backend` | `npm install && npm run build` | `npm start` |
| Oracle | `oracle-backend` | `npm install && npm run build` | `npm start` |

> ⚠️ **Critical**: The `backend` build requires contract ABIs from `/contracts/artifacts` and `/frontend/contracts/artifacts`. These must exist before deploying. Consider committing compiled artifacts to your repository.

> Add all `.env` variables in the **Environment** tab for each Render service.

---

## 🔐 Security Notes

- **Private keys are stored in `.env` files.** Ensure `.env` is in `.gitignore` and never committed.
- The oracle's `ORACLE_PRIVATE_KEY` has on-chain signing authority for `AgentScoreAttestation.sol`. Keep it secure.
- The `POOL_PRIVATE_KEY` is used for gasless PYUSD disbursements. Use a dedicated hot wallet with limited funds.
- All `.env.example` files use placeholder values — they contain **no real credentials**.

---

## ⚠️ Known Limitations & Risks

- **Testnet Only**: This platform is deployed on the Kite AI Testnet. Do not use real funds.
- **RPC Connectivity**: The backend indexer and trading agent will continuously log `ENOTFOUND` / `TIMEOUT` errors if the Kite Testnet RPC is unreachable. The system is resilient (it will auto-retry) but cannot function without chain access.
- **CSS Build Warning**: The frontend has a known `@import` order warning in `index.css` where the Google Fonts `@import` appears after `@tailwind` directives. This is non-blocking but should be fixed for production.
- **Trading Agent**: Currently uses a deterministic RSI/momentum strategy. There is no live LLM integration in the codebase.
- **Score Staleness**: Agent scores expire after 7 days. The oracle must be running to issue fresh attestations.
- **Single Oracle**: The system uses a single trusted oracle signer, which is a centralization risk for production deployments.

---

## 🛣 Future Improvements

- [ ] Integrate a live LLM (e.g., Gaia API) for AI-driven trading signal generation.
- [ ] Decentralize the oracle with multiple attesters and a consensus mechanism.
- [ ] Mainnet deployment with real PYUSD.
- [ ] Score decay for inactive agents.
- [ ] Collateral-backed borrowing as a fallback for low-score agents.
- [ ] Automated score refresh via Chainlink Automation or Kite Keeper bots.

---

## 🧑‍💻 Tech Stack Summary

| Layer | Technology |
| :--- | :--- |
| Blockchain | Kite AI Testnet (EVM-compatible, Chain ID 2368) |
| Smart Contracts | Solidity 0.8.19 + Hardhat + OpenZeppelin |
| Frontend | React 18 + Vite + TypeScript + TailwindCSS + Shadcn/UI |
| Web3 (Frontend) | Wagmi v3 + Viem + Tanstack Query |
| Backend | Node.js + Express 5 + TypeScript + Ethers.js v6 |
| Database | Supabase (PostgreSQL) with local `db.json` fallback |
| Oracle | Node.js + Express + TypeScript + Ethers.js v6 |
| Agent SDK | `gokite-aa-sdk` (Account Abstraction) |
| Identity | Kite Passport MCP (Model Context Protocol) |
| Gasless Payments | Kite Gasless API (EIP-712 `TransferWithAuthorization`) |
| Profit Splitting | X402 On-Chain Payment Standard |

---

*Built with passion for the Kite AI Ecosystem.*
