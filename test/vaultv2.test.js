const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  mine,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault ContractV2 Test", function () {
  let vault, mockToken;
  let deployer, wallet1, wallet2, wallet3;
  let vaultSign, vaultWallet1, vaultWallet2, vaultWallet3;

  async function deployContractsFixture() {
    const MockToken = await ethers.getContractFactory("MockToken");
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

      xit("should update all state variables upon user submitting pendingWithdrawals", async function () {
        // Happy pass submitWithdrawal
        await expect(vaultWallet1.submitWithdrawal(wallet1Shares)).to.emit(vaultWallet1, "PendingWithdrawal").withArgs(0, wallet1.address, wallet1Shares);
        expect(await vault.balanceOf(wallet1.address)).to.equal(0, "Shares are not burnt upon withdrawal");
        expect(await vault.stakeOf(wallet1.address)).to.equal(0, "Staked balance is not zero");
        expect(await vault.totalSupply()).to.equal(ethers.BigNumber.from('950000000000000000'), 'totalSupply is not reduced upon withdrawal');
        expect(await vault.totalStakes()).to.equal(ethers.BigNumber.from('950000000000000000'), 'totalStakes is not reduced upon withdrawal');
        expect(await vault.addressToIndex(wallet1.address)).to.equal(0, "addressToIndex is not zero");
        expect(await vault.isAddressExists(wallet1.address)).to.be.false;

        expect(await vault.nextWithdrawalID()).to.equal(1, 'nextWithdrawalID is not equal to 1');
        expect(await vault.withdrawalLength()).to.equal(1, 'withdrawalLength is not equal to 1');
        expect(await vault.stakeholdersLength()).to.equal(1, 'stakeholdersLength is reduced by one pendingWithdrawal');

        const pendingWithdrawal = await vault.withdrawals(0);
        expect(pendingWithdrawal['id']).to.equal(0, 'Withdrawal id is not equal to 0');
        expect(pendingWithdrawal['user']).to.equal(wallet1.address, 'pendingWithdrawal address is not equal to wallet1');
        expect(pendingWithdrawal['shares']).to.equal(wallet1Shares, 'pendingWithdrawal shares is not equal to amount withdraw');
        expect(pendingWithdrawal['amountInTokens']).to.equal(wallet1Shares, 'pendingWithdrawal amountInTokens is not equal to amount withdraw');
        expect(pendingWithdrawal['end']).to.be.gt(await time.latest(), 'pendingWithdrawal time must be in the future');
        expect(pendingWithdrawal['sent']).to.be.false;
      });
    });

    describe.skip("Withdrawals", function () {
      let wallet1Shares, wallet2Shares;

      before(async function () {
        wallet1Shares = await vault.balanceOf(wallet1.address);
        wallet2Shares = await vault.balanceOf(wallet2.address);
      });

      it("should revert when contractStatus is 0", async function () {
        // Unhappy pass withdrawal will fail when contractStatus is 0 
        await vaultSign.changeStatus(0);
        await expect(vaultWallet1.withdraw(0)).to.be.revertedWith("Not valid activity");
      });

      it("should revert when msg sender is not user withdrawing", async function () {
        // Unhappy pass withdrawal user is not msg.sender
        await vaultSign.changeStatus(1);
        await expect(vaultWallet2.withdraw(0)).to.be.revertedWith("Withdrawal must be staker");
      });

      it("should revert when end time is not reached", async function () {
        // Unhappy pass withdrawal end time is still enforced
        await expect(vaultWallet1.withdraw(0)).to.be.revertedWith("Timelock is active");
      });

      it("should withdraw with all variables updated", async function () {
        // Happy pass for withdrawal past withdrawal end time
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
        expect(wallet1Withdrawal['end']).to.be.lt(await time.latest(), 'wallet1Withdrawal time must already have past');
      });

      it("should withdraw when contractStatus is 2", async function () {
        // Happy pass withdrawal to process when contractStatus is 2
        await vaultSign.changeStatus(2);

        await vaultWallet2.submitWithdrawal(wallet2Shares);
        expect(await vault.balanceOf(wallet2.address)).to.equal(0, "Shares are not burnt upon withdrawal");
        expect(await vault.stakeOf(wallet2.address)).to.equal(0, "Staked balance is not zero");
        expect(await vault.totalSupply()).to.equal(0, 'totalSupply is not reduced upon withdrawal');
        expect(await vault.totalStakes()).to.equal(0, 'totalStakes is not reduced upon withdrawal');
        expect(await vault.addressToIndex(wallet2.address)).to.equal(0, "addressToIndex is not zero");
        expect(await vault.isAddressExists(wallet2.address)).to.be.false;

        expect(await vault.nextWithdrawalID()).to.equal(2, 'nextWithdrawalID is not equal to 2');
        expect(await vault.withdrawalLength()).to.equal(2, 'withdrawalLength is not equal to 2');
        expect(await vault.stakeholdersLength()).to.equal(0, 'stakeholdersLength is reduced by one pendingWithdrawal');

        const pending2Withdrawal = await vault.withdrawals(1);
        expect(pending2Withdrawal['id']).to.equal(1, 'Withdrawal id is not equal to 0');
        expect(pending2Withdrawal['user']).to.equal(wallet2.address, 'pending2Withdrawal address is not equal to wallet2');
        expect(pending2Withdrawal['shares']).to.equal(wallet2Shares, 'pending2Withdrawal shares is not equal to amount withdraw');
        expect(pending2Withdrawal['amountInTokens']).to.equal(wallet2Shares, 'pending2Withdrawal amountInTokens is not equal to amount withdraw');
        expect(pending2Withdrawal['end']).to.be.gt(await time.latest(), 'pending2Withdrawal time must be in the future');
        expect(pending2Withdrawal['sent']).to.be.false;

        await time.increase(3600);

        await expect(vaultWallet2.withdraw(1)).to.changeEtherBalance(wallet2, ethers.BigNumber.from('950000000000000000'));
      });
    });
  });

});
