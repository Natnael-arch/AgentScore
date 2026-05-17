const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider("https://rpc-testnet.gokite.ai/");

const ORACLE = "0xF04B3a11db07d206F61Bf08645169793cbD442C3";
const X402 = "0x18BE09e6986B61eAa7Cbe4fA21Df1b512DDFc252";

async function checkLogs() {
  const scoreAttestedTopic = ethers.id("ScoreAttested(address,uint16,uint32)");
  const splitPaymentTopic = ethers.id("PaymentSplit(address,address,address,uint256,uint256,uint256)");

  const filterAttest = { address: ORACLE, topics: [scoreAttestedTopic], fromBlock: 0, toBlock: 'latest' };
  const filterSplit = { address: X402, topics: [splitPaymentTopic], fromBlock: 0, toBlock: 'latest' };

  try {
    const logsAttest = await provider.getLogs(filterAttest);
    console.log(`ScoreAttested: ${logsAttest.length > 0 ? logsAttest[logsAttest.length-1].transactionHash : 'None'}`);

    const logsSplit = await provider.getLogs(filterSplit);
    console.log(`PaymentSplit: ${logsSplit.length > 0 ? logsSplit[logsSplit.length-1].transactionHash : 'None'}`);
  } catch(e) {
    console.log("Error:", e.message);
  }
}
checkLogs();
