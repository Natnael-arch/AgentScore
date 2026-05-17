import { ethers } from "hardhat";

// Pre-generated demo addresses (deterministic from fixed mnemonics)
const DEMO_AGENTS = [
  {
    name: "Alice",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    score: 724,
    paymentRate: 92,
    diversity: 8,
    txCount: 45,
    agentAgeDays: 28,
  },
  {
    name: "Bob",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    score: 300,
    paymentRate: 0,
    diversity: 0,
    txCount: 0,
    agentAgeDays: 0,
  },
  {
    name: "Charlie",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    score: 481,
    paymentRate: 51,
    diversity: 3,
    txCount: 18,
    agentAgeDays: 9,
  },
];

async function main() {
  const contractAddress = process.env.SCORE_CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("Missing SCORE_CONTRACT_ADDRESS in environment. Deploy the contract first.");
  }

  const [oracle] = await ethers.getSigners();
  console.log("Seeding with oracle:", oracle.address);

  const abi = [
    "function attest(address,uint16,uint8,uint8,uint32,uint16) external",
  ];
  const contract = new ethers.Contract(contractAddress, abi, oracle);

  for (const agent of DEMO_AGENTS) {
    console.log(`\nAttesting ${agent.name} (${agent.address})...`);
    const tx = await contract.attest(
      agent.address,
      agent.score,
      agent.paymentRate,
      agent.diversity,
      agent.txCount,
      agent.agentAgeDays
    );
    await tx.wait();
    console.log(`  ✅ ${agent.name}: score=${agent.score}`);
    console.log(`  🔗 https://testnet.kitescan.ai/address/${agent.address}`);
  }

  console.log("\n🎉 All demo agents seeded successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
