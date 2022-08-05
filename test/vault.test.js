const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  mine,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault ContractV2 Test", function () {
  let vault, mockToken, MockToken;
  let deployer, wallet1, wallet2, wallet3;
  let vaultSign, vaultWallet1, vaultWallet2, vaultWallet3;

  async function deployContractsFixture() {
    MockToken = await ethers.getContractFactory("MockToken");
    mockToken = await MockToken.deploy();
    await mockToken.deployed();

    [deployer, wallet1, wallet2, wallet3] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("Vault");
    vault = await Vault.deploy();
    await vault.deployed();

    vaultSign = vault.connect(deployer);
    vaultWallet1 = vault.connect(wallet1);
    vaultWallet2 = vault.connect(wallet2);
    vaultWallet3 = vault.connect(wallet3);
  }

  describe("Deploying Contracts", function () {
    it("should deploy with deployer having balance in mockToken contract", async function () {
      await loadFixture(deployContractsFixture);

      expect(await mockToken.balanceOf(deployer.address)).to.equal(
        ethers.utils.parseUnits("100000"),
        "Admin address did not receive 100000 tokens"
      );
      await mockToken.faucet(ethers.utils.parseUnits("100000"));
      expect(await mockToken.balanceOf(deployer.address)).to.equal(
        ethers.utils.parseUnits("200000"),
        "Admin address did not minted additional 100000 tokens"
      );
    });
  });

  describe("Vault test with default settings", function () {
    it("should deployer with deployer address as owner", async function () {
      const contractOwner = await vault.owner();
      expect(contractOwner).to.equal(
        deployer.address,
        "Owner address is not the same."
      );
    });

    it("should deploy with default settings", async function () {
      const config = {
        contractStatus: 0, // Inactive, 1: DepositInactive, 2: Active
        duration: 60, // 1 min
        entryFee: 5,
        farmingFee: 20,
      };

      expect(await vault.contractStatus()).to.equal(
        config.contractStatus,
        "contractStatus is not the same"
      );
      expect(await vault.duration()).to.equal(
        config.duration,
        "Duration is not the same"
      );
      expect(await vault.entryFee()).to.equal(
        config.entryFee,
        "entryFee not the same"
      );
      expect(await vault.farmingFee()).to.equal(
        config.farmingFee,
        "farmingFee not the same"
      );
      expect(await vault.totalSupply()).to.equal(
        0,
        "totalSupply is not the same"
      );
      expect(await vault.totalStakes()).to.equal(
        0,
        "totalStakes is not the same"
      );
      expect(await vault.nextWithdrawalID()).to.equal(
        0,
        "nextWithdrawalID is not the same"
      );
      expect(await vault.nextStakesId()).to.equal(
        0,
        "nextStakesId is not the same"
      );
      expect(await vault.nextYieldId()).to.equal(
        0,
        "nextYieldId is not the same"
      );
      expect(await vault.stakesLength()).to.equal(
        0,
        "stakesLength is not the same"
      );
      expect(await vault.yieldsLength()).to.equal(
        0,
        "yieldsLength is not the same"
      );
      expect(await vault.withdrawalLength()).to.equal(
        0,
        "withdrawalLength is not the same"
      );
    });
  });

  describe("Global state variables functionality", function () {
    // Local change variables
    const entryFee = 3;
    const farmingFee = 10;
    const status = 2;
    const duration = 120;

    it("should revert if caller is not the deployer", async function () {
      // Unhappy pass non owner changeFee
      await expect(vaultWallet1.changeFee(0, entryFee)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("should change entry/farming fee", async function () {
      // Happy pass. Fee should change
      expect(await vault.entryFee()).to.equal(
        5,
        "entryFee is not default setting"
      );
      expect(await vault.farmingFee()).to.equal(
        20,
        "farmingFee is not default setting"
      );

      await vaultSign.changeFee(0, entryFee); // change entryFee
      await vaultSign.changeFee(1, farmingFee); // change farmingFee

      expect(await vault.entryFee()).to.equal(
        entryFee,
        "entryFee did not change"
      );
      expect(await vault.farmingFee()).to.equal(
        farmingFee,
        "farmingFee did not change"
      );
    });

    it("should change contractStatus", async function () {
      expect(await vault.contractStatus()).to.equal(
        0,
        "contractStatus is not default setting"
      );

      await expect(vaultSign.changeStatus(status))
        .to.emit(vaultSign, "StatusChanged")
        .withArgs(status);

      expect(await vault.contractStatus()).to.equal(
        status,
        "contractStatus did not change"
      );
    });

    it("should change duration", async function () {
      expect(await vault.duration()).to.equal(
        60,
        "duration is not default setting"
      );

      await vaultSign.changeDuration(duration);
      expect(await vault.duration()).to.equal(
        duration,
        "duration did not change"
      );
    });
  });

  describe("Deposit and Withdrawal", function () {
    const deposit1 = ethers.utils.parseUnits('1');
    const depositWithFee = ethers.utils.parseUnits('0.95'); // less 5% for entryFee
    const profitsBNB = ethers.utils.parseUnits('0.05'); // profit to smartcontract

    describe("Deposits", async function () {
      it("should revert when contractStatus is 0", async function () {
        // Back to initial state
        await loadFixture(deployContractsFixture);
        expect(await vault.contractStatus()).to.equal(0, 'contractStatus is not default setting');
        await expect(vaultWallet1.deposit({ value: deposit1 })).to.be.revertedWith("Not valid activity");
      });

      it("should revert when contractStatus is 1", async function () {
        await vaultSign.changeStatus(1);
        expect(await vault.contractStatus()).to.equal(1, 'contractStatus is not set to 1');
        await expect(vaultWallet1.deposit({ value: deposit1 })).to.be.revertedWith("Not valid activity");
      });

      it("should deposit and update all state variables", async function () {
        // Happy pass deposit will be success when contractStatus is 2
        await vaultSign.changeStatus(2);
        expect(await vault.contractStatus()).to.equal(2, 'contractStatus is not set to 2');

        expect(await vault.profits()).to.equal(0, 'profits should be 0');
        await expect(vaultWallet1.deposit({ value: deposit1 })).to.emit(vaultWallet1, "Deposit").withArgs(wallet1.address, 0, depositWithFee);
        // check if smartcontract register entryFee profit
        expect(await vault.profits()).to.equal(profitsBNB, 'profits not updated with the incoming deposit');
        expect(await vault.balanceOf(wallet1.address)).to.equal(depositWithFee, "Shares are not minted on deposit");
        expect(await vault.stakeOf(wallet1.address)).to.equal(depositWithFee, 'Deposit balance is not equal');
        expect(await vault.totalSupply()).to.equal(depositWithFee, 'totalSupply is not equal to minted shares');
        expect(await vault.totalStakes()).to.equal(depositWithFee, 'totalStakes is not equal to staked tokens');
        expect(await vault.nextStakesId()).to.equal(1, 'nextStakesId should increment 1');
        
        const staker = await vault.stakes(0);
        expect(staker.id).to.equal(0, "stake index must be 0");
        expect(staker.user).to.equal(wallet1.address, 'staker is not wallet1');
        expect(staker.shares).to.equal(depositWithFee, 'shares is not reflecting minted shares');
        expect(staker.amountInTokens).to.equal(depositWithFee, 'amountInTokens is not reflecting staked shares');
        expect(staker.sinceTime).to.be.gt(0, 'sinceTime must be > 0');
        expect(staker.tillTime).to.equal(0, 'tillTime must be 0');

        const stakerArray = await vault.addressToStakeArr(wallet1.address);
        expect(stakerArray).to.be.a('array');
        expect(stakerArray).to.have.lengthOf(1);
        expect(stakerArray).to.eql([ethers.BigNumber.from("1")]); // need to subtract 1 to get the true stakeId

        await expect(vaultWallet2.deposit({ value: deposit1 })).to.changeEtherBalance(wallet2, '-1000000000000000000');
        expect(await vault.stakeOf(wallet2.address)).to.equal(depositWithFee, 'Deposit balance is not equal');
        expect(await vault.nextStakesId()).to.equal(2, 'nextStakesId should increment 1');
        expect(await vault.profits()).to.equal(profitsBNB.mul('2'), 'profits not updated with the incoming deposit');
      });
    });

    describe("PendingWithdrawals", function () {
      let wallet1Shares;

      before(async function () {
        wallet1Shares = await vault.balanceOf(wallet1.address);
      });

      it("should revert when contractStatus is 0", async function () {
        await vaultSign.changeStatus(0);
        await expect(vaultWallet1.submitWithdrawal(wallet1Shares)).to.be.revertedWith("Not valid activity");
      });

      it("should revert when submitted by a user not found in stakes array", async function () {
        // Unhappy pass submitWithdrawal by a non staker
        await vaultSign.changeStatus(1);
        await expect(vaultWallet3.submitWithdrawal(1)).to.be.revertedWith("stakeId must belong to caller");
      });

      it("should revert when submitted by a non user on a invalid stakeId", async function () {
        // Unhappy pass submitWithdrawal by a non staker
        await vaultSign.changeStatus(1);
        await expect(vaultWallet3.submitWithdrawal(5)).to.be.reverted;
      });

      it("should revert when withdrawing zero share", async function () {
        await expect(vaultWallet1.submitWithdrawal(0)).to.be.revertedWith("stakeId cannot be 0");
      });

      it("should update all state variables upon user submitting pendingWithdrawals", async function () {
        // Happy pass submitWithdrawal
        const stakeArray = await vault.addressToStakeArr(wallet1.address);
        const wallet1StakeId = stakeArray[0].toNumber();

        expect(await vault.ifStakerExists(wallet1.address)).to.be.true;
        await expect(vaultWallet1.submitWithdrawal(wallet1StakeId)).to.emit(vaultWallet1, "PendingWithdrawal").withArgs(0, 0, wallet1.address, wallet1Shares);
        expect(await vault.balanceOf(wallet1.address)).to.equal(0, "Shares are not burnt upon withdrawal");
        expect(await vault.stakeOf(wallet1.address)).to.equal(0, "Staked balance is not zero");
        expect(await vault.totalSupply()).to.equal(ethers.BigNumber.from('950000000000000000'), 'totalSupply is not reduced upon withdrawal');
        expect(await vault.totalStakes()).to.equal(ethers.BigNumber.from('950000000000000000'), 'totalStakes is not reduced upon withdrawal');
        expect(await vault.ifStakerExists(wallet1.address)).to.be.false;

        const withdrawArray = await vault.addressToWithdrawArr(wallet1.address);
        expect(withdrawArray).to.be.a("array");
        expect(withdrawArray).to.have.lengthOf(1);
        expect(withdrawArray).to.eql([ethers.BigNumber.from("1")]); // need to subtract 1 to get the true withdrawalid
        const afterStakeArray = await vault.addressToStakeArr(wallet1.address);
        expect(afterStakeArray).to.be.an("array").that.is.empty;
        const pastStakeArr = await vault.getPastStakes(wallet1.address);
        const filterPastStake = pastStakeArr
          .filter((_id) => _id.toNumber() > 0)
          .map(_id => _id.toNumber());
          
        expect(filterPastStake).to.be.an("array");
        expect(filterPastStake).to.have.lengthOf(1);
        expect(filterPastStake).to.eql([1]); // need to subtract 1 to get the true stakeId
        
        const pastStaker = await vault.stakes(filterPastStake[0] - 1);
        expect(pastStaker.user).to.equal(wallet1.address, 'staker is not wallet1');
        expect(pastStaker.tillTime).to.be.gt(0, 'tillTime must be greater than 0');

        expect(await vault.nextWithdrawalID()).to.equal(1, 'nextWithdrawalID is not equal to 1');
        expect(await vault.withdrawalLength()).to.equal(1, 'withdrawalLength is not equal to 1');

        const pendingWithdrawal = await vault.withdrawals( wallet1StakeId - 1);
        expect(pendingWithdrawal['id']).to.equal(0, 'Withdrawal id is not equal to 0');
        expect(pendingWithdrawal['user']).to.equal(wallet1.address, 'pendingWithdrawal address is not equal to wallet1');
        expect(pendingWithdrawal['shares']).to.equal(wallet1Shares, 'pendingWithdrawal shares is not equal to amount withdraw');
        expect(pendingWithdrawal['amountInTokens']).to.equal(wallet1Shares, 'pendingWithdrawal amountInTokens is not equal to amount withdraw');
        expect(pendingWithdrawal['end']).to.be.gt(await time.latest(), 'pendingWithdrawal time must be in the future');
        expect(pendingWithdrawal['sent']).to.be.false;
      });
    });

    describe("Withdrawals", function () {
      let wallet1Shares, wallet2Shares, withdrawalId;

      before(async function () {
        wallet1Shares = await vault.balanceOf(wallet1.address);
        wallet2Shares = await vault.balanceOf(wallet2.address);
        const withdrawArray = await vault.addressToWithdrawArr(wallet1.address);
        withdrawalId = withdrawArray[0].toString();
      });

      it("should revert when contractStatus is 0", async function () {
        // Unhappy pass withdrawal will fail when contractStatus is 0 
        await vaultSign.changeStatus(0);
        await expect(vaultWallet1.withdraw(withdrawalId)).to.be.revertedWith("Not valid activity");
      });

      it("should revert when withdrawalId does not belong to user", async function () {
        // Unhappy pass withdrawal user is not msg.sender
        await vaultSign.changeStatus(1);
        await expect(vaultWallet2.withdraw(withdrawalId)).to.be.revertedWith("Withdrawal must submit withdrawal request");
      });

      it("should revert when withdrawalId is zero", async function () {
        // Unhappy pass withdrawal user is not msg.sender
        await expect(vaultWallet1.withdraw(0)).to.be.revertedWith("withdrawId cannot be 0");
      });

      it("should revert when end time is not reached", async function () {
        // Unhappy pass withdrawal end time is still enforced
        await expect(vaultWallet1.withdraw(withdrawalId)).to.be.revertedWith("Timelock is active");
      });

      it("should withdraw with all variables updated", async function () {
        // Happy pass for withdrawal past withdrawal end time
        // increase time to process withdrawal
        await time.increase(3600);
        
        const beforeWithdrawArr = await vault.addressToWithdrawArr(wallet1.address);
        expect(beforeWithdrawArr).to.be.an("array").that.is.lengthOf(1);
        expect(beforeWithdrawArr).to.eql([ethers.BigNumber.from('1')]);

        const beforeBal = await wallet1.getBalance();
        // console.log('before: ', ethers.utils.formatEther(await wallet1.getBalance()));
        await expect(vaultWallet1.withdraw(withdrawalId)).to.emit(vaultWallet1, "Withdrawn").withArgs(wallet1.address, 0);
        // console.log('after: ', ethers.utils.formatEther(await wallet1.getBalance()));
        const afterBal = await wallet1.getBalance();
        const netBal = afterBal.sub(beforeBal);
        expect(netBal).to.be.gte(ethers.BigNumber.from('940000000000000000'), 'stake ether is not returned');
        // console.log('net: ', netBal);

        const wallet1Withdrawal = await vault.withdrawals(withdrawalId - 1);
        expect(wallet1Withdrawal['sent']).to.be.true;
        expect(wallet1Withdrawal['end']).to.be.lt(await time.latest(), 'wallet1Withdrawal time must already have past');

        const afterWithdrawArr = await vault.addressToWithdrawArr(wallet1.address);
        expect(afterWithdrawArr).to.be.an("array").that.is.empty;
      });

      it("should revert as withdrawalId is already processed", async function () {
        // Unhappy pass withdrawal
        await expect(vaultWallet1.withdraw(withdrawalId)).to.be.revertedWith("Withdraw processed already");
      });

      it("should withdraw when contractStatus is 2", async function () {
        // Happy pass withdrawal to process when contractStatus is 2
        await vaultSign.changeStatus(2);
        await vaultWallet2.submitWithdrawal(2);

        await time.increase(3600);
        await expect(vaultWallet2.withdraw(2)).to.changeEtherBalance(wallet2, ethers.BigNumber.from('950000000000000000'));
      });
    });
  });

  describe("onlyOwner function to distribute yields", function () {
    let yieldTokenAmt, totalStakesAtTime;

    before(async function () {
      await loadFixture(deployContractsFixture); // refresh states back to initial
      await vaultSign.changeStatus(2);
      yieldTokenAmt = await mockToken.balanceOf(deployer.address);

      const deposit1 = ethers.utils.parseUnits('1');
      const deposit1WithFee = await vault.amtWithFee(0, deposit1);

      const deposit2 = ethers.utils.parseUnits('4');
      const deposit2WithFee = await vault.amtWithFee(0, deposit2);

      await vaultWallet1.deposit({ value: deposit1 });
      await vaultWallet2.deposit({ value: deposit2 });

      expect(yieldTokenAmt).to.equal(ethers.utils.parseUnits('100000'));

      // approve
      expect(await mockToken.approve(vault.address, yieldTokenAmt)).to.emit("Approval").withArgs(
        deployer,
        vault,
        yieldTokenAmt
      );
      totalStakesAtTime = await vault.totalStakes();
    });

    describe("addYieldTokens", function () {
      it("should revert when sinceTime is passed a 0 value", async function () {
        await expect(vaultSign.addYieldTokens(0, totalStakesAtTime)).to.be.revertedWith("Must not be 0");
      });

      it("should revert when totalStakeAtTime is passed a 0 value", async function () {
        const startTime = await time.latest();
        await expect(vaultSign.addYieldTokens(startTime, 0)).to.be.revertedWith("Must not be 0");
      });

      it("should be adding yield tokens to addYieldTokens func", async function() {
        // Happy pass 
        const startTime = await time.latest();
        await vaultSign.addYieldTokens(startTime, totalStakesAtTime.toString());

        expect(await vault.yieldsLength()).to.equal(1);
        await time.increase(360); // increase by 360 secs

        const firstYield = await vault.yields(0);
        expect(firstYield.id).to.equal(0, "id is not 0");
        expect(firstYield.amount).to.equal(0, "amount is not 0");
        expect(firstYield.sinceTime).to.be.lt(await time.latest(), "sinceTime is not in the past");
        expect(firstYield.tillTime).to.equal(0, "tillTime is not 0");
        expect(firstYield.yieldPerTokenStaked).to.equal(0, "yieldPerTokenStaked is not 0");
        expect(firstYield.totalStakeAtTime).to.equal(totalStakesAtTime, "totalStakes is not the same as input");
        expect(firstYield.token).to.equal(ethers.constants.AddressZero, "token address is not 0");

        expect(await vault.nextYieldId()).to.equal(1, "yieldId should increment by 1");
      });
    });
    describe("amendYieldTokens", function () {
      let endTime;

      it("should change sinceTime via amendYieldTokens func", async function() {
        const newTime = await time.latest();
        await vaultSign.amendYieldTokens(1, ethers.constants.AddressZero, 0, newTime, 0);
        const firstYield = await vault.yields(0);
        expect(firstYield.sinceTime).to.equal(newTime);
      });

      it("should revert with a token zero address", async function () {
        // Unhappy pass allocateYieldTokens to stakers with a ethereum zero address
        endTime = await time.increase(360);
        await expect(vaultSign.amendYieldTokens(1, ethers.constants.AddressZero, yieldTokenAmt, 0, endTime)).to.be.revertedWith("token address cannot be 0");
      
      });

      it("should revert when an invalid tillTime is passed", async function() {
        // pass a new time
        const newTime = await time.latest();
        await vaultSign.amendYieldTokens(1, ethers.constants.AddressZero, 0, newTime, 0);

        // use the earlier endTime
        await expect(vaultSign.amendYieldTokens(1, mockToken.address, yieldTokenAmt, 0, endTime)).to.be.revertedWith("End time must be greater than startTime");
      });

      it("should revert if yieldId is zero", async function() {
        await time.increase(360);
        endTime = await time.latest();
        await expect(vaultSign.amendYieldTokens(0, mockToken.address, yieldTokenAmt, 0, endTime)).to.be.revertedWith("yieldId cannot be 0");
      });

      it("should revert if deployer does not have enough yield tokens to send", async function() {
        await expect(vaultSign.amendYieldTokens(1, mockToken.address, ethers.utils.parseUnits('200000'), 0, endTime)).to.be.revertedWith("Not enough tokens");
      });

      it("should end the yield programme when all input are processed", async function() {
        await vaultSign.amendYieldTokens(1, mockToken.address, yieldTokenAmt, 0, endTime);
        const checkYield = await vault.yields(0);
        expect(checkYield.amount).to.equal(yieldTokenAmt, "amount is not reflecting yield token amount");
        expect(checkYield.tillTime).to.be.gt(0, "tillTime must be greater than 0");
        expect(checkYield.token).to.equal(mockToken.address, "token address is not reflecting the correct address");

        const yieldPerStaked = yieldTokenAmt.mul(await vault.PRECISION_FACTOR()).div(totalStakesAtTime);
        expect(checkYield.yieldPerTokenStaked).to.equal(yieldPerStaked, "yieldPerTokenStaked is not reflecting a result");
      });
    });

    describe("User claim yield tokens", function () {
      it("should revert when a 0 id is passed to func", async function() {
        await expect(vaultWallet1.claimYieldTokens(0,1)).to.be.revertedWith("id cannot be 0");
        await expect(vaultWallet1.claimYieldTokens(1,0)).to.be.revertedWith("id cannot be 0");
        await expect(vaultWallet1.claimYieldTokens(0,0)).to.be.revertedWith("id cannot be 0");
      });

      it("should revert when caller specify someone else stakeId", async function() {
        await expect(vaultWallet1.claimYieldTokens(2, 1)).to.be.revertedWith("stakeId must belong to caller");
      });

      it("should update state variables when tokens are claimed", async function () {
        // Claim tokens
        const wallet1StakeArr = await vault.addressToStakeArr(wallet1.address);
        const filterWallet1Stake = wallet1StakeArr.map(obj => obj.toNumber());

        // Check claims
        let [total, afterFee] = await vaultWallet1.getClaimsFor(filterWallet1Stake[0], 1);
        const adminFee = total.sub(afterFee);
        afterFee = afterFee.toString();
        
        expect(await vaultWallet1.claimYieldTokens(filterWallet1Stake[0], 1)).to.emit("ClaimedTokens").withArgs(0, filterWallet1Stake[0] - 1, mockToken.address, wallet1.address, afterFee);
        expect(await mockToken.balanceOf(wallet1.address)).to.equal(afterFee, "claimedTokens is not transferred to wallet1");

        expect(await vault.addressClaimedYieldRewards(wallet1.address,1,1)).to.be.true;
        expect(await vault.tokensOfUserBalance(mockToken.address, wallet1.address)).to.equal(afterFee, "Claim token amount not reflected on tokensOfUserBalance");

        // check admin profits
        expect(await vault.profitsInToken(mockToken.address)).to.equal(adminFee, "Admin profit is not reflected in profitsInToken");

        await expect(vaultWallet2.claimYieldTokens(2,1)).to.changeTokenBalance(mockToken, wallet2, '63999999999999998720000');
      });

      it("should revert when user claimed again", async function() {
        await expect(vaultWallet1.claimYieldTokens(1, 1)).to.be.revertedWith("User must not claim rewards already");
      });

      it("should revert when user deposit after the start of yield programme", async function() {
        // new user deposit 
        await vaultWallet3.deposit({ value: ethers.utils.parseUnits("1") });
        await expect(vaultWallet3.claimYieldTokens(3,1)).to.be.revertedWith("User must have staked before start of yieldProgram");
      });

      it("should revert when a yield programme has not concluded", async function() {
        // add new yields
        const mockToken2 = await MockToken.deploy();
        expect(await mockToken2.balanceOf(deployer.address)).to.equal(
          ethers.utils.parseUnits("100000"),
          "Admin address did not receive 100000 tokens"
        );
        const totalStateNow = await vault.totalStakes();
        await vaultSign.addYieldTokens(await time.latest(), totalStateNow.toString());
        await expect(vaultWallet3.claimYieldTokens(3, 2)).to.be.revertedWith("Yield program must have ended.");
      });
    });

    describe("admin claim profits", function() {
      it("should send bnb to owner", async function() {
        const bnbProfits = ethers.utils.parseUnits('0.3');
        expect(await vaultSign.withdrawProfits()).to.changeEtherBalance(vaultSign, "-300000000000000000").to.emit("ProfitWithdraw").withArgs(0, bnbProfits, ethers.constants.AddressZero);
      });

      it("should revert if profits is 0", async function() {
        await expect(vaultSign.withdrawProfits()).to.be.revertedWith("Not enough gasToken to withdraw");
      });

      it("should send tokens profits to owner", async function() {
        expect(await vaultSign.withdrawTokenProfits(mockToken.address)).to.changeTokenBalance(mockToken,deployer.address,"19999999999999999600000").to.emit("ProfitWithdraw").withArgs(1,"19999999999999999600000",mockToken.address);
      });
    });
  });

  describe("Ownership", function () {
    describe("transferOwnership", function () {
      it("should revert for a non-owner call", async function () {
        // Unhappy pass for non-owner to call
        await expect(vaultWallet1.transferOwnership(wallet1.address)).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("should revert when a new owner address is zero", async function () {
        // Unhappy pass for ethereum zero address
        await expect(vaultSign.transferOwnership(ethers.constants.AddressZero)).to.be.revertedWith("Ownable: new owner is the zero address");
      });

      it("should update the new owner address for a successful call", async function () {
        // Happy pass to transferOwnership
        expect(await vaultSign.transferOwnership(wallet1.address)).to.emit("OwnershipTransferred").withArgs(deployer.address, wallet1.address);
        await expect(vaultSign.changeStatus(0)).to.be.revertedWith("Ownable: caller is not the owner");
        expect(await vault.owner()).to.equal(wallet1.address);
        await vaultWallet1.changeStatus(0);
      });
    });

    describe("renounceOwnership", function () {
      it("should set contract owner to nobody after renouncing", async function () {
        expect(await vaultWallet1.renounceOwnership()).to.emit("OwnershipTransferred").withArgs(wallet1.address, ethers.constants.AddressZero);
        expect(await vault.owner()).to.equal(ethers.constants.AddressZero, "Owner address is not zero");
      });
    });
  });

});
