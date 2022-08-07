// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Ownable.sol";
import "./IERC20.sol";

contract Admin is Ownable {
    enum StatusType {
        Inactive, // both deposit and withdrawal are inactive
        DepositInactive, // Not accepting deposits
        Active 
    }
    
    enum FeeType {
        Entry,
        Farming
    }

    StatusType public contractStatus = StatusType.Inactive;

    uint8 public entryFee = 5;
    uint8 public farmingFee = 20;
    uint public profits; // bnb profits for admin
    mapping(address => uint) public profitsInToken; // altcoins profits for admin

    event StatusChanged(StatusType indexed _type);
    event ProfitWithdraw(FeeType _type, uint _amount, address _token);

    function amtWithFee(FeeType feeType ,uint _amount) public view returns (uint) {
        if(feeType == FeeType.Farming) {
            return uint256((_amount * (100 - farmingFee)) / 100);
        } else {
            return uint256((_amount * (100 - entryFee)) / 100);
        }   
    }

    function feeToProtocol(FeeType feeType, uint _amount) public view returns(uint) {
        if(feeType == FeeType.Farming) {
            return uint256((_amount * farmingFee) / 100);
        } else {
            return uint256((_amount * entryFee) / 100);
        }
    }

    // Owner's only
    function changeFee(FeeType _type, uint8 _fee) external onlyOwner {
        if(_type == FeeType.Entry) {
            entryFee = _fee;
        } else {
            farmingFee = _fee;
        }
    }

    function changeStatus(StatusType _type) external onlyOwner {
        contractStatus = _type;
        emit StatusChanged(_type);
    }

    function withdrawProfits() external onlyOwner {
        require(profits > 0, "Not enough gasToken to withdraw");
        uint withdrawAmt = profits;
        profits = 0;
        (bool success, ) = payable(msg.sender).call{ value: withdrawAmt }("");
        emit ProfitWithdraw(FeeType.Entry, withdrawAmt, address(0));
        require(success, "BNB Profits withdrawal failed");
    }

    function withdrawTokenProfits(address _token) external onlyOwner {
        require(profitsInToken[_token] > 0, "Not enough tokens to withdraw");
        uint withdrawAmt = profitsInToken[_token];
        profitsInToken[_token] = 0;
        IERC20 token = IERC20(_token);
        require(withdrawAmt <= token.balanceOf(address(this)), "Not enough token to send");
        token.transfer(msg.sender, withdrawAmt);
        emit ProfitWithdraw(FeeType.Farming, withdrawAmt, _token);
    }

    function withdrawTokensToOwner(IERC20 token, uint _amount) external onlyOwner {
        require(_amount <= token.balanceOf(address(this)), "Not enough token to return");
        token.transfer(owner(), _amount);
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