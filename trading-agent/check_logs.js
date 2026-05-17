const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider("https://rpc-testnet.gokite.ai/");

const VAULT = "0x30980D5Efd3489B65D3dc0E65b61C01B357a8DBa";
const ORACLE = "0xF04B3a11db07d206F61Bf08645169793cbD442C3";
const X402 = "0x18BE09e6986B61eAa7Cbe4fA21Df1b512DDFc252";

async function checkLogs() {
  const vaultOpenTopic = ethers.id("PositionOpened(uint256,address,string,uint8,uint256,uint256)");
  const vaultCloseTopic = ethers.id("PositionClosed(uint256,uint8,uint256,int256)");
  const scoreAttestedTopic = ethers.id("ScoreAttested(address,uint16,uint32)");
  const splitPaymentTopic = ethers.id("PaymentSplit(address,address,address,uint256,uint256,uint256)");

  const filterOpen = { address: VAULT, topics: [vaultOpenTopic], fromBlock: -50000, toBlock: 'latest' };
  const filterClose = { address: VAULT, topics: [vaultCloseTopic], fromBlock: -50000, toBlock: 'latest' };
  const filterAttest = { address: ORACLE, topics: [scoreAttestedTopic], fromBlock: -50000, toBlock: 'latest' };
  const filterSplit = { address: X402, topics: [splitPaymentTopic], fromBlock: -50000, toBlock: 'latest' };

  try {
    const logsOpen = await provider.getLogs(filterOpen);
    console.log(`OpenPosition: ${logsOpen.length > 0 ? logsOpen[0].transactionHash : 'None'}`);

    const logsClose = await provider.getLogs(filterClose);
    console.log(`ClosePosition: ${logsClose.length > 0 ? logsClose[0].transactionHash : 'None'}`);

    const logsAttest = await provider.getLogs(filterAttest);
    console.log(`ScoreAttested: ${logsAttest.length > 0 ? logsAttest[logsAttest.length-1].transactionHash : 'None'}`);

    const logsSplit = await provider.getLogs(filterSplit);
    console.log(`PaymentSplit: ${logsSplit.length > 0 ? logsSplit[logsSplit.length-1].transactionHash : 'None'}`);
  } catch(e) {
    console.log("Error:", e.message);
  }
}
checkLogs();
