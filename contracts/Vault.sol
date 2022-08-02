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

    uint8 public entryFee = 5;
    uint8 public farmingFee = 20;
    uint public constant PRECISION_FACTOR = 10 ** 12;
    uint public duration = 1 minutes;
    uint public nextWithdrawalID = 0;
    uint public profits; // bnb profits for admin
    mapping(address => uint) public profitsInToken; // altcoins profits for admin
    
    // Vault shares
    uint public totalSupply;
    mapping(address => uint) public balanceOf;

    // Stakeholder token
    struct Stake {
        uint id;
        address user;
        uint shares;
        uint amountInTokens;
        uint sinceTime;
        uint tillTime;
    }
    
    Stake[] public stakes;
    mapping(address => uint[]) public addressToStakeIds; // need to subtract by 1 to get the true mapping
    mapping(address => uint) public stakeOf;
    uint public totalStakes;
    uint public nextStakeholderId = 0;

    // Yield struct
    struct Yield {
        uint id;
        uint amount;
        uint sinceTime;
        uint tillTime;
        uint yieldPerTokenStaked; // multiply with PRECISION_FACTOR
        uint totalStakeAtTime;
        address token;
    }

    // Token to stakedUsers records
    Yield[] public yields;
    mapping(address => mapping(uint => mapping(uint => bool))) public addressClaimedYieldRewards; // 1st uint _yieldId 2nd _stakeId
    mapping(address => mapping(address => uint)) public tokensOfUserBalance; // first address is tokenAddress, 2nd is stakedUser address
    uint public nextYieldProgramId = 0;

    struct Withdrawal {
        uint id;
        address user;
        uint shares;
        uint amountInTokens;
        uint end; // submit at time + 7 days before actual withdrawal can happen
        bool sent;
    }

    Withdrawal[] public withdrawals;

    event StatusChanged(StatusType indexed _type);
    event Deposit(address indexed user, uint indexed stakeId, uint amount);
    event PendingWithdrawal(uint indexed withdrawalID, uint indexed stakeId, address indexed user, uint amount);
    event Withdrawn(address indexed user, uint withdrawalID);
    event YieldEnded(uint indexed _id, address indexed _token, uint _yieldPerTokenStakedPerSec, uint _sinceTime);
    event ClaimedTokens(uint indexed yieldId, uint stakeId, address indexed token, address indexed user, uint amount);
    event ProfitWithdraw(FeeType _type, uint _amount, address _token);

    receive() external payable {}

    // Public functions
    function deposit() public payable onlyStatusAbove(2) {
        require(msg.value > 0, "Amount > 0");
        uint depositWithFee = amtWithFee(FeeType.Entry, msg.value);

        // register profit
        profits += feeToProtocol(FeeType.Entry, msg.value);
        
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
            id: nextStakeholderId,
            user: msg.sender,
            amountInTokens: depositWithFee,
            shares: shares,
            sinceTime: block.timestamp,
            tillTime: 0
        }));

        nextStakeholderId += 1;
        _mintShares(msg.sender, shares);

        // Update addressToStakeIds
        addressToStakeIds[msg.sender].push(stakes.length);
        
        totalStakes += depositWithFee;
        stakeOf[msg.sender] += depositWithFee;

        emit Deposit(msg.sender, nextStakeholderId - 1, depositWithFee);
    }

    function submitWithdrawal(uint _stakeId) external onlyStatusAbove(1) {
        require(_stakeId > 0, 'stakeId cannot be 0');
        Stake storage staker = stakes[_stakeId - 1];
        require(staker.id == _stakeId - 1, "stakeId does not exists");
        require(staker.tillTime == 0, "stakeId is already processed");
        require(staker.user == msg.sender, "stake does not belong to msg.sender");

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
        require(amount <= stakeOf[msg.sender], 'Not enough stakedTokens');

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
        emit PendingWithdrawal(nextWithdrawalID, _stakeId - 1, msg.sender, amount);
        nextWithdrawalID += 1; // increment the nextWithdrawalID

        // burn the shares 
        require(staker.shares <= balanceOf[msg.sender], 'Not enough stakedTokens');
        _burnShares(msg.sender, staker.shares);
        
         // If burning entire shares, remove from staker otherwise do nothing
        if(balanceOf[msg.sender] == 0) {
            delete addressToStakeIds[msg.sender];
        } else {
            removeStakeIndexFromArray(_stakeId);
        }
        
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

    function claimYieldTokens(uint _stakeId, uint _yieldId) public onlyStatusAbove(1) {
        
        Yield memory yieldProgram = yields[_yieldId];
        Stake memory stake = stakes[_stakeId - 1];

        require(_stakeId > 0, 'stakeId cannot be 0');
        require(checkUserStakeId(msg.sender, _stakeId), 'stakeId must belong to caller');
        require(stake.user == msg.sender, "caller must be staker");
        require(stake.tillTime == 0, "User must have stakes");
        require(yieldProgram.tillTime > 0, "Yield program must have ended.");
        require(yieldProgram.sinceTime > stake.sinceTime, "User must have staked before start of yieldProgram");
        require(!addressClaimedYieldRewards[msg.sender][_yieldId][_stakeId], "User must not claim rewards already"); 
        
        addressClaimedYieldRewards[msg.sender][_yieldId][_stakeId] = true; 
        
        // Calculate rewards
        uint rewards = yieldProgram.yieldPerTokenStaked * stake.amountInTokens / PRECISION_FACTOR;
        uint rewardsAfterFee = amtWithFee(FeeType.Farming, rewards);
        profitsInToken[yieldProgram.token] += feeToProtocol(FeeType.Farming, rewards);

        require(rewardsAfterFee > 0 && rewardsAfterFee <= IERC20(yieldProgram.token).balanceOf(address(this)), "Token insufficient to withdraw");
        IERC20(yieldProgram.token).transfer(msg.sender, rewardsAfterFee);
        emit ClaimedTokens(yieldProgram.id, _stakeId - 1, yieldProgram.token, msg.sender, rewardsAfterFee);
        
        // Register user claimed tokens
        tokensOfUserBalance[yieldProgram.token][msg.sender] = rewardsAfterFee;
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

    function removeStakeIndexFromArray(uint _index) private {
        // only has 1 stake or stakeId is the last index
        if(addressToStakeIds[msg.sender].length == 1 || _index == addressToStakeIds[msg.sender].length) {
            addressToStakeIds[msg.sender].pop();
        } else {
            uint lastIndex = addressToStakeIds[msg.sender].length - 1;
            addressToStakeIds[msg.sender][_index - 1] = addressToStakeIds[msg.sender][lastIndex]; // overwrite the position with a new value
            addressToStakeIds[msg.sender].pop();
        }
    }

    function amtWithFee(FeeType feeType ,uint _amount) private view returns (uint) {
        if(feeType == FeeType.Farming) {
            return uint256((_amount * (100 - farmingFee)) / 100);
        } else {
            return uint256((_amount * (100 - entryFee)) / 100);
        }   
    }

    function feeToProtocol(FeeType feeType, uint _amount) private view returns(uint) {
        if(feeType == FeeType.Farming) {
            return uint256((_amount * farmingFee) / 100);
        } else {
            return uint256((_amount * entryFee) / 100);
        }
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

    function stakeholdersLength() external view returns(uint) {
        return stakes.length;
    }

    function yieldsLength() external view returns(uint) {
        return yields.length;
    }

    function withdrawalLength() external view returns(uint) {
        return withdrawals.length;
    }

    function addressToStakeArr(address _user) external view returns(uint[] memory) {
        return addressToStakeIds[_user];
    }

    function checkUserStakeId(address _user, uint _stakeId) public view returns(bool isFound) {
        uint[] memory stakeArr = addressToStakeIds[_user];
        isFound = false;
        for(uint i = 0; i < stakeArr.length; i++) {
            if(stakeArr[i] == _stakeId - 1) {
                isFound = true;
                break;
            }
        }
    }

    function ifStakerExists(address _address) public view returns(bool isFound) {
        isFound = false;
        for(uint i = 0; i < stakes.length; i++) {
            if(stakes[i].user == _address && stakes[i].tillTime == 0) {
                isFound = true;
                break;
            }
        }
    }

    function getClaimsFor(uint _stakeId, uint _yieldId) public view returns(uint, uint) {
        require(_stakeId > 0, 'stakeId cannot be 0');
        Stake memory staker = stakes[_stakeId - 1];
        require(checkUserStakeId(msg.sender, _stakeId), 'stakeId must belong to caller');
        require(staker.tillTime == 0, 'User must have tokens staked');
        require(staker.amountInTokens > 0, 'User does not stake tokens');

        if(addressClaimedYieldRewards[msg.sender][_yieldId][_stakeId]) {
            return(0, 0);
        }

        Yield memory yieldProgram = yields[_yieldId];
        require(yieldProgram.tillTime > 0, 'Yield program must have ended');
        uint rewards = yieldProgram.yieldPerTokenStaked * staker.amountInTokens / PRECISION_FACTOR;
        uint rewardsAfterFee = amtWithFee(FeeType.Farming, rewards);
        return (rewards, rewardsAfterFee);
    }

    function getPastStakes(address _address) external view returns(uint[] memory) {
        uint[] memory stakesArr = new uint[](stakes.length);
        uint index = 0;
        for(uint i = 0; i < stakes.length; i++) {
            if(stakes[i].user == _address && stakes[i].tillTime > 0) {
                stakesArr[index] = stakes[i].id;
                index += 1;
            }
        }
        return stakesArr;
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

    function withdrawProfits() external onlyOwner {
        require(profits > 0, 'Not enough gasToken to withdraw');
        uint withdrawAmt = profits;
        profits = 0;
        (bool success, ) = payable(msg.sender).call{ value: withdrawAmt }("");
        emit ProfitWithdraw(FeeType.Entry, withdrawAmt, address(0));
        require(success, "BNB Profits withdrawal failed");
    }

    function withdrawTokenProfits(address _token) external onlyOwner {
        require(profitsInToken[_token] > 0, 'Not enough tokens to withdraw');
        uint withdrawAmt = profitsInToken[_token];
        profitsInToken[_token] = 0;
        IERC20 token = IERC20(_token);
        require(withdrawAmt <= token.balanceOf(address(this)), 'Not enough token to send');
        token.transfer(msg.sender, withdrawAmt);
        emit ProfitWithdraw(FeeType.Farming, withdrawAmt, _token);
    }

    function withdrawTokensToOwner(IERC20 token, uint _amount) external onlyOwner {
        require(_amount <= token.balanceOf(address(this)), 'Not enough token to return');
        token.transfer(owner(), _amount);
    }

    function withdrawBNBToOwner() external onlyOwner {
        (bool success, ) = payable(owner()).call{ value: address(this).balance}("");
        require(success, 'Return bnb failed');
    }

    function addYieldTokens(uint _sinceTime, uint _totalStake) external onlyOwner {
        
        yields.push(Yield({
            id: nextYieldProgramId,
            amount: 0,
            sinceTime: _sinceTime,
            tillTime: 0,
            yieldPerTokenStaked: 0,
            totalStakeAtTime: _totalStake,
            token: address(0)
        }));

        nextYieldProgramId += 1;
    }

    function amendYieldTokens(uint _id, address tokenAddr, uint _deposit, uint _sinceTime, uint _tillTime) external onlyOwner {
        Yield storage yield = yields[_id];
        require(yield.totalStakeAtTime > 0, "No stake for programme");
        require(yield.tillTime == 0, "Yield program has ended");

        // Either change sinceTime
        if(_sinceTime != 0) {
            yield.sinceTime = _sinceTime;
        }

        // Or add tillTime and end yield program

        if(_tillTime != 0 && _deposit > 0) {
            // yield program has ended
            yield.tillTime = _tillTime;
            require(yield.tillTime > yield.sinceTime, "End time must be greater than startTime");
            require(tokenAddr != address(0), "token address cannot be 0");
            
            // Transfer token to contract
            yield.token = tokenAddr;
            yield.amount = _deposit;
            IERC20(tokenAddr).transferFrom(owner(), address(this), _deposit);

            // Calculate yield metrics
            yield.yieldPerTokenStaked = _deposit * PRECISION_FACTOR / yield.totalStakeAtTime;
            // Emit end of yield program
            emit YieldEnded(yield.id, yield.token, yield.yieldPerTokenStaked, yield.sinceTime);
        }
    }
}