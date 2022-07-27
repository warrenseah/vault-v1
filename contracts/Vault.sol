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
    
    Stake[] public stakeholders;
    mapping(address => uint[]) public addressToStakeIds; // need to subtract by 1 to get the true mapping
    mapping(address => uint) public stakeOf;
    uint public totalStakes;
    uint public nextStakeholderId = 0;

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

    event StatusChanged(StatusType indexed _type);
    event Deposit(address indexed user, uint indexed stakeId, uint amount);
    event PendingWithdrawal(uint indexed withdrawalID, uint indexed stakeId, address indexed user, uint amount);
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
            shares = (depositWithFee * totalSupply) / totalStakes;
        }

        stakeholders.push(Stake({
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
        addressToStakeIds[msg.sender].push(stakeholders.length);
        
        totalStakes += depositWithFee;
        stakeOf[msg.sender] += depositWithFee;

        emit Deposit(msg.sender, nextStakeholderId - 1, depositWithFee);
    }

    function submitWithdrawal(uint _stakeId) external onlyStatusAbove(1) {
        Stake storage staker = stakeholders[_stakeId - 1];
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
            removeStakeAddress(_stakeId);
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
    }

    function _burnShares(address _from, uint _shares) private {
        totalSupply -= _shares;
        balanceOf[_from] -= _shares;
    }

    function removeStakeAddress(uint _index) private {
        // only has 1 stake or stakeId is the last index
        if(addressToStakeIds[msg.sender].length == 1 || _index == addressToStakeIds[msg.sender].length) {
            addressToStakeIds[msg.sender].pop();
        } else {
            uint lastIndex = addressToStakeIds[msg.sender].length - 1;
            addressToStakeIds[msg.sender][_index - 1] = addressToStakeIds[msg.sender][lastIndex]; // overwrite the position with a new value
            addressToStakeIds[msg.sender].pop();
        }
        
    }

    // divide by 10**10 to get %
    function getAllocationFor(address _user) public view returns(uint) {
        require(addressToStakeIds[_user].length > 0, 'Address does not exists');
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

    function stakeholdersLength() external view returns(uint) {
        return stakeholders.length;
    }

    function yieldTokensLength() external view returns(uint) {
        return yieldTokens.length;
    }

    function withdrawalLength() external view returns(uint) {
        return withdrawals.length;
    }

    function addressToStakeArr(address _user) external view returns(uint[] memory) {
        return addressToStakeIds[_user];
    }

    function amtWithFee(FeeType feeType ,uint _amount) public view returns (uint) {
        if(feeType == FeeType.Farming) {
            return uint256((_amount * (100 - farmingFee)) / 100);
        } else {
            return uint256((_amount * (100 - entryFee)) / 100);
        }
        
    }

    function isAddressExists(address _address) external view returns(bool isFound) {
        isFound = false;
        for(uint i = 0; i < stakeholders.length; i++) {
            if(stakeholders[i].user == _address && stakeholders[i].tillTime == 0) {
                isFound = true;
                break;
            }
        }
    }

    function checkUserStakeId(address _user, uint _stakeId) external view returns(bool isFound) {
        uint[] memory stakeArr = addressToStakeIds[_user];
        isFound = false;
        for(uint i = 0; i < stakeArr.length; i++) {
            if(_stakeId == stakeArr[i]) {
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

    // function allocateYieldTokens(address tokenAddr, uint tokenAmt) external onlyOwner {
    //     require(tokenAddr != address(0) && tokenToIndex[tokenAddr] > 0, 'Address must be valid');
    //     require(tokenAmt <= IERC20(tokenAddr).balanceOf(address(this)), 'Token not enough to allocate');
    //     // Allocate tokens to stakedUsers
    //     uint yieldPerShare = tokenAmt * PRECISION_FACTOR / totalSupply;
    //     for(uint i = 0; i < stakeholders.length; i++) {
    //         address userAddr = stakeholders[i];
    //         uint userAlloc = (balanceOf[userAddr] * yieldPerShare) ;
    //         userAlloc = amtWithFee(FeeType.Farming, userAlloc);
    //         tokensOfUserBalance[tokenAddr][userAddr] = userAlloc / PRECISION_FACTOR;
    //     }
    // }
}