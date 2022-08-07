const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  mine,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");
const {
  isCallTrace,
} = require("hardhat/internal/hardhat-network/stack-traces/message-trace");

describe("Vault Contract Owners Test", function () {
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
      await vaultWallet1.deposit({ value: deposit1 });
      expect(await vaultSign.withdrawBNBToOwner()).to.changeEtherBalance(vaultSign, `-${deposit1.toString()}`);
    });

    it("should transfer tokens to owner", async function() {
        expect( await mockTokenSign.transfer(vault.address, ethers.utils.parseUnits('10000'))).to.changeTokenBalance(mockTokenSign, vault, ethers.utils.parseUnits('10000'));
    });
  }); 
});
