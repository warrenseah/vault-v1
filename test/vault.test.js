const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  mine,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault Contract General Test", function () {
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
});
