-- ============================================================
-- KiteCredit Lending Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL → New Query)
-- ============================================================

-- 1. Agents table (basic info — scoring friend will extend this)
CREATE TABLE IF NOT EXISTS agents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT 'Unknown Agent',
  agent_type TEXT NOT NULL DEFAULT 'General Purpose',
  model_hash TEXT,
  identity_status TEXT NOT NULL DEFAULT 'Unverified' CHECK (identity_status IN ('Verified', 'Pending', 'Unverified')),
  score INTEGER NOT NULL DEFAULT 300 CHECK (score >= 300 AND score <= 850),
  transaction_volume NUMERIC(20, 6) NOT NULL DEFAULT 0,
  total_payments INTEGER NOT NULL DEFAULT 0,
  failed_payments INTEGER NOT NULL DEFAULT 0,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Lending pool — tracks global pool state
CREATE TABLE IF NOT EXISTS lending_pool (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  total_deposited NUMERIC(20, 6) NOT NULL DEFAULT 0,
  total_borrowed NUMERIC(20, 6) NOT NULL DEFAULT 0,
  total_repaid NUMERIC(20, 6) NOT NULL DEFAULT 0,
  total_interest_earned NUMERIC(20, 6) NOT NULL DEFAULT 0,
  default_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed a single pool row
INSERT INTO lending_pool (total_deposited, total_borrowed, total_repaid, total_interest_earned)
VALUES (0, 0, 0, 0)
ON CONFLICT DO NOTHING;

-- 3. Lender positions
CREATE TABLE IF NOT EXISTS lender_positions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lender_address TEXT NOT NULL,
  deposited_amount NUMERIC(20, 6) NOT NULL DEFAULT 0,
  earned_interest NUMERIC(20, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lender_address)
);

-- 4. Loans
CREATE TABLE IF NOT EXISTS loans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  borrower_address TEXT NOT NULL REFERENCES agents(address),
  principal NUMERIC(20, 6) NOT NULL,
  interest_rate NUMERIC(5, 2) NOT NULL,
  repayment_split NUMERIC(5, 2) NOT NULL DEFAULT 30.00,
  total_repaid NUMERIC(20, 6) NOT NULL DEFAULT 0,
  total_owed NUMERIC(20, 6) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'repaid', 'defaulted')),
  score_at_origination INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  repaid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Loan repayments
CREATE TABLE IF NOT EXISTS loan_repayments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id UUID NOT NULL REFERENCES loans(id),
  amount NUMERIC(20, 6) NOT NULL,
  source TEXT NOT NULL DEFAULT 'x402_split',
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Transactions (x402 payment records)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  service_name TEXT NOT NULL DEFAULT 'Unknown Service',
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'pending')),
  repayment_portion NUMERIC(20, 6) DEFAULT 0,
  agent_portion NUMERIC(20, 6) DEFAULT 0,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_address);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_repayments_loan ON loan_repayments(loan_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER loans_updated_at BEFORE UPDATE ON loans FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER lending_pool_updated_at BEFORE UPDATE ON lending_pool FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER lender_positions_updated_at BEFORE UPDATE ON lender_positions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
