// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Admin.sol";

contract Vault is Admin {
    
    struct Stake {
        uint id;
        uint accountId;
        address user;
        uint shares;
        uint amountInTokens;
        uint sinceTime;
        uint tillTime;
    }

    struct Yield {
        uint id;
        uint amount;
        uint sinceTime;
        uint tillTime;
        uint yieldPerTokenStaked; // multiply with PRECISION_FACTOR
        uint totalStakeAtTime;
        address token;
    }

    struct Withdrawal {
        uint id;
        address user;
        uint shares;
        uint amountInTokens;
        uint end; // submit at time + 7 days before actual withdrawal can happen
        bool sent;
    }

    uint public constant PRECISION_FACTOR = 10 ** 12;
    uint public duration = 1 minutes;
    uint public nextWithdrawalID = 0;
    
    // Vault shares
    uint public totalSupply;
    mapping(address => uint) public balanceOf;

    // Stake
    Stake[] public stakes;
    mapping(address => uint[]) public addressToStakeIds; // need to subtract by 1 to get the true mapping
    mapping(address => uint) public stakeOf;
    uint public totalStakes;
    uint public nextStakesId = 0;

    // Token to stakes records
    Yield[] public yields;
    mapping(address => mapping(uint => mapping(uint => bool))) public addressClaimedYieldRewards; // 1st uint yieldId 2nd stakeId
    uint public nextYieldId = 0;

    Withdrawal[] public withdrawals;
    mapping(address => uint[]) public addressToWithdrawalIds; // need to subtract by 1 to get the true mapping

    event Deposit(address indexed user, uint indexed stakeId, uint amount);
    event PendingWithdrawal(uint indexed withdrawalID, uint indexed stakeId, address indexed user, uint amount);
    event Withdrawn(address indexed user, uint withdrawalID);
    event YieldEnded(uint indexed id, address indexed token, uint yieldPerTokenStakedPerSec, uint sinceTime);
    event ClaimedTokens(uint indexed yieldId, uint stakeId, address indexed token, address indexed user, uint amount);

    receive() external payable {}

    // Public functions
    function deposit(uint referrerID) external payable onlyStatusAbove(2) {
        require(msg.value > 0, "Amount > 0");
        uint depositWithFee = amtWithFee(FeeType.Entry, msg.value);

        // register profit
        profits += feeToProtocol(FeeType.Entry, msg.value);

        // Add account or update if have account
        uint acctId = addAccount();

        // Register referrer if .referrer is empty
        if(referrerID > 0 && msg.value >= minEtherAddReferrerCount) {
            if(!hasReferrer(msg.sender)) {
                addReferrer(idToUser[referrerID]);
            } else {
                // have referrer already
                address parent = accounts[msg.sender].referrer;
                emit RegisteredRefererFailed(msg.sender, parent, "Address have been registered upline");
            }
        }
        
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
            shares = (depositWithFee * totalSupply) / totalStakes;
        }

        stakes.push(Stake({
            id: nextStakesId,
            accountId: acctId,
            user: msg.sender,
            amountInTokens: depositWithFee,
            shares: shares,
            sinceTime: block.timestamp,
            tillTime: 0
        }));

        emit Deposit(msg.sender, nextStakesId, depositWithFee);
        nextStakesId += 1;
        _mintShares(msg.sender, shares);

        // Update addressToStakeIds
        addressToStakeIds[msg.sender].push(stakes.length);
        
        totalStakes += depositWithFee;
        stakeOf[msg.sender] += depositWithFee;
    }

    function submitWithdrawal(uint stakeId) external onlyStatusAbove(1) {
        require(stakeId > 0, "stakeId cannot be 0");
        Stake storage staker = stakes[stakeId - 1];
        uint indexPlusOne = checkUserStakeId(msg.sender, stakeId);
        require(indexPlusOne > 0, "stakeId must belong to caller");
        require(staker.tillTime == 0, "stakeId is already processed");

        staker.tillTime = block.timestamp;

        // If shares equal to all his/her shares, remove from stakeAddresses
        /*
            a = amount
            B = balance of token before withdraw
            T = total supply
            s = shares to burn

            (T - s) / T = (B - a) / B 

            a = sB / T
        */
        uint amount = (staker.shares * totalStakes) / totalSupply;
        require(amount <= stakeOf[msg.sender], "Not enough stakedTokens");

        // Remove staked tokens
        totalStakes -= amount;
        stakeOf[msg.sender] -= amount;
        
        // Set withdrawal with timelock
        withdrawals.push( Withdrawal({
            id: nextWithdrawalID,
            user: msg.sender,
            shares: staker.shares,
            amountInTokens: amount,
            end: block.timestamp + duration,
            sent: false
        }));
        emit PendingWithdrawal(nextWithdrawalID, stakeId - 1, msg.sender, amount);
        nextWithdrawalID += 1; // increment the nextWithdrawalID

        addressToWithdrawalIds[msg.sender].push(nextWithdrawalID);

        // burn the shares 
        require(staker.shares <= balanceOf[msg.sender], "Not enough stakedTokens");
        _burnShares(msg.sender, staker.shares);
        
         // If burning entire shares, remove from staker otherwise do nothing
        if(balanceOf[msg.sender] == 0) {
            delete addressToStakeIds[msg.sender];
            
            // remove parent.referredCount 
            if(hasReferrer(msg.sender)) {
                rmParentReferCount();
            } 

            // set affiliate.accounts[msg.sender].haveStakes
            changeUserHaveStakes();
        } else {
            removeStakeIndexFromArray(indexPlusOne);
            //update account timestamp lastActive
            updateActiveTimestamp(msg.sender);
        }
    }

    function withdraw(uint id) external onlyStatusAbove(1) {
        require(id > 0, "withdrawId cannot be 0");
        Withdrawal storage staker = withdrawals[id - 1];
        uint indexPlusOne = checkUserWithdrawalId(msg.sender, id);
        require(staker.sent == false, "Withdraw processed already");
        require(indexPlusOne > 0, "Withdrawal must submit withdrawal request");
        require(block.timestamp > staker.end, "Timelock is active");
        require(staker.amountInTokens <= address(this).balance, "BNB balance not enough");

        staker.sent = true;
        removeWithdrawalIndexFromArray(indexPlusOne);
        (bool success, ) = payable(msg.sender).call{value: staker.amountInTokens}("");
        require(success, "BNB return failed");
        emit Withdrawn(msg.sender, id - 1);
    }

    function claimYieldTokens(uint stakeId, uint yieldId) external onlyStatusAbove(1) {
        require(stakeId > 0 && yieldId > 0, "id cannot be 0");
        Yield memory yieldProgram = yields[yieldId - 1];
        Stake memory stake = stakes[stakeId - 1];
        require(!addressClaimedYieldRewards[msg.sender][yieldId][stakeId], "User must not claim rewards already"); 
        require(checkUserStakeId(msg.sender, stakeId) > 0, "stakeId must belong to caller");
        require(yieldProgram.tillTime > 0, "Yield program must have ended.");
        require(yieldProgram.sinceTime > stake.sinceTime, "User must have staked before start of yieldProgram");
        
        addressClaimedYieldRewards[msg.sender][yieldId][stakeId] = true; 
        
        // Calculate rewards
        uint rewards = yieldProgram.yieldPerTokenStaked * stake.amountInTokens / PRECISION_FACTOR;
        uint rewardsAfterFee = amtWithFee(FeeType.Farming, rewards);

        // Pay admin and referrers 2 levels
        uint profits = feeToProtocol(FeeType.Farming, rewards);
        if(hasReferrer(msg.sender)) {
            uint referralPayout = payReferral(rewards, yieldProgram.token);
            // Net will go to smartcontract
            profitsInToken[yieldProgram.token] += profits - referralPayout;
        } else {
            profitsInToken[yieldProgram.token] += profits;
            updateActiveTimestamp(msg.sender);
        }

        // Register user claimed tokens
        uint tokenRewards = tokensOfUserBalance[yieldProgram.token][msg.sender];
        tokenRewards += rewardsAfterFee; // withdraw yield with any referral comms
        tokensOfUserBalance[yieldProgram.token][msg.sender] = 0; // set to 0 to reset token yield counter available for withdrawal

        require(tokenRewards > 0 && tokenRewards <= IERC20(yieldProgram.token).balanceOf(address(this)), "Token insufficient to withdraw");
        bool success = IERC20(yieldProgram.token).transfer(msg.sender, tokenRewards);
        require(success, "token transfer failed");
        emit ClaimedTokens(yieldProgram.id, stake.id, yieldProgram.token, msg.sender, rewardsAfterFee);
    }

    // Private functions
    function _mintShares(address _to, uint _shares) private {
        totalSupply += _shares;
        balanceOf[_to] += _shares;
    }

    function _burnShares(address _from, uint _shares) private {
        totalSupply -= _shares;
        balanceOf[_from] -= _shares;
    }

    function removeStakeIndexFromArray(uint index) private {
        // only has 1 stake or stakeId is the last index
        uint[] storage userStakeArr = addressToStakeIds[msg.sender];
        if(userStakeArr.length == 1 || index == userStakeArr.length) {
            userStakeArr.pop();
        } else {
            uint lastIndex = userStakeArr.length - 1;
            userStakeArr[index - 1] = userStakeArr[lastIndex]; // overwrite the position with a new value
            userStakeArr.pop();
        }
    }

    function removeWithdrawalIndexFromArray(uint index) private {
        uint[] storage userWithdrawArr = addressToWithdrawalIds[msg.sender];
        // only has 1 stake or stakeId is the last index
        if(userWithdrawArr.length == 1 || index == userWithdrawArr.length) {
            userWithdrawArr.pop();
        } else {
            uint lastIndex = userWithdrawArr.length - 1;
            userWithdrawArr[index - 1] = userWithdrawArr[lastIndex]; // overwrite the position with a new value
            userWithdrawArr.pop();
        }
    }

    // Modifier
    modifier onlyStatusAbove(uint8 _type) {
        require(uint8(contractStatus) >= _type, "Not valid activity");
        _;
    }

    // Helper functions 
    function stakesLength() external view returns(uint) {
        return stakes.length;
    }

    function yieldsLength() external view returns(uint) {
        return yields.length;
    }

    function withdrawalLength() external view returns(uint) {
        return withdrawals.length;
    }

    function addressToStakeArr(address user) public view returns(uint[] memory) {
        return addressToStakeIds[user];
    }
    
    function addressToWithdrawArr(address user) external view returns(uint[] memory) {
        return addressToWithdrawalIds[user];
    }

    function checkUserStakeId(address user, uint stakeId) public view returns(uint indexPlusOne) {
        uint[] memory stakeArr = addressToStakeIds[user];
        for(uint i = 0; i < stakeArr.length; i++) {
            if(stakeArr[i] == stakeId) {
                indexPlusOne = i + 1;
                break;
            }
        }
    }

    function checkUserWithdrawalId(address user, uint withdrawalId) public view returns(uint indexPlusOne) {
        uint[] memory withdrawalArr = addressToWithdrawalIds[user];
        for(uint i = 0; i < withdrawalArr.length; i++) {
            if(withdrawalArr[i] == withdrawalId) {
                indexPlusOne = i + 1;
                break;
            }
        }
    }

    function ifStakerExists(address user) external view returns(bool isFound) {
        isFound = false;
        for(uint i = 0; i < stakes.length; i++) {
            if(stakes[i].user == user && stakes[i].tillTime == 0) {
                isFound = true;
                break;
            }
        }
    }

    function getClaimsFor(uint stakeId, uint yieldId) external view returns(uint, uint) {
        require(stakeId > 0 && yieldId > 0, "id cannot be 0");
        Yield memory yieldProgram = yields[yieldId - 1];
        Stake memory staker = stakes[stakeId - 1];
        require(yieldProgram.tillTime > 0, "Yield program must have ended");
        require(checkUserStakeId(msg.sender, stakeId) > 0, "stakeId must belong to caller");
        require(staker.tillTime == 0, "User must have tokens staked");
        require(yieldProgram.sinceTime > staker.sinceTime, "User must have staked before start of yieldProgram");

        if(addressClaimedYieldRewards[msg.sender][yieldId][stakeId]) {
            return(0, 0);
        }

        
        uint rewards = yieldProgram.yieldPerTokenStaked * staker.amountInTokens / PRECISION_FACTOR;
        uint rewardsAfterFee = amtWithFee(FeeType.Farming, rewards);
        return (rewards, rewardsAfterFee);
    }

    function getPastStakes(address user) external view returns(uint[] memory) {
        uint[] memory stakesArr = new uint[](stakes.length);
        uint index = 0;
        for(uint i = 0; i < stakes.length; i++) {
            if(stakes[i].user == user && stakes[i].tillTime > 0) {
                stakesArr[index] = stakes[i].id + 1;
                index += 1;
            }
        }
        return stakesArr;
    }

    function getPendingYield() external view returns(uint[] memory) {
        uint[] memory pendingYields  = new uint[](yields.length);
        uint index = 0;
        for(uint i = 0; i < yields.length; i++) {
            if(yields[i].totalStakeAtTime > 0 && yields[i].yieldPerTokenStaked == 0) {
                pendingYields[index] = yields[i].id + 1;
                index += 1;
            }
        }
        return pendingYields;
    }

    function getEndedYield() external view returns(uint[] memory) {
        uint[] memory endedYields  = new uint[](yields.length);
        uint index = 0;
        for(uint i = 0; i < yields.length; i++) {
            if(yields[i].tillTime > 0 && yields[i].yieldPerTokenStaked > 0) {
                endedYields[index] = yields[i].id + 1;
                index += 1;
            }
        }
        return endedYields;
    }

    // Owner's only
    function changeDuration(uint _seconds) external onlyOwner {
        duration = _seconds;
    }

    function addYieldTokens(uint sinceTime, uint totalStake) external onlyOwner {
        require(sinceTime > 0 && totalStake > 0, "Must not be 0");
        yields.push(Yield({
            id: nextYieldId,
            amount: 0,
            sinceTime: sinceTime,
            tillTime: 0,
            yieldPerTokenStaked: 0,
            totalStakeAtTime: totalStake,
            token: address(0)
        }));

        nextYieldId += 1;
    }

    function amendYieldTokens(uint id, address tokenAddr, uint _deposit, uint sinceTime, uint tillTime) external onlyOwner {
        require(id > 0, "yieldId cannot be 0");
        Yield storage yield = yields[id - 1];
        require(yield.tillTime == 0, "Yield program has ended");

        // Either change sinceTime
        if(sinceTime != 0) {
            yield.sinceTime = sinceTime;
        }

        // Or add tillTime and end yield program

        if(tillTime != 0 && _deposit > 0) {
            // yield program has ended
            yield.tillTime = tillTime;
            require(yield.tillTime > yield.sinceTime, "End time must be greater than startTime");
            require(tokenAddr != address(0), "token address cannot be 0");
            
            // Transfer token to contract
            yield.token = tokenAddr;
            yield.amount = _deposit;
            require(_deposit <= IERC20(tokenAddr).balanceOf(msg.sender), "Not enough tokens");
            bool success = IERC20(tokenAddr).transferFrom(owner(), address(this), _deposit);
            require(success, "token transfer failed");

            // Calculate yield metrics
            yield.yieldPerTokenStaked = _deposit * PRECISION_FACTOR / yield.totalStakeAtTime;
            // Emit end of yield program
            emit YieldEnded(yield.id, yield.token, yield.yieldPerTokenStaked, yield.sinceTime);
        }
    }
}