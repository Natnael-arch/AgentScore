import { parseEther, formatEther } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { kiteTestnet, USDT_ADDRESS, LENDING_POOL_ADDRESS, AGENT_REGISTRY_ADDRESS, X402_PROCESSOR_ADDRESS } from './web3-config';

// USDT Contract ABI (minimal)
export const USDT_ABI = [
  {
    inputs: [
      { internalType: 'string', name: 'name', type: 'string' },
      { internalType: 'string', name: 'symbol', type: 'string' },
      { internalType: 'uint8', name: 'decimals', type: 'uint8' },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// Lending Pool Contract ABI (minimal)
export const LENDING_POOL_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'lender', type: 'address' },
    ],
    name: 'getLenderPosition',
    outputs: [
      { internalType: 'uint256', name: 'deposited_amount', type: 'uint256' },
      { internalType: 'uint256', name: 'earned_interest', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'borrow',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: '_borrower', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'repay',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const AGENT_REGISTRY_ABI = [
  {
    inputs: [{ internalType: 'address', name: '_agentAddress', type: 'address' }],
    name: 'getAgent',
    outputs: [
      {
        components: [
          { internalType: 'string', name: 'name', type: 'string' },
          { internalType: 'string', name: 'agentType', type: 'string' },
          { internalType: 'string', name: 'modelHash', type: 'string' },
          { internalType: 'uint256', name: 'score', type: 'uint256' },
          { internalType: 'bool', name: 'registered', type: 'bool' },
          { internalType: 'uint256', name: 'lastUpdated', type: 'uint256' },
        ],
        internalType: 'struct AgentRegistry.Agent',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '_agentAddress', type: 'address' }],
    name: 'getScore',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'string', name: '_name', type: 'string' },
      { internalType: 'string', name: '_agentType', type: 'string' },
      { internalType: 'string', name: '_modelHash', type: 'string' },
    ],
    name: 'registerAgent',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const useUSDTBalance = (address: string | undefined) => {
  return useReadContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: kiteTestnet.id,
  });
};

export const useUSDTDecimals = () => {
  return useReadContract({
    address: USDT_ADDRESS,
    abi: USDT_ABI,
    functionName: 'decimals',
    chainId: kiteTestnet.id,
  });
};

export const useDepositToLendingPool = (account?: string) => {
  const { writeContractAsync, isPending, data: hash } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const deposit = async (amount: string): Promise<boolean> => {
    try {
      // USDT has 6 decimals on Kite Testnet
      const decimals = 6;
      
      // Convert amount to wei format
      const amountInWei = parseEther(amount);
      const adjustedAmount = (amountInWei * BigInt(10 ** decimals)) / BigInt(10 ** 18);
      
      // Approve USDT spending
      const approveHash = await writeContractAsync({
        address: USDT_ADDRESS,
        abi: USDT_ABI,
        functionName: 'approve',
        args: [LENDING_POOL_ADDRESS, BigInt(adjustedAmount)],
        chain: kiteTestnet,
        account: account as `0x${string}`,
      });
      
      // Wait for approval confirmation, then deposit
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const depositHash = await writeContractAsync({
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: 'deposit',
        args: [BigInt(adjustedAmount)],
        chain: kiteTestnet,
        account: account as `0x${string}`,
      });
      
      return !!depositHash;
    } catch (error) {
      console.error('Deposit failed:', error);
      throw error;
    }
  };

  return {
    deposit,
    isPending,
    isConfirming,
    isConfirmed,
  };
};

export const useWithdrawFromLendingPool = (account?: string) => {
  const { writeContractAsync, isPending, data: hash } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const withdraw = async (amount: string): Promise<boolean> => {
    try {
      // USDT has 6 decimals on Kite Testnet
      const decimals = 6;
      const amountInWei = parseEther(amount);
      const adjustedAmount = (amountInWei * BigInt(10 ** decimals)) / BigInt(10 ** 18);
      
      const withdrawHash = await writeContractAsync({
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: 'withdraw',
        args: [BigInt(adjustedAmount)],
        chain: kiteTestnet,
        account: account as `0x${string}`,
      });
      
      return !!withdrawHash;
    } catch (error) {
      console.error('Withdraw failed:', error);
      throw error;
    }
  };

  return {
    withdraw,
    isPending,
    isConfirming,
    isConfirmed,
  };
};

export const useLenderPosition = (address: string | undefined) => {
  return useReadContract({
    address: LENDING_POOL_ADDRESS,
    abi: LENDING_POOL_ABI,
    functionName: 'getLenderPosition',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: kiteTestnet.id,
  });
};

export const useAgentOnChainData = (address: string | undefined) => {
  return useReadContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: 'getAgent',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: kiteTestnet.id,
  });
};

export const useRegisterAgentOnChain = () => {
  const { writeContractAsync, isPending, data: hash } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const register = async (name: string, type: string, hashStr: string): Promise<boolean> => {
    try {
      const txHash = await writeContractAsync({
        address: AGENT_REGISTRY_ADDRESS,
        abi: AGENT_REGISTRY_ABI,
        functionName: 'registerAgent',
        args: [name, type, hashStr],
        chain: kiteTestnet,
      });
      return !!txHash;
    } catch (error) {
      console.error('On-chain registration failed:', error);
      throw error;
    }
  };

  return { register, isPending, isConfirming, isConfirmed };
};

export const useBorrowFromLendingPool = (account?: string) => {
  const { writeContractAsync, isPending, data: hash } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const borrow = async (amount: string): Promise<boolean> => {
    try {
      // USDT has 6 decimals on Kite Testnet
      const decimals = 6;
      const amountInWei = parseEther(amount);
      const adjustedAmount = (amountInWei * BigInt(10 ** decimals)) / BigInt(10 ** 18);
      
      const borrowHash = await writeContractAsync({
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: 'borrow',
        args: [BigInt(adjustedAmount)],
        chain: kiteTestnet,
        account: account as `0x${string}`,
      });
      
      return !!borrowHash;
    } catch (error) {
      console.error('Borrow failed:', error);
      throw error;
    }
  };

  return {
    borrow,
    isPending: isPending || isConfirming,
    isConfirmed,
    hash
  };
};

export const useBorrowerPosition = (address: string | undefined) => {
  return useReadContract({
    address: LENDING_POOL_ADDRESS,
    abi: LENDING_POOL_ABI,
    functionName: 'getBorrowerPosition',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: kiteTestnet.id,
  });
};
