// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract LendingPool is Ownable, ReentrancyGuard {
    IERC20 public usdtToken;
    
    struct Lender {
        uint256 depositedAmount;
        uint256 lastDepositTime;
        uint256 earnedInterest;
    }
    
    struct Borrower {
        uint256 borrowedAmount;
        uint256 lastBorrowTime;
        uint256 collateralAmount;
        bool isCollateralLocked;
    }
    
    mapping(address => Lender) public lenders;
    mapping(address => Borrower) public borrowers;
    
    address[] public lenderList;
    address[] public borrowerList;
    
    uint256 public totalDeposits;
    uint256 public totalBorrowed;
    uint256 public interestRate = 500; // 5% annual interest (500 basis points)
    uint256 public collateralRatio = 150; // 150% collateral ratio
    
    event Deposited(address indexed lender, uint256 amount);
    event Withdrawn(address indexed lender, uint256 amount);
    event Borrowed(address indexed borrower, uint256 amount);
    event Repaid(address indexed borrower, uint256 amount);
    event CollateralAdded(address indexed borrower, uint256 amount);
    event InterestPaid(address indexed lender, uint256 amount);
    
    constructor(address _usdtToken) {
        usdtToken = IERC20(_usdtToken);
    }
    
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        // Transfer USDT from lender to this contract
        require(usdtToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Update lender state
        if (lenders[msg.sender].depositedAmount == 0) {
            lenderList.push(msg.sender);
        }
        
        // Calculate and add any pending interest
        uint256 pendingInterest = calculatePendingInterest(msg.sender);
        if (pendingInterest > 0) {
            lenders[msg.sender].earnedInterest += pendingInterest;
        }
        
        lenders[msg.sender].depositedAmount += amount;
        lenders[msg.sender].lastDepositTime = block.timestamp;
        totalDeposits += amount;
        
        emit Deposited(msg.sender, amount);
    }
    
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        Lender storage lender = lenders[msg.sender];
        uint256 totalAvailable = lender.depositedAmount + lender.earnedInterest;
        require(amount <= totalAvailable, "Insufficient balance");
        
        // Calculate pending interest
        uint256 pendingInterest = calculatePendingInterest(msg.sender);
        uint256 totalEarnedInterest = lender.earnedInterest + pendingInterest;
        
        // Determine withdrawal breakdown
        uint256 withdrawFromDeposit = amount > lender.depositedAmount ? lender.depositedAmount : amount;
        uint256 withdrawFromInterest = amount - withdrawFromDeposit;
        
        // Update state
        lender.depositedAmount -= withdrawFromDeposit;
        lender.earnedInterest = totalEarnedInterest - withdrawFromInterest;
        lender.lastDepositTime = block.timestamp;
        totalDeposits -= withdrawFromDeposit;
        
        // Transfer USDT to lender
        require(usdtToken.transfer(msg.sender, amount), "Transfer failed");
        
        emit Withdrawn(msg.sender, amount);
    }
    
    function borrow(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(totalDeposits >= totalBorrowed + amount, "Insufficient liquidity");
        
        Borrower storage borrower = borrowers[msg.sender];
        uint256 requiredCollateral = (amount * collateralRatio) / 100;
        
        require(borrower.collateralAmount >= requiredCollateral, "Insufficient collateral");
        
        if (borrower.borrowedAmount == 0) {
            borrowerList.push(msg.sender);
        }
        
        borrower.borrowedAmount += amount;
        borrower.lastBorrowTime = block.timestamp;
        borrower.isCollateralLocked = true;
        totalBorrowed += amount;
        
        require(usdtToken.transfer(msg.sender, amount), "Transfer failed");
        
        emit Borrowed(msg.sender, amount);
    }
    
    function repay(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        Borrower storage borrower = borrowers[msg.sender];
        require(amount <= borrower.borrowedAmount, "Amount exceeds borrowed amount");
        
        borrower.borrowedAmount -= amount;
        totalBorrowed -= amount;
        
        if (borrower.borrowedAmount == 0) {
            borrower.isCollateralLocked = false;
        }
        
        require(usdtToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        emit Repaid(msg.sender, amount);
    }
    
    function addCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        
        require(usdtToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        Borrower storage borrower = borrowers[msg.sender];
        borrower.collateralAmount += amount;
        
        emit CollateralAdded(msg.sender, amount);
    }
    
    function calculatePendingInterest(address lender) public view returns (uint256) {
        Lender memory l = lenders[lender];
        if (l.depositedAmount == 0) return 0;
        
        uint256 timeElapsed = block.timestamp - l.lastDepositTime;
        uint256 annualInterest = (l.depositedAmount * interestRate) / 10000;
        uint256 pendingInterest = (annualInterest * timeElapsed) / 365 days;
        
        return pendingInterest;
    }
    
    function getLenderPosition(address lender) external view returns (uint256 depositedAmount, uint256 earnedInterest) {
        uint256 pendingInterest = calculatePendingInterest(lender);
        return (lenders[lender].depositedAmount, lenders[lender].earnedInterest + pendingInterest);
    }
    
    function getBorrowerPosition(address borrower) external view returns (uint256 borrowedAmount, uint256 collateralAmount) {
        return (borrowers[borrower].borrowedAmount, borrowers[borrower].collateralAmount);
    }
    
    function getPoolStats() external view returns (
        uint256 _totalDeposits,
        uint256 _totalBorrowed,
        uint256 _availableLiquidity,
        uint256 _interestRate
    ) {
        return (totalDeposits, totalBorrowed, totalDeposits - totalBorrowed, interestRate);
    }
    
    function setInterestRate(uint256 newRate) external onlyOwner {
        require(newRate <= 2000, "Interest rate too high"); // Max 20%
        interestRate = newRate;
    }
    
    function setCollateralRatio(uint256 newRatio) external onlyOwner {
        require(newRatio >= 100 && newRatio <= 300, "Invalid collateral ratio");
        collateralRatio = newRatio;
    }
    
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = usdtToken.balanceOf(address(this));
        require(usdtToken.transfer(owner(), balance), "Transfer failed");
    }
}
}
