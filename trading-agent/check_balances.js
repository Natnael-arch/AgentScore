const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider("https://rpc-testnet.gokite.ai/");
const pyusdAddress = "0x8E04D099b1a8Dd20E6caD4b2Ab2B405B98242ec9";
const abi = ["function balanceOf(address) external view returns (uint256)"];
const contract = new ethers.Contract(pyusdAddress, abi, provider);

const addresses = {
  Agent: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
  Oracle: "0x55d829A66BB1D9f82923cBDEe355249EE5940365",
  Passport: "0x162b595597E9106FD04509AE9487b3ba02454B6a",
  LendingPool: "0x16c110a07640831b98EF82dFFa3D2eBF8c8067dE",
  X402Processor: "0x18BE09e6986B61eAa7Cbe4fA21Df1b512DDFc252"
};

async function main() {
  for (const [name, address] of Object.entries(addresses)) {
    try {
      const balance = await contract.balanceOf(address);
      console.log(`${name}: ${ethers.formatUnits(balance, 18)} PYUSD`);
    } catch (e) {
      console.log(`${name}: Error ${e.message}`);
    }
  }
}
main();
