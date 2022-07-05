// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './Ownable.sol';
import './IWBNB.sol';
import './IERC20.sol';

contract Vault is Ownable {
    uint public duration = 1 minutes;
    address public wbnbAddress = 0xd9145CCE52D386f254917e481eB44e9943F39138; // local
    // 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd; testnet wbnb 
    IWBNB public wbnb; 

    uint public totalSupply;
    mapping(address => uint) public balanceOf;

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

    constructor() {
        wbnb = IWBNB(wbnbAddress);
    }

    function checkWBNBBalance() external view returns(uint) {
        return wbnb.balanceOf(address(this));
    }

    function _mint(address _to, uint _shares) private {
        totalSupply += _shares;
        balanceOf[_to] += _shares;
    }

    function _burn(address _from, uint _shares) private {
        totalSupply -= _shares;
        balanceOf[_from] -= _shares;
    }

    receive() external payable {} // Helps in unwrapping wbnb

    function deposit() public payable {
        require(msg.value > 0, "Amount > 0");
        
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
            shares = msg.value;
        } else {
            shares = (msg.value * totalSupply) / wbnb.balanceOf(address(this));
        }

        _mint(msg.sender, shares);
        // Send to convert to wbnb
        (bool success, ) = payable(wbnbAddress).call{value: msg.value}("");
        require(success, "WBNB convert failed");
        emit Deposit(msg.sender, msg.value);
    }

    // function withdrawSubmit(uint _shares) external {
    //     require(_shares > 0, "Shares > 0");
    //     require(_shares < balanceOf[msg.sender], "Cannot redeem more than you own");
    //     /*
    //         a = amount
    //         B = balance of token before withdraw
    //         T = total supply
    //         s = shares to burn

    //         (T - s) / T = (B - a) / B 

    //         a = sB / T
    //     */
    //     uint amount = (_shares * wbnb.balanceOf(address(this))) / totalSupply;

    //     // burn the shares 
    //     _burn(msg.sender, _shares);
        
    //     // Set withdrawal with timelock
    //     withdrawals.push( Withdrawal({
    //         id: nextWithdrawalID,
    //         user: msg.sender,
    //         shares: _shares,
    //         amountInTokens: amount,
    //         end: block.timestamp + duration,
    //         sent: false
    //     }));

    //     nextWithdrawalID += 1; // increment the nextWithdrawalID
    //     emit PendingWithdrawal(msg.sender, amount);
    // }

    // function withdraw(uint _id) external {
    //     Withdrawal memory staker = withdrawals[_id];
    //     require(staker.user == msg.sender, "Withdrawal must be staker");
    //     require(staker.sent == false, "Withdraw processed already");
    //     require(block.timestamp > staker.end, "Timelock is active");

    //     staker.sent = true;
    //     wbnb.transfer(msg.sender, staker.amountInTokens);
    //     emit Withdrawn(msg.sender, _id);
    // }

    // Helper functions 

    function emergencyWithdraw() external {
        uint _shares = balanceOf[msg.sender];
        require(_shares > 0, "Shares > 0");

        uint amount = (_shares * wbnb.balanceOf(address(this))) / totalSupply;
        
        // burn the shares 
        _burn(msg.sender, _shares);
        
        // transfer back wbnb plus convert to bnb
        wbnb.withdraw(amount);
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "BNB return failed");
    }

    function withdrawWBNBToOwner() external onlyOwner {
        uint _transfer = wbnb.balanceOf(address(this));
        wbnb.transfer(owner(), _transfer);
    }
}
