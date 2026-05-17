import { kiteTestnet, PYUSD_ADDRESS, LENDING_POOL_ADDRESS, AGENT_REGISTRY_ADDRESS, X402_PROCESSOR_ADDRESS } from './web3-config';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseEther } from 'viem';
// PYUSD Contract ABI (minimal)
export const PYUSD_ABI = [
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
  {
    inputs: [{ internalType: 'address', name: 'borrower', type: 'address' }],
    name: 'getBorrowerPosition',
    outputs: [
      { internalType: 'uint256', name: 'borrowedAmount', type: 'uint256' },
      { internalType: 'uint256', name: 'collateralAmount', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const AGENT_SCORE_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'agent', type: 'address' }],
    name: 'getFullRecord',
    outputs: [
      {
        components: [
          { internalType: 'uint16', name: 'score', type: 'uint16' },
          { internalType: 'uint32', name: 'timestamp', type: 'uint32' },
          { internalType: 'uint8', name: 'paymentRate', type: 'uint8' },
          { internalType: 'uint8', name: 'diversity', type: 'uint8' },
          { internalType: 'uint32', name: 'txCount', type: 'uint32' },
          { internalType: 'uint16', name: 'agentAgeDays', type: 'uint16' },
        ],
        internalType: 'struct AgentScoreAttestation.ScoreRecord',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'agent', type: 'address' }],
    name: 'getScore',
    outputs: [
      { internalType: 'uint16', name: 'score', type: 'uint16' },
      { internalType: 'uint32', name: 'timestamp', type: 'uint32' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const usePYUSDBalance = (address: string | undefined) => {
  return useReadContract({
    address: PYUSD_ADDRESS,
    abi: PYUSD_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: kiteTestnet.id,
  });
};

export const usePYUSDDecimals = () => {
  return useReadContract({
    address: PYUSD_ADDRESS,
    abi: PYUSD_ABI,
    functionName: 'decimals',
    chainId: kiteTestnet.id,
  });
};

export const useDepositToLendingPool = (account?: string) => {
  const { writeContractAsync, isPending, data: hash } = useWriteContract();
  const publicClient = usePublicClient();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const deposit = async (amount: string): Promise<boolean> => {
    try {
      // PYUSD has 18 decimals on Kite Testnet
      const amountInWei = parseEther(amount);
      
      // Approve PYUSD spending
      const approveHash = await writeContractAsync({
        address: PYUSD_ADDRESS,
        abi: PYUSD_ABI,
        functionName: 'approve',
        args: [LENDING_POOL_ADDRESS, amountInWei],
        chain: kiteTestnet,
        account: account as `0x${string}`,
      });
      
      // Wait for approval confirmation properly using Viem publicClient
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      } else {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      const depositHash = await writeContractAsync({
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: 'deposit',
        args: [amountInWei],
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
      const amountInWei = parseEther(amount);
      const withdrawHash = await writeContractAsync({
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: 'withdraw',
        args: [amountInWei],
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
    abi: AGENT_SCORE_ABI,
    functionName: 'getFullRecord',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: kiteTestnet.id,
  });
};

export const useRegisterAgentOnChain = () => {
  return { 
    register: async () => { console.warn("Registry replaced by automated attestation"); return false; }, 
    isPending: false, 
    isConfirming: false, 
    isConfirmed: false 
  };
};

export const useBorrowFromLendingPool = (account?: string) => {
  const { writeContractAsync, isPending, data: hash } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const borrow = async (amount: string): Promise<boolean> => {
    try {
      // PYUSD has 18 decimals on Kite Testnet
      const amountInWei = parseEther(amount);
      
      const borrowHash = await writeContractAsync({
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: 'borrow',
        args: [amountInWei],
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
