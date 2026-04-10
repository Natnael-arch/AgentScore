# KiteCredit Smart Contracts

This directory contains the Solidity smart contracts for the KiteCredit lending protocol.

## Contracts

### USDC.sol
- ERC20 token representing USDC on Kite AI Testnet
- Mintable by the contract owner
- 6 decimals (standard for USDC)

### LendingPool.sol
- Main lending protocol contract
- Handles deposits, withdrawals, borrowing, and collateral
- Interest accrual system
- Collateral management

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with your private key:
```
PRIVATE_KEY=your_private_key_here
```

3. Compile contracts:
```bash
npm run compile
```

4. Deploy to Kite AI Testnet:
```bash
npm run deploy
```

5. Update the contract addresses in `frontend/src/lib/contracts.ts` with the deployed addresses from `deployed-addresses.json`.

## Local Development

For local testing:

1. Start a local Hardhat node:
```bash
npm run node
```

2. Deploy to local network in a separate terminal:
```bash
npm run deploy:local
```

## Contract Features

### LendingPool
- **Deposit**: Users can deposit USDC to earn interest
- **Withdraw**: Users can withdraw their deposits plus earned interest
- **Borrow**: Users can borrow against their collateral
- **Repay**: Users can repay their borrowed amounts
- **Collateral**: Users can add USDC as collateral
- **Interest**: Dynamic interest rate set by owner
- **Collateral Ratio**: Configurable collateral requirement

### Interest Calculation
- Interest accrues continuously based on deposited amount and time
- Annual interest rate (default: 5%)
- Interest is calculated when depositing/withdrawing

### Security Features
- Reentrancy protection
- Ownership controls
- Emergency functions for owner
- Proper access controls

## Frontend Integration

The frontend interacts with these contracts using:
- wagmi hooks for contract interactions
- ethers.js for contract calls
- MetaMask/WalletConnect for wallet connections

## Testing

Run the test suite:
```bash
npm test
```

## Verification

After deployment, verify contracts on KiteScan:
```bash
npm run verify <contract-address>
```

## Notes

- Make sure you have KITE tokens in your wallet for gas fees
- The USDC contract starts with 1,000,000 USDC minted to the deployer
- Initial liquidity of 5,000 USDC is added to the lending pool during deployment
