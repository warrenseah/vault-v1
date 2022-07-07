// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import './Ownable.sol';
import './IERC20.sol';

contract Vault is Ownable {
    uint public duration = 1 minutes;
    uint8 public fee = 5;

    // Vault shares
    uint public totalSupply;
    mapping(address => uint) public balanceOf;

    // staked token
    uint public stakedTotalSupply;
    mapping(address => uint) public stakedBalanceOf;

    struct Withdrawal {
        uint id;
        address user;
        uint shares;
        uint amountInTokens;
        uint end; // submit at time + 7 days before actual withdrawal can happen
        bool sent;
    }

    Withdrawal[] public withdrawals;
    uint public nextWithdrawalID = 0;

    event Deposit(address indexed user, uint amount);
    event PendingWithdrawal(address indexed user, uint amount);
    event Withdrawn(address indexed user, uint withdrawalID);

    function checkBalance() external view returns(uint) {
        return address(this).balance;
    }

    function changeFee(uint8 _fee) external onlyOwner {
        fee = _fee;
    }

    function amtWithFee(uint _deposit) public view returns (uint) {
        return uint256((_deposit * (100 - fee)) / 100);
    }

    function _mint(address _to, uint _shares) private {
        totalSupply += _shares;
        balanceOf[_to] += _shares;
    }

    function _burn(address _from, uint _shares) private {
        totalSupply -= _shares;
        balanceOf[_from] -= _shares;
    }

    receive() external payable {}

    function deposit() public payable {
        require(msg.value > 0, "Amount > 0");
        uint depositWithFee = amtWithFee(msg.value);
        
        /* Determine amount of shares to mint
        a = amount
        B = balance of token before deposit
        T = total supply
        s = shares to mint

        (T + s) / T = (a + B) / B 

        s = aT / B
        */
        uint shares;
        if (totalSupply == 0) {
            shares = depositWithFee;
        } else {
            shares = (depositWithFee * totalSupply) / stakedTotalSupply;
        }

        _mint(msg.sender, shares);

        // Register staked bnb
        stakedTotalSupply += depositWithFee;
        stakedBalanceOf[msg.sender] += depositWithFee;

        emit Deposit(msg.sender, depositWithFee);
    }

    function submitWithdrawal(uint _shares) external {
        require(_shares > 0, "Shares > 0");
        require(_shares <= balanceOf[msg.sender], "Cannot redeem more than you own");
        /*
            a = amount
            B = balance of token before withdraw
            T = total supply
            s = shares to burn

            (T - s) / T = (B - a) / B 

            a = sB / T
        */
        uint amount = (_shares * stakedTotalSupply) / totalSupply;
        require(amount <= stakedBalanceOf[msg.sender], 'Redeemed tokens more than owned');

        // burn the shares 
        _burn(msg.sender, _shares);

        // Remove staked tokens
        stakedTotalSupply -= amount;
        stakedBalanceOf[msg.sender] -= amount;
        
        // Set withdrawal with timelock
        withdrawals.push( Withdrawal({
            id: nextWithdrawalID,
            user: msg.sender,
            shares: _shares,
            amountInTokens: amount,
            end: block.timestamp + duration,
            sent: false
        }));

        nextWithdrawalID += 1; // increment the nextWithdrawalID
        emit PendingWithdrawal(msg.sender, amount);
    }

    function withdraw(uint _id) external {
        Withdrawal storage staker = withdrawals[_id];
        require(staker.user == msg.sender, "Withdrawal must be staker");
        require(staker.sent == false, "Withdraw processed already");
        require(block.timestamp > staker.end, "Timelock is active");
        require(staker.amountInTokens <= address(this).balance, 'BNB balance not enough');

        staker.sent = true;
        (bool success, ) = payable(msg.sender).call{value: staker.amountInTokens}("");
        require(success, 'BNB return failed');
        emit Withdrawn(msg.sender, _id);
    }

    // Helper functions 

    function emergencyWithdraw() external {
        uint _shares = balanceOf[msg.sender];
        require(_shares > 0, "Shares > 0");

        uint amount = (_shares * stakedTotalSupply) / totalSupply;
        
        // burn the shares 
        _burn(msg.sender, _shares);
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "BNB return failed");
    }

    function withdrawBNBToOwner() external onlyOwner {
        (bool success, ) = payable(owner()).call{ value: address(this).balance}("");
        require(success, 'Return bnb failed');
    }
}
