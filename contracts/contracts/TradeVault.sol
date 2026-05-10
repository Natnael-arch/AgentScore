// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TradeVault
 * @notice On-chain position tracker for KiteCredit autonomous trading agent.
 *         Tracks leveraged positions, P&L, and trade history.
 */
contract TradeVault {

    enum Side   { LONG, SHORT }
    enum Status { OPEN, CLOSED }

    struct Position {
        address  agent;
        string   asset;
        Side     side;
        uint256  entryPrice;    // price * 100 (2 decimal fixed-point)
        uint256  size;          // in wei (18 decimals, e.g. 10 PYUSD = 10e18)
        uint256  openedAt;
        uint256  closedAt;
        uint256  exitPrice;
        int256   pnl;           // realised P&L in wei
        Status   status;
        bytes32  txHashOpen;
        bytes32  txHashClose;
    }

    address public immutable owner;

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;
    uint256[] private openPositionIds;

    uint256 public winCount;
    uint256 public lossCount;
    int256  public totalPnl;

    event PositionOpened(uint256 indexed id, address indexed agent, string asset, Side side, uint256 entryPrice, uint256 size);
    event PositionClosed(uint256 indexed id, int256 pnl, uint256 exitPrice);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Open a new trading position.
     * @param asset      Asset ticker (e.g. "ETH")
     * @param side       0 = LONG, 1 = SHORT
     * @param entryPrice Price * 100 (fixed-point, 2 decimals)
     * @param size       Position size in wei (18 decimals)
     * @return id        The new position ID
     */
    function openPosition(
        string calldata asset,
        uint8 side,
        uint256 entryPrice,
        uint256 size
    ) external onlyOwner returns (uint256) {
        require(side <= 1, "Invalid side");
        require(entryPrice > 0, "Price must be > 0");
        require(size > 0, "Size must be > 0");

        uint256 id = nextPositionId++;
        positions[id] = Position({
            agent:        msg.sender,
            asset:        asset,
            side:         Side(side),
            entryPrice:   entryPrice,
            size:         size,
            openedAt:     block.timestamp,
            closedAt:     0,
            exitPrice:    0,
            pnl:          0,
            status:       Status.OPEN,
            txHashOpen:   bytes32(0),
            txHashClose:  bytes32(0)
        });

        openPositionIds.push(id);
        emit PositionOpened(id, msg.sender, asset, Side(side), entryPrice, size);
        return id;
    }

    /**
     * @notice Close an open position with exit price and realised P&L.
     * @param id         Position ID
     * @param exitPrice  Exit price * 100 (fixed-point)
     * @param pnl        Realised P&L in wei
     * @param txHash     Transaction hash of the closing trade
     */
    function closePosition(
        uint256 id,
        uint256 exitPrice,
        int256  pnl,
        bytes32 txHash
    ) external onlyOwner {
        Position storage pos = positions[id];
        require(pos.status == Status.OPEN, "Position not open");

        pos.exitPrice   = exitPrice;
        pos.pnl         = pnl;
        pos.closedAt    = block.timestamp;
        pos.status      = Status.CLOSED;
        pos.txHashClose = txHash;

        totalPnl += pnl;
        if (pnl >= 0) {
            winCount++;
        } else {
            lossCount++;
        }

        // Remove from openPositionIds
        for (uint256 i = 0; i < openPositionIds.length; i++) {
            if (openPositionIds[i] == id) {
                openPositionIds[i] = openPositionIds[openPositionIds.length - 1];
                openPositionIds.pop();
                break;
            }
        }

        emit PositionClosed(id, pnl, exitPrice);
    }

    /**
     * @notice Get all currently open position IDs.
     */
    function getOpenPositions() external view returns (uint256[] memory) {
        return openPositionIds;
    }

    /**
     * @notice Get aggregate vault statistics.
     * @return totalTrades  Total number of positions ever opened
     * @return wins         Number of winning trades
     * @return losses       Number of losing trades
     * @return winRate      Win rate (0-100), or 0 if no closed trades
     * @return pnl          Total realised P&L in wei
     * @return openCount    Number of currently open positions
     */
    function getStats() external view returns (
        uint256 totalTrades,
        uint256 wins,
        uint256 losses,
        uint256 winRate,
        int256  pnl,
        uint256 openCount
    ) {
        totalTrades = nextPositionId;
        wins        = winCount;
        losses      = lossCount;
        uint256 closed = wins + losses;
        winRate     = closed > 0 ? (wins * 100) / closed : 0;
        pnl         = totalPnl;
        openCount   = openPositionIds.length;
    }
}
