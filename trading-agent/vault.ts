import { ethers } from "ethers";

export const VAULT_ABI = [
  "function openPosition(string,uint8,uint256,uint256) external returns (uint256)",
  "function closePosition(uint256,uint256,int256,bytes32) external",
  "function getOpenPositions() external view returns (uint256[])",
  "function positions(uint256) external view returns (address,string,uint8,uint256,uint256,uint256,uint256,uint256,int256,uint8,bytes32,bytes32)",
  "function getStats() external view returns (uint256,uint256,uint256,uint256,int256,uint256)",
  "function winCount() external view returns (uint256)",
  "function lossCount() external view returns (uint256)",
  "function totalPnl() external view returns (int256)"
];

export interface PositionData {
  id:          number;
  asset:       string;
  side:        "LONG" | "SHORT";
  entryPrice:  number;
  sizeUSDC:    number;
  openedAt:    number;
  status:      string;
  pnl:         number;
}

export interface VaultStats {
  totalTrades: number;
  winCount:    number;
  lossCount:   number;
  winRate:     number;
  totalPnl:    number;
  openCount:   number;
}

export function getVaultContract(
  address: string,
  wallet: ethers.Wallet
): ethers.Contract {
  return new ethers.Contract(address, VAULT_ABI, wallet);
}

export async function getVaultStats(vault: ethers.Contract): Promise<VaultStats> {
  try {
    const stats = await vault.getStats();
    return {
      totalTrades: Number(stats[0]),
      winCount:    Number(stats[1]),
      lossCount:   Number(stats[2]),
      winRate:     Number(stats[3]),
      totalPnl:    Number(ethers.formatEther(stats[4])),
      openCount:   Number(stats[5])
    };
  } catch {
    return { totalTrades: 0, winCount: 0, lossCount: 0, winRate: 0, totalPnl: 0, openCount: 0 };
  }
}

export async function getOpenPositionDetails(
  vault: ethers.Contract
): Promise<PositionData[]> {
  try {
    const openIds: bigint[] = await vault.getOpenPositions();
    const positions: PositionData[] = [];

    for (const id of openIds) {
      const pos = await vault.positions(id);
      positions.push({
        id:         Number(id),
        asset:      pos[1],
        side:       pos[2] === 0n ? "LONG" : "SHORT",
        entryPrice: Number(pos[3]) / 100,
        sizeUSDC:   Number(ethers.formatEther(pos[4])),
        openedAt:   Number(pos[5]),
        status:     "OPEN",
        pnl:        0
      });
    }
    return positions;
  } catch {
    return [];
  }
}
