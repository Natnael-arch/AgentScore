import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying AgentScoreAttestation with oracle:", deployer.address);

  const Factory = await ethers.getContractFactory("AgentScoreAttestation");
  const contract = await Factory.deploy(deployer.address);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("✅ AgentScoreAttestation deployed to:", address);
  console.log("🔗 Explorer: https://testnet.kitescan.ai/address/" + address);
  console.log("\nAdd this to your .env files:");
  console.log(`SCORE_CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
