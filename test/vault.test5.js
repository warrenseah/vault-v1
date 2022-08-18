const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");
const {
  isCallTrace,
} = require("hardhat/internal/hardhat-network/stack-traces/message-trace");

describe("Vault Contract Owners Feature Test", function () {
  let vault, mockToken, MockToken, mockTokenSign;
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

    mockTokenSign = mockToken.connect(deployer);
    vaultSign = vault.connect(deployer);
    vaultWallet1 = vault.connect(wallet1);
    vaultWallet2 = vault.connect(wallet2);
    vaultWallet3 = vault.connect(wallet3);
  }

  describe("Test withdrawal of BNB/Tokens to Owner", function () {
    before(async function () {
      await loadFixture(deployContractsFixture);
    });

    it("should withdraw bnb profits to owner address", async function () {
      // Change contract to active
      await vaultSign.changeStatus(2);
      // Do deposit
      const deposit1 = ethers.utils.parseUnits("1");
      await vaultWallet1.deposit(0, { value: deposit1 });
      expect(await vaultSign.withdrawBNBToOwner()).to.changeEtherBalance(vaultSign, `-${deposit1.toString()}`);
    });

    it("should transfer tokens to owner", async function() {
      const tokenAmt = ethers.utils.parseUnits('10000');
      // admin transfer some tokens to vault contract  
      await mockTokenSign.transfer(vault.address, tokenAmt);
      // admin call withdraw tokens from vault contract
      await expect(vaultSign.withdrawTokensToOwner(mockToken.address, tokenAmt)).to.changeTokenBalance(mockToken, deployer, tokenAmt);
    });
  });

  describe("Ownership", function () {
    describe("transferOwnership", function () {
      it("should revert for a non-owner call", async function () {
        // Unhappy pass for non-owner to call
        await expect(
          vaultWallet1.transferOwnership(wallet1.address)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("should revert when a new owner address is zero", async function () {
        // Unhappy pass for ethereum zero address
        await expect(
          vaultSign.transferOwnership(ethers.constants.AddressZero)
        ).to.be.revertedWith("Ownable: new owner is the zero address");
      });

      it("should update the new owner address for a successful call", async function () {
        // Happy pass to transferOwnership
        await expect(vaultSign.transferOwnership(wallet1.address))
          .to.emit(vault, "OwnershipTransferred")
          .withArgs(deployer.address, wallet1.address);
        await expect(vaultSign.changeStatus(0)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
        expect(await vault.owner()).to.equal(wallet1.address);
        await vaultWallet1.changeStatus(0);
      });
    });

    describe("renounceOwnership", function () {
      it("should set contract owner to nobody after renouncing", async function () {
        await expect(vaultWallet1.renounceOwnership())
          .to.emit(vault, "OwnershipTransferred")
          .withArgs(wallet1.address, ethers.constants.AddressZero);
        expect(await vault.owner()).to.equal(
          ethers.constants.AddressZero,
          "Owner address is not zero"
        );
      });
    });
  });
});
