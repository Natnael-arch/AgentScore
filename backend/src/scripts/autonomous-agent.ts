import { ethers } from "ethers";

const API_URL = "http://localhost:3001/api";

async function runAutonomousAgent() {
  console.log("🤖 Booting Up Autonomous Agent Demo...");

  // 1. Generate identity
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;
  const name = `Auto-Trader Bot ${Math.floor(Math.random() * 9000) + 1000}`;
  
  console.log(`\n🔑 Generated Agent Identity:
  Name: ${name}
  Address: ${address}
  Private Key: [HIDDEN]
  `);

  // 2. Register Agent
  try {
    const regRes = await fetch(`${API_URL}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address,
        name,
        agent_type: "Algorithmic Trader",
        model_hash: "0x" + ethers.hexlify(ethers.randomBytes(32)).slice(2),
      }),
    });

    if (!regRes.ok) throw new Error("Failed to register");
    console.log("✅ Agent successfully registered on KiteCredit Protocol.");
  } catch (err) {
    console.error("Failed to register:", err);
    process.exit(1);
  }

  // Helper to sign payloads
  const signPayload = async (payload: any) => {
    const timestamp = Date.now().toString();
    const message = JSON.stringify(payload) + timestamp;
    const signature = await wallet.signMessage(message);
    return { signature, timestamp };
  };

  let loopCount = 0;

  let isProcessing = false;

  // 3. The Autonomous Loop
  setInterval(async () => {
    if (isProcessing) return;
    isProcessing = true;

    try {
      loopCount++;
      console.log(`\n--- Tick ${loopCount} ---`);

      // A. Perform a fake job to earn revenue
      const amountEarned = Math.floor(Math.random() * 50) + 10;
      console.log(`💼 Agent executed a trade and earned $${amountEarned}. Recording transaction...`);

      const txPayload = {
        from_address: address,
        to_address: "0xKiteGasStationPool",
        amount: amountEarned,
        service_name: "DeFi Arbitrage",
        status: "success",
      };

      const { signature: txSig, timestamp: txTime } = await signPayload(txPayload);

      const txRes = await fetch(`${API_URL}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-signature": txSig,
          "x-timestamp": txTime,
        },
        body: JSON.stringify(txPayload),
      });

      if (txRes.ok) {
        const txData = await txRes.json() as any;
        if (txData.repayment) {
          console.log(`💸 WATERFALL: $${txData.repayment.repaymentPortion} routed to loan repayment! Agent kept $${txData.repayment.agentPortion}.`);
        } else {
          console.log(`✅ Revenue secured. Score building...`);
        }
      }

      // B. Check for loan
      // Every 5 ticks, check if we need a loan
      if (loopCount % 5 === 0) {
        console.log("🧠 Agent analyzing credit position and evaluating borrowing options...");
        
        const checkActiveRes = await fetch(`${API_URL}/loans/active/${address}`);
        const activeLoan = await checkActiveRes.json();

        if (activeLoan && !activeLoan.error) {
          console.log(`📊 Agent currently holds a loan. Outstanding debt: $${activeLoan.total_owed - activeLoan.total_repaid}. Continuing to work to repay.`);
        } else {
          const termsRes = await fetch(`${API_URL}/loans/terms/${address}`);
          const termsData = await termsRes.json() as any;

          if (termsData.eligible) {
            console.log(`🎯 Agent is eligible for $${termsData.maxLoan}! Requesting instantly...`);

            const borrowPayload = {
              borrower_address: address,
              amount: termsData.maxLoan,
            };

            const { signature: borrowSig, timestamp: borrowTime } = await signPayload(borrowPayload);

            const borrowRes = await fetch(`${API_URL}/loans/borrow`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-agent-signature": borrowSig,
                "x-timestamp": borrowTime,
              },
              body: JSON.stringify(borrowPayload),
            });

            if (borrowRes.ok) {
              const loanData = await borrowRes.json() as any;
              console.log(`\n🎉 LOAN SECURED 🎉
            Amount: $${termsData.maxLoan}
            Interest: ${termsData.interestRate}%
            Waterfall Split: ${termsData.repaymentSplit}%
            TxHash: ${loanData.txHash || 'Pending'}
            `);
            } else {
              console.log(`❌ Loan denied: ${await borrowRes.text()}`);
            }
          } else {
            console.log("📉 Agent still building reputation. Score is too low to borrow.");
          }
        }
      }
    } finally {
      isProcessing = false;
    }
  }, 4000); // 4 seconds interval for presentation purposes
}

runAutonomousAgent();
