// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./Ownable.sol";
import "./IERC20.sol";

contract Affiliate is Ownable {

  /**
   * @dev Max referral level depth
   */
  uint8 constant MAX_REFER_DEPTH = 2;

  /**
   * @dev Max referee amount to bonus rate depth
   */
  uint8 constant MAX_REFEREE_BONUS_LEVEL = 2;


  /**
   * @dev The struct of account information
   * @id AccountId to be specify into Stake struct
   * @param referrer The referrer addresss
   * @param reward The total referral reward of an address
   * @param referredCount The total referral amount of an address
   * @param lastActiveTimestamp The last active timestamp of an address
   */
  struct Account {
    uint id;
    address referrer;
    uint referredCount;
    uint lastActiveTimestamp;
    bool haveStakes;
  }

  /**
   * @dev The struct of referee amount to bonus rate
   * @param lowerBound The minial referee amount
   * @param rate The bonus rate for each referee amount
   */
  struct RefereeBonusRate {
    uint lowerBound;
    uint rate;
  }

  event RegisteredReferer(address indexed referee, address indexed referrer);
  event RegisteredRefererFailed(address indexed referee, address indexed referrer, string reason);
  event PaidReferral(address indexed from, address indexed to, uint amount, uint level, address indexed token);
  event UpdatedUserLastActiveTime(address indexed user, uint timestamp);

  mapping(address => Account) public accounts;
  mapping(uint => address) public idToUser;
  mapping(address => mapping(address => uint)) public tokensOfUserBalance; // first address is tokenAddress, 2nd is stakedUser address

  uint256[] public levelRate;
  RefereeBonusRate[] public refereeBonusRateMap;

  uint256 public referralBonus;
  uint256 public decimals;
  uint256 public secondsUntilInactive = 1 days;
  uint256 public nextAccountId = 1;
  uint256 public minEtherAddReferrerCount = 3 ether; // set to 1000 usd
  bool public onlyRewardActiveReferrers;
  

  constructor(
    // uint _decimals,
    // uint _referralBonus,
    // uint[] memory _levelRate,
    // uint[] memory _refereeBonusRateMap
  ) {
    // require(_levelRate.length > 0, "Referral level should be at least one");
    // require(_levelRate.length <= MAX_REFER_DEPTH, "Exceeded max referral level depth");
    // require(_refereeBonusRateMap.length % 2 == 0, "Referee Bonus Rate Map should be pass as [<lower amount>, <rate>, ....]");
    // require(_refereeBonusRateMap.length / 2 <= MAX_REFEREE_BONUS_LEVEL, "Exceeded max referree bonus level depth");
    // require(_referralBonus <= _decimals, "Referral bonus exceeds 100%");
    // require(sum(_levelRate) <= _decimals, "Total level rate exceeds 100%");

    decimals = 1000;
    referralBonus = 100;
    levelRate.push(700);
    levelRate.push(300);
    refereeBonusRateMap.push(RefereeBonusRate(1, decimals));

    // // Set default referee amount rate as 1ppl -> 100% if rate map is empty.
    // if (_refereeBonusRateMap.length == 0) {
    //   refereeBonusRateMap.push(RefereeBonusRate(1, decimals));
    //   return;
    // }

    // for (uint i; i < _refereeBonusRateMap.length; i += 2) {
    //   if (_refereeBonusRateMap[i+1] > decimals) {
    //     revert("One of referee bonus rate exceeds 100%");
    //   }
    //   // Cause we can't pass struct or nested array without enabling experimental ABIEncoderV2, use array to simulate it
    //   refereeBonusRateMap.push(RefereeBonusRate(_refereeBonusRateMap[i], _refereeBonusRateMap[i+1]));
    // }
  }

  function sum(uint[] memory data) internal pure returns (uint) {
    uint S;
    for(uint i;i < data.length;i++) {
      S += data[i];
    }
    return S;
  }


  /**
   * @dev Utils function for check whether an address has the referrer
   */
  function hasReferrer(address addr) public view returns(bool){
    return accounts[addr].referrer != address(0);
  }

  /**
   * @dev Get block timestamp with function for testing mock
   */
  function getTime() public view returns(uint256) {
    return block.timestamp;
  }

  /**
   * @dev Given a user amount to calc in which rate period
   * @param amount The number of referrees
   */
  function getRefereeBonusRate(uint256 amount) internal view returns(uint256) {
    uint rate = refereeBonusRateMap[0].rate;
    for(uint i = 1; i < refereeBonusRateMap.length; i++) {
      if (amount < refereeBonusRateMap[i].lowerBound) {
        break;
      }
      rate = refereeBonusRateMap[i].rate;
    }
    return rate;
  }

  function isCircularReference(address referrer, address referee) internal view returns(bool){
    address parent = referrer;

    for (uint i; i < levelRate.length; i++) {
      if (parent == address(0)) {
        break;
      }

      if (parent == referee) {
        return true;
      }

      parent = accounts[parent].referrer;
    }

    return false;
  }

    /**
   * @dev Add an address as an account
   * @return accountId whether accountId for stake struct
   */
  function addAccount() internal returns(uint accountId) {
      Account storage newAccount = accounts[msg.sender];
      if(newAccount.id != 0) {
          // account already registered and update lastActive
          newAccount.haveStakes = true;
          updateActiveTimestamp(msg.sender);
          return newAccount.id;
      } 

      // create new account
      accountId = nextAccountId;
      accounts[msg.sender] = Account({
        id: accountId,
        referrer: payable(address(0)),
        referredCount: 0,
        lastActiveTimestamp: block.timestamp,
        haveStakes: true
      });
      // add id to user address mapping
      idToUser[accountId] = msg.sender;
      nextAccountId += 1;
  }

  /**
   * @dev Add an address as referrer
   * @param referrer The address would set as referrer of msg.sender
   * @return whether success to add upline
   */
  function addReferrer(address referrer) internal returns(bool){
    if (referrer == address(0)) {
      emit RegisteredRefererFailed(msg.sender, referrer, "Referrer cannot be 0x0 address");
      return false;
    } else if (isCircularReference(referrer, msg.sender)) {
      emit RegisteredRefererFailed(msg.sender, referrer, "Referee cannot be one of referrer uplines");
      return false;
    } else if (accounts[msg.sender].referrer != address(0)) {
      emit RegisteredRefererFailed(msg.sender, referrer, "Address have been registered upline");
      return false;
    }

    Account storage userAccount = accounts[msg.sender];
    Account storage parentAccount = accounts[referrer];
    // People who dont have account will not be able to be referrer
    if(!parentAccount.haveStakes) {
      emit RegisteredRefererFailed(msg.sender, referrer, "Referrer does not have stake");
      return false;
    }

    userAccount.referrer = referrer;
    userAccount.lastActiveTimestamp = getTime();
    parentAccount.referredCount += 1;

    emit RegisteredReferer(msg.sender, referrer);
    return true;
  }

  function rmParentReferCount() internal {
    accounts[accounts[msg.sender].referrer].referredCount -= 1;
  }

  function changeUserHaveStakes() internal {
    accounts[msg.sender].haveStakes = false;
    updateActiveTimestamp(msg.sender);
  }

  /**
   * @dev This will calc and pay referral to uplines instantly
   * @param value The number tokens will be calculated in referral process
   * @return the total referral bonus paid
   */
  function payReferral(uint256 value, address tokenAddr) internal returns(uint256){
    Account memory userAccount = accounts[msg.sender];
    uint totalReferal;

    for (uint i; i < levelRate.length; i++) {
      address parent = userAccount.referrer;
      Account storage parentAccount = accounts[userAccount.referrer];

      if (parent == address(0)) {
        break;
      }

      if(onlyRewardActiveReferrers && parentAccount.lastActiveTimestamp + secondsUntilInactive >= getTime() && parentAccount.haveStakes || !onlyRewardActiveReferrers && parentAccount.haveStakes) {
        uint c = value * referralBonus / decimals;
        c = c * levelRate[i] / decimals;
        c = c * getRefereeBonusRate(parentAccount.referredCount) / decimals;

        totalReferal += c;

        tokensOfUserBalance[tokenAddr][parent] += c;
        emit PaidReferral(msg.sender, parent, c, i + 1, tokenAddr);
      }

      userAccount = parentAccount;
    }

    updateActiveTimestamp(msg.sender);
    return totalReferal;
  }

  /**
   * @dev Developers should define what kind of actions are seens active. By default, payReferral will active msg.sender.
   * @param user The address would like to update active time
   */
  function updateActiveTimestamp(address user) internal {
    uint timestamp = getTime();
    accounts[user].lastActiveTimestamp = timestamp;
    emit UpdatedUserLastActiveTime(user, timestamp);
  }

  function setSecondsUntilInactive(uint _secondsUntilInactive) external onlyOwner {
    secondsUntilInactive = _secondsUntilInactive;
  }

  function setOnlyRewardAActiveReferrers(bool _onlyRewardActiveReferrers) external onlyOwner {
    onlyRewardActiveReferrers = _onlyRewardActiveReferrers;
  }

  function changeMinEtherAddCount(uint minAmount) external onlyOwner {
        minEtherAddReferrerCount = minAmount;
  }
}