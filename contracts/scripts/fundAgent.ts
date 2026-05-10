import { ethers } from "hardhat";

async function main() {
  const [oracle] = await ethers.getSigners();
  const agentAddr = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
  
  console.log("Sending 0.2 KITE from oracle to agent wallet...");
  console.log(`  From: ${oracle.address}`);
  console.log(`  To:   ${agentAddr}`);
  
  const tx = await oracle.sendTransaction({
    to: agentAddr,
    value: ethers.parseEther("0.2")
  });
  await tx.wait();
  
  console.log(`✅ Sent! tx: ${tx.hash}`);
  
  const balance = await ethers.provider.getBalance(agentAddr);
  console.log(`Agent balance: ${ethers.formatEther(balance)} KITE`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
