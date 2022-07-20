// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './Ownable.sol';
import './IERC20.sol';

contract Vault is Ownable {
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

    uint public constant PRECISION_FACTOR = 10 ** 12;
    uint public duration = 1 minutes;
    uint8 public entryFee = 5;
    uint8 public farmingFee = 20;

    // Vault shares
    uint public totalSupply;
    mapping(address => uint) public balanceOf;

    // Staked token
    address[] public stakeAddresses;
    mapping(address => uint) public addressToIndex; // need to subtract by 1 to get the true mapping
    mapping(address => uint) public stakedBalanceOf;
    uint public stakedTotalSupply;

    // Token to stakedUsers records
    address[] public yieldTokens;
    mapping(address => uint16) public tokenToIndex; // need to subtract by 1 to get the true mapping
    mapping(address => mapping(address => uint)) public tokensOfUserBalance; // first address is tokenAddress, 2nd is stakedUser address

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

    event StatusChanged(StatusType indexed _type);
    event Deposit(address indexed user, uint amount);
    event PendingWithdrawal(uint withdrawalID, address indexed user, uint amount);
    event Withdrawn(address indexed user, uint withdrawalID);
    event ClaimedTokens(address indexed token, address indexed user, uint amount);

    receive() external payable {}

    // Public functions
    function deposit() public payable onlyStatusAbove(2) {
        require(msg.value > 0, "Amount > 0");
        uint depositWithFee = amtWithFee(FeeType.Entry, msg.value);
        
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

        _mintShares(msg.sender, shares);

        stakedTotalSupply += depositWithFee;
        stakedBalanceOf[msg.sender] += depositWithFee;

        emit Deposit(msg.sender, depositWithFee);
    }

    function submitWithdrawal(uint _shares) external onlyStatusAbove(1) {
        require(_shares > 0, "Shares > 0");
        require(addressToIndex[msg.sender] > 0, "User must be a staker");
        require(_shares <= balanceOf[msg.sender], "Cannot redeem more than you own");
        // If shares equal to all his/her shares, remove from stakeAddresses
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
        _burnShares(msg.sender, _shares);

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
        emit PendingWithdrawal(nextWithdrawalID, msg.sender, amount);
        nextWithdrawalID += 1; // increment the nextWithdrawalID
        
    }

    function withdraw(uint _id) external onlyStatusAbove(1) {
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

    function claimYieldTokens(address tokenAddr) public onlyStatusAbove(1) {
        uint tokenAmt = tokensOfUserBalance[tokenAddr][msg.sender];
        require(tokenAmt > 0 && tokenAmt <= IERC20(tokenAddr).balanceOf(address(this)), "Token insufficient to withdraw");
        tokensOfUserBalance[tokenAddr][msg.sender] = 0;
        IERC20(tokenAddr).transfer(msg.sender, tokenAmt);
        emit ClaimedTokens(tokenAddr, msg.sender, tokenAmt);
    }

    // Private functions
    function _mintShares(address _to, uint _shares) private {
        totalSupply += _shares;
        balanceOf[_to] += _shares;

        // Register staked bnb
        if(addressToIndex[_to] == 0 ) {
            stakeAddresses.push(_to); // new staker
            addressToIndex[_to] = stakeAddresses.length;
        }
        // otherwise is existing staker do nothing
    }

    function _burnShares(address _from, uint _shares) private {
         // If burning entire shares, remove from staker otherwise do nothing
        if(_shares == balanceOf[_from]) {
            uint index = addressToIndex[_from] - 1;
            addressToIndex[_from] = 0;
            removeStakeAddress(index);
        }
        totalSupply -= _shares;
        balanceOf[_from] -= _shares;
    }

    function removeStakeAddress(uint _index) private {
        // only left 1 staker or user is the latest staker
        if(stakeAddresses.length == 1 || _index == stakeAddresses.length - 1) {
            stakeAddresses.pop();
        } else {
            uint lastIndex = stakeAddresses.length - 1;
            addressToIndex[stakeAddresses[lastIndex]] = _index + 1;
            stakeAddresses[_index] = stakeAddresses[lastIndex];
            stakeAddresses.pop();
        }
        
    }

    // divide by 10**10 to get %
    function getAllocationFor(address _user) public view returns(uint) {
        require(addressToIndex[_user] > 0, 'Address does not exists');
        require(balanceOf[_user] > 0, 'User does not stake tokens');
        uint alloc = (balanceOf[_user] * PRECISION_FACTOR) / totalSupply ;
        return alloc; 
    }

    // Modifier
    modifier onlyStatusAbove(uint8 _type) {
        require(uint8(contractStatus) >= _type, 'Not valid activity');
        _;
    }

    // Helper functions 
    function checkBalance() external view returns(uint) {
        return address(this).balance;
    }

    function stakeAddressesLength() external view returns(uint) {
        return stakeAddresses.length;
    }

    function yieldTokensLength() external view returns(uint) {
        return yieldTokens.length;
    }

    function withdrawalLength() external view returns(uint) {
        return withdrawals.length;
    }

    function amtWithFee(FeeType feeType ,uint _amount) public view returns (uint) {
        if(feeType == FeeType.Farming) {
            return uint256((_amount * (100 - farmingFee)) / 100);
        } else {
            return uint256((_amount * (100 - entryFee)) / 100);
        }
        
    }

    function isAddressExists(address _address) external view returns(bool isFound) {
        uint length = stakeAddresses.length;
        isFound = false;
        for(uint i = 0; i < length; i++) {
            if(stakeAddresses[i] == _address) {
                isFound = true;
                break;
            }
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

    function changeDuration(uint _seconds) external onlyOwner {
        duration = _seconds;
    }

    function withdrawTokensToOwner(IERC20 token, uint _amount) external onlyOwner {
        require(_amount <= token.balanceOf(address(this)), 'Not enough token to return');
        token.transfer(owner(), _amount);
    }

    function withdrawBNBToOwner() external onlyOwner {
        (bool success, ) = payable(owner()).call{ value: address(this).balance}("");
        require(success, 'Return bnb failed');
    }

    function addYieldTokens(address tokenAddr, uint _deposit) external onlyOwner {
        require(tokenAddr != address(0), 'Address must be valid');
        // check if token exists
        uint16 tokenIndex = tokenToIndex[tokenAddr];
        if(tokenIndex == 0) {
            // token does not exists, add to yieldToken stack
            yieldTokens.push(tokenAddr);
            tokenToIndex[tokenAddr] = uint16(yieldTokens.length);
        } 

        if(_deposit > 0) {
            IERC20(tokenAddr).transferFrom(owner(), address(this), _deposit);
        }
    }

    function allocateYieldTokens(address tokenAddr, uint tokenAmt) external onlyOwner {
        require(tokenAddr != address(0) && tokenToIndex[tokenAddr] > 0, 'Address must be valid');
        require(tokenAmt <= IERC20(tokenAddr).balanceOf(address(this)), 'Token not enough to allocate');
        // Allocate tokens to stakedUsers
        uint yieldPerShare = tokenAmt * PRECISION_FACTOR / totalSupply;
        for(uint i = 0; i < stakeAddresses.length; i++) {
            address userAddr = stakeAddresses[i];
            uint userAlloc = (balanceOf[userAddr] * yieldPerShare) ;
            userAlloc = amtWithFee(FeeType.Farming, userAlloc);
            tokensOfUserBalance[tokenAddr][userAddr] = userAlloc / PRECISION_FACTOR;
        }
    }
}