const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, mine, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault Contract", function () {
  let vault, mockToken;
  let owner, wallet1, wallet2, wallet3;
  let vaultSign, vaultWallet1, vaultWallet2, vaultWallet3;

  async function deployContractsFixture() {
    const MockToken = await ethers.getContractFactory("MockToken");
    mockToken = await MockToken.deploy();
    await mockToken.deployed();
    
    [owner, wallet1, wallet2, wallet3] = await ethers.getSigners();
  
    const Vault = await ethers.getContractFactory("Vault");
    vault = await Vault.deploy();
    await vault.deployed();

    vaultSign = vault.connect(owner);
    vaultWallet1 = vault.connect(wallet1);
    vaultWallet2 = vault.connect(wallet2);
    vaultWallet3 = vault.connect(wallet3);
  }

  it("should deploy with admin as address", async function () {

    await loadFixture(deployContractsFixture);

    expect(await mockToken.balanceOf(owner.address)).to.equal(ethers.utils.parseUnits('100000'), "Admin address did not receive 100000 tokens");
    await mockToken.faucet(ethers.utils.parseUnits('100000'));
    expect(await mockToken.balanceOf(owner.address)).to.equal(ethers.utils.parseUnits('200000'), "Admin address did not minted additional 100000 tokens");

    const contractOwner = await vault.owner();
    expect(contractOwner).to.equal(owner.address, "Owner address is not the same.");
  });

  it("should deploy with default settings", async function() {
    const config = {
      contractStatus: 0, // Inactive, 1: DepositInactive, 2: Active
      duration: 60, // 1 min
      entryFee: 5,
      farmingFee: 20
    };

    expect(await vault.contractStatus()).to.equal(config.contractStatus,'contractStatus is not the same');
    expect(await vault.duration()).to.equal(config.duration, 'Duration is not the same');
    expect(await vault.entryFee()).to.equal(config.entryFee, 'entryFee not the same');
    expect(await vault.farmingFee()).to.equal(config.farmingFee, 'farmingFee not the same');
    expect(await vault.totalSupply()).to.equal(0, 'totalSupply is not the same');
    expect(await vault.stakedTotalSupply()).to.equal(0, 'stakedTotalSupply is not the same');
    expect(await vault.nextWithdrawalID()).to.equal(0, 'nextWithdrawalID is not the same');
    expect(await vault.stakeAddressesLength()).to.equal(0, 'stakeAddressesLength is not the same');
    expect(await vault.yieldTokensLength()).to.equal(0, 'yieldTokensLength is not the same');
    expect(await vault.withdrawalLength()).to.equal(0, 'withdrawalLength is not the same');
  });

  it('should change contract status, duration and fees by owners only', async function() {
    // Local change variables
    const entryFee = 3;
    const farmingFee = 10;
    const status = 2;
    const duration = 120;

    // Should revert because not owner to changeFee
    await expect(vaultWallet1.changeFee(0, entryFee)).to.be.revertedWith("Ownable: caller is not the owner");
    
    // Fee should change
    expect(await vault.entryFee()).to.equal(5, 'entryFee is not default setting');
    expect(await vault.farmingFee()).to.equal(20, 'farmingFee is not default setting');

    await vaultSign.changeFee(0, entryFee); // change entryFee
    await vaultSign.changeFee(1, farmingFee); // change farmingFee  
    expect(await vault.entryFee()).to.equal(entryFee, 'entryFee did not change');
    expect(await vault.farmingFee()).to.equal(farmingFee, 'farmingFee did not change');

    // Change contractStatus
    expect(await vault.contractStatus()).to.equal(0, 'contractStatus is not default setting');
    await expect(vaultSign.changeStatus(status)).to.emit(vaultSign, "StatusChanged").withArgs(status);
    expect(await vault.contractStatus()).to.equal(status, 'contractStatus did not change');
  
    // Change duration
    expect(await vault.duration()).to.equal(60, 'duration is not default setting');
    await vaultSign.changeDuration(duration);
    expect(await vault.duration()).to.equal(duration, 'duration did not change');
  });

  it('should accept deposit and withdrawal with necessary contract status', async function() {
    // Back to initial state
    await loadFixture(deployContractsFixture);
    expect(await vault.contractStatus()).to.equal(0, 'contractStatus is not default setting');

    const deposit1 = ethers.utils.parseUnits('1');
    const depositWithFee = await vault.amtWithFee(0, deposit1);

    // Deposit will fail when contractStatus is 0
    await expect(vaultWallet1.deposit({value: deposit1})).to.be.revertedWith("Not valid activity");

    // Deposit will fail if contractStatus is 1
    await vaultSign.changeStatus(1);
    expect(await vault.contractStatus()).to.equal(1, 'contractStatus is not set to 1');
    await expect(vaultWallet1.deposit({value: deposit1})).to.be.revertedWith("Not valid activity");
    
    // Deposit will be success if contractStatus is 2
    await vaultSign.changeStatus(2);
    expect(await vault.contractStatus()).to.equal(2, 'contractStatus is not set to 2');

    await expect(vaultWallet1.deposit({value: deposit1})).to.emit(vaultWallet1, "Deposit").withArgs(wallet1.address, depositWithFee);
    expect(await vault.balanceOf(wallet1.address)).to.equal(depositWithFee, "Shares are not minted on deposit");
    expect(await vault.stakedBalanceOf(wallet1.address)).to.equal(depositWithFee, 'Deposit balance is not equal');
    expect(await vault.totalSupply()).to.equal(depositWithFee, 'totalSupply is not equal to minted shares');
    expect(await vault.stakedTotalSupply()).to.equal(depositWithFee, 'stakedTotalSupply is not equal to staked tokens');

    const stakerIndex = await vault.addressToIndex(wallet1.address);
    expect(stakerIndex).to.equal(1);
    expect(await vault.stakeAddresses(stakerIndex - 1)).to.equal(wallet1.address);

    await expect(vaultWallet2.deposit({value: deposit1})).to.changeEtherBalance(wallet2, '-1000000000000000000');
    expect(await vault.stakedBalanceOf(wallet2.address)).to.equal(depositWithFee, 'Deposit balance is not equal');

    // Withdrawal will fail if contractStatus is 0
    await vaultSign.changeStatus(0);
    const wallet1Shares = await vault.balanceOf(wallet1.address);
    await expect(vaultWallet1.submitWithdrawal(wallet1Shares)).to.be.revertedWith("Not valid activity");

    // Withdrawal will pass if contractStatus is 1
    await vaultSign.changeStatus(1);
    await expect(vaultWallet1.submitWithdrawal(wallet1Shares)).to.emit(vaultWallet1, "PendingWithdrawal").withArgs(0, wallet1.address, wallet1Shares);
    expect(await vault.balanceOf(wallet1.address)).to.equal(0, "Shares are not burnt upon withdrawal");
    expect(await vault.stakedBalanceOf(wallet1.address)).to.equal(0, "Staked balance is not zero");
    expect(await vault.totalSupply()).to.equal(ethers.BigNumber.from('950000000000000000'), 'totalSupply is not reduced upon withdrawal');
    expect(await vault.stakedTotalSupply()).to.equal(ethers.BigNumber.from('950000000000000000'), 'totalSupply is not reduced upon withdrawal');
    expect(await vault.addressToIndex(wallet1.address)).to.equal(0, "addressToIndex is not zero");
    expect(await vault.isAddressExists(wallet1.address)).to.be.false;

    expect(await vault.nextWithdrawalID()).to.equal(1, 'nextWithdrawalID is not equal to 1');
    expect(await vault.withdrawalLength()).to.equal(1, 'withdrawalLength is not equal to 1');
    expect(await vault.stakeAddressesLength()).to.equal(1, 'stakeAddressesLength is reduced by one pendingWithdrawal');

    const pendingWithdrawal = await vault.withdrawals(0);
    expect(pendingWithdrawal['id']).to.equal(0, 'Withdrawal id is not equal to 0');
    expect(pendingWithdrawal['user']).to.equal(wallet1.address, 'pendingWithdrawal address is not equal to wallet1');
    expect(pendingWithdrawal['shares']).to.equal(wallet1Shares, 'pendingWithdrawal shares is not equal to amount withdraw');
    expect(pendingWithdrawal['amountInTokens']).to.equal(wallet1Shares, 'pendingWithdrawal amountInTokens is not equal to amount withdraw');
    expect(pendingWithdrawal['end']).to.be.gt( await time.latest(), 'pendingWithdrawal time must be in the future');
    expect(pendingWithdrawal['sent']).to.be.false;

    // To revert withdrawal 
    await vaultSign.changeStatus(0);
    await expect(vaultWallet1.withdraw(0)).to.be.revertedWith("Not valid activity");
    await vaultSign.changeStatus(1);
    await expect(vaultWallet2.withdraw(0)).to.be.revertedWith("Withdrawal must be staker");
    await expect(vaultWallet1.withdraw(0)).to.be.revertedWith("Timelock is active");
    
    // increase time to process withdrawal
    await time.increase(3600);
    
    const beforeBal = await wallet1.getBalance();
    // console.log('before: ', ethers.utils.formatEther(await wallet1.getBalance()));
    await expect(vaultWallet1.withdraw(0)).to.emit(vaultWallet1, "Withdrawn").withArgs(wallet1.address, 0);
    // console.log('after: ', ethers.utils.formatEther(await wallet1.getBalance()));
    const afterBal = await wallet1.getBalance();
    const netBal = afterBal.sub(beforeBal);
    expect(netBal).to.be.gte(ethers.BigNumber.from('940000000000000000'), 'stake ether is not returned');
    // console.log('net: ', netBal);

    const wallet1Withdrawal = await vault.withdrawals(0);
    expect(wallet1Withdrawal['sent']).to.be.true;
    expect(wallet1Withdrawal['end']).to.be.lt( await time.latest(), 'wallet1Withdrawal time must already have past');

    await expect(vaultWallet1.submitWithdrawal(0)).to.be.revertedWith("Shares > 0");
    await expect(vaultWallet1.submitWithdrawal(1)).to.be.revertedWith("Cannot redeem more than you own");

    // withdrawal to process when contractStatus is 2
    await vaultSign.changeStatus(2);

    await vaultWallet2.submitWithdrawal(wallet1Shares);
    expect(await vault.balanceOf(wallet2.address)).to.equal(0, "Shares are not burnt upon withdrawal");
    expect(await vault.stakedBalanceOf(wallet2.address)).to.equal(0, "Staked balance is not zero");
    expect(await vault.totalSupply()).to.equal(0, 'totalSupply is not reduced upon withdrawal');
    expect(await vault.stakedTotalSupply()).to.equal(0, 'totalSupply is not reduced upon withdrawal');
    expect(await vault.addressToIndex(wallet2.address)).to.equal(0, "addressToIndex is not zero");
    expect(await vault.isAddressExists(wallet2.address)).to.be.false;

    expect(await vault.nextWithdrawalID()).to.equal(2, 'nextWithdrawalID is not equal to 2');
    expect(await vault.withdrawalLength()).to.equal(2, 'withdrawalLength is not equal to 2');
    expect(await vault.stakeAddressesLength()).to.equal(0, 'stakeAddressesLength is reduced by one pendingWithdrawal');

    const pending2Withdrawal = await vault.withdrawals(1);
    expect(pending2Withdrawal['id']).to.equal(1, 'Withdrawal id is not equal to 0');
    expect(pending2Withdrawal['user']).to.equal(wallet2.address, 'pending2Withdrawal address is not equal to wallet2');
    expect(pending2Withdrawal['shares']).to.equal(wallet1Shares, 'pending2Withdrawal shares is not equal to amount withdraw');
    expect(pending2Withdrawal['amountInTokens']).to.equal(wallet1Shares, 'pending2Withdrawal amountInTokens is not equal to amount withdraw');
    expect(pending2Withdrawal['end']).to.be.gt( await time.latest(), 'pending2Withdrawal time must be in the future');
    expect(pending2Withdrawal['sent']).to.be.false;

    await time.increase(3600);

    await expect(vaultWallet2.withdraw(1)).to.changeEtherBalance(wallet2, ethers.BigNumber.from('950000000000000000'));
  });

  it("should transfer mockTokens when owner allocate and user claim", async function() {
    const deposit1 = ethers.utils.parseUnits('1');
    const deposit1WithFee = await vault.amtWithFee(0, deposit1);

    const deposit2 = ethers.utils.parseUnits('4');
    const deposit2WithFee = await vault.amtWithFee(0, deposit2);
    
    await vaultWallet1.deposit({value: deposit1});
    await vaultWallet2.deposit({value: deposit2});

    const faucetBal = await mockToken.balanceOf(owner.address);
    expect(faucetBal).to.equal(ethers.utils.parseUnits('100000'));

    // approve
    expect(await mockToken.approve(vault.address, faucetBal)).to.emit("Approval").withArgs(
      owner,
      vault,
      faucetBal
    );
    
    // add to Vault contract
    await expect(vaultSign.addYieldTokens(ethers.constants.AddressZero, faucetBal)).to.be.revertedWith("Address must be valid");

    await expect(vaultSign.addYieldTokens(mockToken.address, faucetBal)).to.changeTokenBalance(
      mockToken,
      owner,
      `-${faucetBal.toString()}`
    );
    expect(await vault.tokenToIndex(mockToken.address)).to.equal(1, 'mockToken not added to tokenToIndex');
    expect(await vault.yieldTokensLength()).to.equal(1, 'mockToken not added to yieldTokens array');
    expect(await mockToken.balanceOf(vault.address)).to.equal(faucetBal, 'mockToken balance not transfer to vault contract');

    // Allocate tokens to stakers
    await expect(vaultSign.allocateYieldTokens(ethers.constants.AddressZero, faucetBal)).to.be.revertedWith("Address must be valid");
    await expect(vaultSign.allocateYieldTokens(mockToken.address, ethers.utils.parseUnits('200000'))).to.be.revertedWith("Token not enough to allocate");
    
    await vaultSign.allocateYieldTokens(mockToken.address, faucetBal);
    expect(await vault.tokensOfUserBalance(mockToken.address, wallet1.address)).to.equal('15999999999999999680000', "token is not allocated to staker1");
    expect(await vault.tokensOfUserBalance(mockToken.address, wallet2.address)).to.equal('63999999999999998720000', "token is not allocated to staker2");
    // console.log(await vault.tokensOfUserBalance(mockToken.address, wallet1.address));
    // console.log(await vault.tokensOfUserBalance(mockToken.address, wallet2.address));

    // Claim tokens
    expect(await vaultWallet1.claimYieldTokens(mockToken.address)).to.emit("Transfer").withArgs(vault.address, wallet1.address, '15999999999999999680000');
    expect(await mockToken.balanceOf(wallet1.address)).to.equal('15999999999999999680000', "claimedTokens is not transferred to wallet1");
    expect(await vaultWallet2.claimYieldTokens(mockToken.address)).to.emit("ClaimedTokens").withArgs(mockToken.address, wallet2.address, '63999999999999998720000');
    expect(await mockToken.balanceOf(wallet2.address)).to.equal('63999999999999998720000', "claimedTokens is not transferred to wallet2");
  });

  it("should transfer ownership to new owner", async function() {

    // unhappy pass for non-owner to call
    await expect(vaultWallet1.transferOwnership(wallet1.address)).to.be.revertedWith("Ownable: caller is not the owner");
    // unhappy pass for ethereum zero address
    await expect(vaultSign.transferOwnership(ethers.constants.AddressZero)).to.be.revertedWith("Ownable: new owner is the zero address");
    // happy pass
    expect(await vaultSign.transferOwnership(wallet1.address)).to.emit("OwnershipTransferred").withArgs(owner.address, wallet1.address);
    await expect(vaultSign.changeStatus(0)).to.be.revertedWith("Ownable: caller is not the owner");
    expect(await vault.owner()).to.equal(wallet1.address);
    await vaultWallet1.changeStatus(0);
  });

  it("should renounce ownership", async function() {

  });
});