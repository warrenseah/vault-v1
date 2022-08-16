const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault Deposit/Withdrawal Test", function () {
  let vault, mockToken, MockToken;
  let deployer, wallet1, wallet2, wallet3;
  let vaultSign, vaultWallet1, vaultWallet2, vaultWallet3;

  const statusType = {
    Inactive: 0,
    DepositInactive: 1,
    Active: 2
  };

  const feeType = {
    Entry: 0,
    Farming: 1,
    Referral: 2
};

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

  describe("Deposit and Withdrawal", function () {
    const deposit1 = ethers.utils.parseUnits("1");
    const depositWithFee = ethers.utils.parseUnits("0.99"); // less 1% for entryFee
    const profitsBNB = ethers.utils.parseUnits("0.01"); // profit to smartcontract

    describe("Deposits", async function () {
      it("should revert when contractStatus is 0", async function () {
        // Back to initial state
        await loadFixture(deployContractsFixture);
        expect(await vault.contractStatus()).to.equal(
          0,
          "contractStatus is not default setting"
        );
        await expect(
          vaultWallet1.deposit(0, { value: deposit1 })
        ).to.be.revertedWith("Not valid activity");
      });

      it("should revert when contractStatus is 1", async function () {
        await vaultSign.changeStatus(statusType.DepositInactive);
        expect(await vault.contractStatus()).to.equal(
          1,
          "contractStatus is not set to 1"
        );
        await expect(
          vaultWallet1.deposit(0, { value: deposit1 })
        ).to.be.revertedWith("Not valid activity");
      });

      it("should deposit and update all state variables", async function () {
        // Happy pass deposit will be success when contractStatus is 2
        await vaultSign.changeStatus(statusType.Active);
        expect(await vault.contractStatus()).to.equal(
          2,
          "contractStatus is not set to 2"
        );
        await expect(vaultWallet1.deposit(0, { value: deposit1 }))
          .to.emit(vault, "Deposit")
          .withArgs(wallet1.address, 0, depositWithFee);

        // check if smartcontract register entryFee profit
        expect(await vault.profits()).to.equal(
          profitsBNB,
          "profits not updated with the incoming deposit"
        );
        expect(await vault.balanceOf(wallet1.address)).to.equal(
          depositWithFee,
          "Shares are not minted on deposit"
        );
        expect(await vault.stakeOf(wallet1.address)).to.equal(
          depositWithFee,
          "Deposit balance is not equal"
        );
        expect(await vault.totalSupply()).to.equal(
          depositWithFee,
          "totalSupply is not equal to minted shares"
        );
        expect(await vault.totalStakes()).to.equal(
          depositWithFee,
          "totalStakes is not equal to staked tokens"
        );
        expect(await vault.nextStakesId()).to.equal(
          1,
          "nextStakesId should increment 1"
        );

        const staker = await vault.stakes(0);
        expect(staker.id).to.equal(0, "stake index must be 0");
        expect(staker.accountId).to.equal(1, "accountId is not incrementing");
        expect(staker.user).to.equal(wallet1.address, "staker is not wallet1");
        expect(staker.shares).to.equal(
          depositWithFee,
          "shares is not reflecting minted shares"
        );
        expect(staker.amountInTokens).to.equal(
          depositWithFee,
          "amountInTokens is not reflecting staked shares"
        );
        expect(staker.sinceTime).to.be.gt(0, "sinceTime must be > 0");
        expect(staker.tillTime).to.equal(0, "tillTime must be 0");

        const stakerArray = await vault.addressToStakeArr(wallet1.address);
        expect(stakerArray).to.be.a("array");
        expect(stakerArray).to.have.lengthOf(1);
        expect(stakerArray).to.eql([ethers.BigNumber.from("1")]); // need to subtract 1 to get the true stakeId

        await expect(
          vaultWallet2.deposit(0, { value: deposit1 })
        ).to.changeEtherBalance(wallet2, "-1000000000000000000");
        expect(await vault.stakeOf(wallet2.address)).to.equal(
          depositWithFee,
          "Deposit balance is not equal"
        );
        expect(await vault.nextStakesId()).to.equal(
          2,
          "nextStakesId should increment 1"
        );
        expect(await vault.nextAccountId()).to.equal(
          3,  
          "nextAccountId should increment 1"
        );
        expect(await vault.profits()).to.equal(
          profitsBNB.mul("2"),
          "profits not updated with the incoming deposit"
        );
      });
    });

    describe("PendingWithdrawals", function () {
      let wallet1Shares;

      before(async function () {
        wallet1Shares = await vault.balanceOf(wallet1.address);
      });

      it("should revert when contractStatus is 0", async function () {
        await vaultSign.changeStatus(statusType.Inactive);
        await expect(
          vaultWallet1.submitWithdrawal(wallet1Shares)
        ).to.be.revertedWith("Not valid activity");
      });

      it("should revert when submitted by a user not found in stakes array", async function () {
        // Unhappy pass submitWithdrawal by a non staker
        await vaultSign.changeStatus(statusType.DepositInactive);
        await expect(vaultWallet3.submitWithdrawal(1)).to.be.revertedWith(
          "stakeId must belong to caller"
        );
      });

      it("should revert when submitted by a non user on a invalid stakeId", async function () {
        // Unhappy pass submitWithdrawal by a non staker
        await vaultSign.changeStatus(statusType.DepositInactive);
        await expect(vaultWallet3.submitWithdrawal(5)).to.be.reverted;
      });

      it("should revert when withdrawing zero share", async function () {
        await expect(vaultWallet1.submitWithdrawal(0)).to.be.revertedWith(
          "stakeId cannot be 0"
        );
      });

      it("should update all state variables upon user submitting pendingWithdrawals", async function () {
        // Happy pass submitWithdrawal
        const stakeArray = await vault.addressToStakeArr(wallet1.address);
        const wallet1StakeId = stakeArray[0].toNumber();

        expect(await vault.ifStakerExists(wallet1.address)).to.be.true;
        await expect(vaultWallet1.submitWithdrawal(wallet1StakeId))
          .to.emit(vault, "PendingWithdrawal")
          .withArgs(0, 0, wallet1.address, wallet1Shares);
        expect(await vault.balanceOf(wallet1.address)).to.equal(
          0,
          "Shares are not burnt upon withdrawal"
        );
        expect(await vault.stakeOf(wallet1.address)).to.equal(
          0,
          "Staked balance is not zero"
        );
        expect(await vault.totalSupply()).to.equal(
          ethers.BigNumber.from("990000000000000000"),
          "totalSupply is not reduced upon withdrawal"
        );
        expect(await vault.totalStakes()).to.equal(
          ethers.BigNumber.from("990000000000000000"),
          "totalStakes is not reduced upon withdrawal"
        );
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
          .map((_id) => _id.toNumber());

        expect(filterPastStake).to.be.an("array");
        expect(filterPastStake).to.have.lengthOf(1);
        expect(filterPastStake).to.eql([1]); // need to subtract 1 to get the true stakeId

        const pastStaker = await vault.stakes(filterPastStake[0] - 1);
        expect(pastStaker.user).to.equal(
          wallet1.address,
          "staker is not wallet1"
        );
        expect(pastStaker.tillTime).to.be.gt(
          0,
          "tillTime must be greater than 0"
        );

        expect(await vault.nextWithdrawalID()).to.equal(
          1,
          "nextWithdrawalID is not equal to 1"
        );
        expect(await vault.withdrawalLength()).to.equal(
          1,
          "withdrawalLength is not equal to 1"
        );

        const pendingWithdrawal = await vault.withdrawals(wallet1StakeId - 1);
        expect(pendingWithdrawal["id"]).to.equal(
          0,
          "Withdrawal id is not equal to 0"
        );
        expect(pendingWithdrawal["user"]).to.equal(
          wallet1.address,
          "pendingWithdrawal address is not equal to wallet1"
        );
        expect(pendingWithdrawal["shares"]).to.equal(
          wallet1Shares,
          "pendingWithdrawal shares is not equal to amount withdraw"
        );
        expect(pendingWithdrawal["amountInTokens"]).to.equal(
          wallet1Shares,
          "pendingWithdrawal amountInTokens is not equal to amount withdraw"
        );
        expect(pendingWithdrawal["end"]).to.be.gt(
          await time.latest(),
          "pendingWithdrawal time must be in the future"
        );
        expect(pendingWithdrawal["sent"]).to.be.false;
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
        await vaultSign.changeStatus(statusType.Inactive);
        await expect(vaultWallet1.withdraw(withdrawalId)).to.be.revertedWith(
          "Not valid activity"
        );
      });

      it("should revert when withdrawalId does not belong to user", async function () {
        // Unhappy pass withdrawal user is not msg.sender
        await vaultSign.changeStatus(statusType.DepositInactive);
        await expect(vaultWallet2.withdraw(withdrawalId)).to.be.revertedWith(
          "Withdrawal must submit withdrawal request"
        );
      });

      it("should revert when withdrawalId is zero", async function () {
        // Unhappy pass withdrawal user is not msg.sender
        await expect(vaultWallet1.withdraw(0)).to.be.revertedWith(
          "withdrawId cannot be 0"
        );
      });

      it("should revert when end time is not reached", async function () {
        // Unhappy pass withdrawal end time is still enforced
        await expect(vaultWallet1.withdraw(withdrawalId)).to.be.revertedWith(
          "Timelock is active"
        );
      });

      it("should withdraw with all variables updated", async function () {
        // Happy pass for withdrawal past withdrawal end time
        // increase time to process withdrawal
        await time.increase(3600);

        const beforeWithdrawArr = await vault.addressToWithdrawArr(
          wallet1.address
        );
        expect(beforeWithdrawArr).to.be.an("array").that.is.lengthOf(1);
        expect(beforeWithdrawArr).to.eql([ethers.BigNumber.from("1")]);

        const beforeBal = await wallet1.getBalance();
        // console.log('before: ', ethers.utils.formatEther(await wallet1.getBalance()));
        await expect(vaultWallet1.withdraw(withdrawalId))
          .to.emit(vault, "Withdrawn")
          .withArgs(wallet1.address, 0);
        // console.log('after: ', ethers.utils.formatEther(await wallet1.getBalance()));
        const afterBal = await wallet1.getBalance();
        const netBal = afterBal.sub(beforeBal);
        expect(netBal).to.be.gte(
          ethers.BigNumber.from("940000000000000000"),
          "stake ether is not returned"
        );
        // console.log('net: ', netBal);

        const wallet1Withdrawal = await vault.withdrawals(withdrawalId - 1);
        expect(wallet1Withdrawal["sent"]).to.be.true;
        expect(wallet1Withdrawal["end"]).to.be.lt(
          await time.latest(),
          "wallet1Withdrawal time must already have past"
        );

        const afterWithdrawArr = await vault.addressToWithdrawArr(
          wallet1.address
        );
        expect(afterWithdrawArr).to.be.an("array").that.is.empty;
      });

      it("should revert as withdrawalId is already processed", async function () {
        // Unhappy pass withdrawal
        await expect(vaultWallet1.withdraw(withdrawalId)).to.be.revertedWith(
          "Withdraw processed already"
        );
      });

      it("should withdraw when contractStatus is 2", async function () {
        // Happy pass withdrawal to process when contractStatus is 2
        await vaultSign.changeStatus(statusType.Active);
        await vaultWallet2.submitWithdrawal(2);

        await time.increase(3600);
        await expect(vaultWallet2.withdraw(2)).to.changeEtherBalance(
          wallet2,
          ethers.BigNumber.from("990000000000000000")
        );
      });
    });
  });
});
