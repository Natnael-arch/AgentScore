// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract X402Processor is Ownable, ReentrancyGuard {
    address public lendingPool;
    uint256 public constant REPAYMENT_PERCENTAGE = 30;

    event PaymentSplit(
        address indexed from,
        address indexed to,
        address indexed token,
        uint256 totalAmount,
        uint256 agentPortion,
        uint256 poolPortion
    );

    constructor(address _lendingPool) {
        lendingPool = _lendingPool;
    }

    function setLendingPool(address _lendingPool) external onlyOwner {
        lendingPool = _lendingPool;
    }

    /**
     * @dev Process a split payment under the x402 standard.
     * 30% goes to the LendingPool for repayment, 70% goes to the Agent's wallet.
     */
    function splitPayment(
        address _token,
        address _targetAgent,
        uint256 _amount
    ) external nonReentrant {
        require(_amount > 0, "Amount must be > 0");
        require(_targetAgent != address(0), "Invalid agent address");
        
        uint256 poolPortion = (_amount * REPAYMENT_PERCENTAGE) / 100;
        uint256 agentPortion = _amount - poolPortion;

        IERC20 token = IERC20(_token);

        // Transfer pool portion to LendingPool
        require(token.transferFrom(msg.sender, lendingPool, poolPortion), "Pool transfer failed");
        
        // Transfer agent portion to the agent's wallet
        require(token.transferFrom(msg.sender, _targetAgent, agentPortion), "Agent transfer failed");

        emit PaymentSplit(msg.sender, _targetAgent, _token, _amount, agentPortion, poolPortion);
    }
}
