// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Affiliate.sol";

contract Admin is Affiliate {
    enum StatusType {
        Inactive, // both deposit and withdrawal are inactive
        DepositInactive, // Not accepting deposits
        Active 
    }
    
    enum FeeType {
        Entry,
        Farming,
        Referral
    }

    constructor() Affiliate() {}

    StatusType public contractStatus = StatusType.Inactive;

    uint8 public entryFee = 1;
    uint8 public farmingFee = 30;
    uint public profits; // bnb profits for admin
    mapping(address => uint) public profitsInToken; // altcoins profits for admin

    event StatusChanged(StatusType indexed statusType);
    event FeeChange(FeeType indexed feeType, uint8 amount);
    event ProfitWithdraw(FeeType feeType, uint amount, address token, address userAddr);

    function amtWithFee(FeeType feeType ,uint amount) public view returns (uint) {
        if(feeType == FeeType.Farming) {
            return uint256((amount * (100 - farmingFee)) / 100);
        } else {
            return uint256((amount * (100 - entryFee)) / 100);
        }   
    }

    function feeToProtocol(FeeType feeType, uint amount) public view returns(uint) {
        if(feeType == FeeType.Farming) {
            return uint256((amount * farmingFee) / 100);
        } else {
            return uint256((amount * entryFee) / 100);
        }
    }

    // Owner's only
    function changeFee(FeeType feeType, uint8 fee) external onlyOwner {
        if(feeType == FeeType.Entry) {
            entryFee = fee;
            emit FeeChange(FeeType.Entry, fee);
        } else {
            farmingFee = fee;
            emit FeeChange(FeeType.Farming, fee);
        }
    }

    function changeStatus(StatusType statusType) external onlyOwner {
        contractStatus = statusType;
        emit StatusChanged(statusType);
    }

    function withdrawProfits() external onlyOwner {
        require(profits > 0, "Not enough gasToken to withdraw");
        uint withdrawAmt = profits;
        profits = 0;
        (bool success, ) = payable(msg.sender).call{ value: withdrawAmt }("");
        emit ProfitWithdraw(FeeType.Entry, withdrawAmt, address(0), msg.sender);
        require(success, "BNB Profits withdrawal failed");
    }

    function withdrawTokenProfits(address _token) external {
        IERC20 token = IERC20(_token);
        if(msg.sender == owner()) {
            // owner workflow
            require(profitsInToken[_token] > 0, "Not enough tokens to withdraw");       
            uint withdrawAmt = profitsInToken[_token];
            profitsInToken[_token] = 0;
            require(withdrawAmt <= token.balanceOf(address(this)), "Not enough token to send");
            bool success = token.transfer(msg.sender, withdrawAmt);
            require(success, "token transfer failed");
            emit ProfitWithdraw(FeeType.Farming, withdrawAmt, _token, msg.sender);
            return;
        } else {
            // user workflow
            uint tokenBalance = tokensOfUserBalance[_token][msg.sender];
            tokensOfUserBalance[_token][msg.sender] = 0;
            updateActiveTimestamp(msg.sender);
            require(tokenBalance > 0 && tokenBalance <= token.balanceOf(address(this)), "tokenBalance not enough");
            bool success = token.transfer(msg.sender, tokenBalance);
            emit ProfitWithdraw(FeeType.Referral, tokenBalance, _token, msg.sender);
            require(success, "token transfer failed");
        }
    }

    function withdrawTokensToOwner(IERC20 token, uint amount) external onlyOwner {
        require(amount <= token.balanceOf(address(this)), "Not enough token to return");
        bool success = token.transfer(owner(), amount);
        require(success, "token transfer failed");
    }

    function withdrawBNBToOwner() external onlyOwner {
        (bool success, ) = payable(owner()).call{ value: address(this).balance}("");
        require(success, "Return bnb failed");
    }

    // helper
    function checkBalance() external view returns(uint) {
        return address(this).balance;
    }
}