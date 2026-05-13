import { ethers, network } from "hardhat";
import * as fs from "fs";

async function main() {
  console.log("Starting Integrated Deployment (LendingPool + X402Processor) with ethers v6...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  console.log("Connected to network:", network.name, network.config.chainId);

  // ── Existing contracts (already deployed by Nate) ──
  const AGENT_SCORE_ATTESTATION = "0xF04B3a11db07d206F61Bf08645169793cbD442C3";
  const PYUSD_ADDRESS = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";

  console.log("\nUsing existing contracts:");
  console.log("  AgentScoreAttestation:", AGENT_SCORE_ATTESTATION);
  console.log("  PYUSD Token:", PYUSD_ADDRESS);

  // 1. Deploy LendingPool (passing PYUSD + AgentScoreAttestation)
  console.log("\nDeploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const lendingPool = await LendingPool.deploy(PYUSD_ADDRESS, AGENT_SCORE_ATTESTATION);
  await lendingPool.deployed();
  const lendingPoolAddress = lendingPool.address;
  console.log("LendingPool deployed to:", lendingPoolAddress);

  // 2. Deploy X402Processor (passing LendingPool address)
  console.log("Deploying X402Processor...");
  const X402Processor = await ethers.getContractFactory("X402Processor");
  const x402Processor = await X402Processor.deploy(lendingPoolAddress);
  await x402Processor.deployed();
  const x402ProcessorAddress = x402Processor.address;
  console.log("X402Processor deployed to:", x402ProcessorAddress);

  // 3. Configure inter-contract settings
  console.log("\nConfiguring contracts...");
  const tx = await lendingPool.setX402Processor(x402ProcessorAddress);
  await tx.wait();
  console.log("✓ X402Processor set in LendingPool");

  console.log("\nDeployment Summary:");
  console.log("==================");
  console.log("AgentScoreAttestation (existing):", AGENT_SCORE_ATTESTATION);
  console.log("LendingPool:", lendingPoolAddress);
  console.log("X402Processor:", x402ProcessorAddress);
  console.log("PYUSD Token:", PYUSD_ADDRESS);

  // Save addresses
  const addresses = {
    agentScoreAttestation: AGENT_SCORE_ATTESTATION,
    lendingPool: lendingPoolAddress,
    x402Processor: x402ProcessorAddress,
    pyusd: PYUSD_ADDRESS,
    deployer: deployer.address,
    network: network.config.chainId === 2368 ? "kite-testnet" : "local-hardhat",
    chainId: network.config.chainId
  };

  fs.writeFileSync("deployed-addresses.json", JSON.stringify(addresses, null, 2));
  console.log("\n✅ Addresses saved to deployed-addresses.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
