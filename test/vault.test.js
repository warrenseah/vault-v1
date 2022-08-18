const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault Contract General Test", function () {
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

  describe("Default Settings", function () {

    const defaultConfig = {
      contractStatus: statusType.Inactive, // Inactive, 1: DepositInactive, 2: Active
      duration: 60, // 1 min
      entryFee: 1,
      farmingFee: 30,
      profits: 0,
      decimals: 1000,
      referralBonus: 100,
      secondsUntilInactive: 86400, // 1 day in secs
      nextAccountId: 1,
      minEtherAddReferrerCount: ethers.utils.parseUnits("3"),
      onlyRewardActiveReferrers: false,
      levelRate: [700, 300],
      refereeBonusRateMap: [{lowerBound: 1, rate: 1000}]
    };

    describe("Default Variable Values", function () {
      it("should deployer with deployer address as owner", async function () {
        const contractOwner = await vault.owner();
        expect(contractOwner).to.equal(
          deployer.address,
          "Owner address is not the same."
        );
      });

      describe("Admin.sol and Vault.sol", function() {
        it("should deploy with default settings", async function () {
          expect(await vault.contractStatus()).to.equal(
            defaultConfig.contractStatus,
            "contractStatus is not the same"
          );
          expect(await vault.duration()).to.equal(
            defaultConfig.duration,
            "Duration is not the same"
          );
          expect(await vault.entryFee()).to.equal(
            defaultConfig.entryFee,
            "entryFee not the same"
          );
          expect(await vault.farmingFee()).to.equal(
            defaultConfig.farmingFee,
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

          expect(await vault.profits()).to.equal(defaultConfig.profits, "profits is not set to 0");
        });
      });

      describe("Affiliate.sol", function() {
        it("should deploy with default settings", async function() {
          expect(await vault.decimals()).to.equal(defaultConfig.decimals, "Decimal is not set to default value");
          expect(await vault.referralBonus()).to.equal(defaultConfig.referralBonus, "referralBonus is not set to default value");
          expect(await vault.secondsUntilInactive()).to.equal(defaultConfig.secondsUntilInactive, "secondsUntilInactive is not set to default value");
          expect(await vault.minEtherAddReferrerCount()).to.equal(defaultConfig.minEtherAddReferrerCount, "minEtherAddReferrerCount is not set to default value");
          expect(await vault.onlyRewardActiveReferrers()).to.equal(defaultConfig.onlyRewardActiveReferrers, "onlyRewardActiveReferrers is not set to default value");
          expect(await vault.nextAccountId()).to.equal(defaultConfig.nextAccountId, "nextAccountId is not set to default value");
          expect(await vault.levelRate(0)).to.equal(defaultConfig.levelRate[0], "levelRate[0] is not set to default value");
          expect(await vault.levelRate(1)).to.equal(defaultConfig.levelRate[1], "levelRate[1] is not set to default value");
          
          const bonusRate = await vault.refereeBonusRateMap(0);  
          expect(bonusRate.lowerBound).to.equal(defaultConfig.refereeBonusRateMap[0].lowerBound, "refereeBonusRateMap[0].lowerBound is not set to default value");
          expect(bonusRate.rate).to.equal(defaultConfig.refereeBonusRateMap[0].rate, "refereeBonusRateMap[0].rate is not set to default value");
        });
      });
    });
  });

  describe("Global state variables functionality", function () {
    // Local change variables
    const change = {
      entryFee: 3,
      farmingFee: 10,
      status: statusType.Active,
      duration: 120,
      minEtherAddReferrerCount: ethers.utils.parseUnits("1"),
      secondsUntilInactive: 10368000, // 4months in secs
      onlyRewardActiveReferrers: true
    };

    describe("Admin/Vault.sol", function() {
      it("should revert if caller is not the deployer", async function () {
        // Unhappy pass non owner changeFee
        await expect(vaultWallet1.changeFee(0, change.entryFee)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });
  
      it("should change entry/farming fee", async function () {
        // Happy pass. Fee should change
        await expect(vaultSign.changeFee(0, change.entryFee)).to.emit(vault, "FeeChange").withArgs(0, change.entryFee); // change entryFee
        await expect(vaultSign.changeFee(1, change.farmingFee)).to.emit(vault, "FeeChange").withArgs(1, change.farmingFee); // change farmingFee
  
        expect(await vault.entryFee()).to.equal(
          change.entryFee,
          "entryFee did not change"
        );
        expect(await vault.farmingFee()).to.equal(
          change.farmingFee,
          "farmingFee did not change"
        );
      });
  
      it("should change contractStatus", async function () {
        await expect(vaultSign.changeStatus(change.status))
          .to.emit(vault, "StatusChanged")
          .withArgs(change.status);
  
        expect(await vault.contractStatus()).to.equal(
          change.status,
          "contractStatus did not change"
        );
      });
  
      it("should change duration", async function () {
        await vaultSign.changeDuration(change.duration);
        expect(await vault.duration()).to.equal(
          change.duration,
          "duration did not change"
        );
      });
    });

    describe("Affiliate.sol", function() {
      it("should change onlyRewardActiveReferrers", async function() {
        await vaultSign.setOnlyRewardAActiveReferrers(change.onlyRewardActiveReferrers);
        expect(await vault.onlyRewardActiveReferrers()).to.equal(change.onlyRewardActiveReferrers, "onlyRewardActiveReferrers is not changed");
      });

      it("should change minEtherAddReferrerCount", async function() {
        await vaultSign.changeMinEtherAddCount(change.minEtherAddReferrerCount);
        expect(await vault.minEtherAddReferrerCount()).to.equal(change.minEtherAddReferrerCount, "minEtherAddReferrerCount is not changed");
      });

      it("should change secondsUntilInactive", async function() {
        await vaultSign.setSecondsUntilInactive(change.secondsUntilInactive);
        expect(await vault.secondsUntilInactive()).to.equal(change.secondsUntilInactive, "secondsUntilInactive is not changed");
      });
    });
  });
});
