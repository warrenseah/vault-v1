// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  // We get the contract to deploy

  const MockToken = await ethers.getContractFactory("MockToken");
  const mockToken = await MockToken.deploy();
  await mockToken.deployed();
  console.log(`Mock Token deployed address: ${mockToken.address}`);

  const [deployer] = await ethers.getSigners();

  const Vault = await ethers.getContractFactory("Vault");
  const vault = await Vault.deploy();
  await vault.deployed();
  console.log(`Vault deployed address: ${vault.address}`);
  console.log(`Deployer address: ${deployer.address}`);

  const vaultSign = vault.connect(deployer);
  //   const vaultWallet1 = vault.connect(wallet1);
  //   const vaultWallet2 = vault.connect(wallet2);
  //   const vaultWallet3 = vault.connect(wallet3);

  const statusType = {
    Inactive: 0,
    DepositInactive: 1,
    Active: 2,
  };

  await vaultSign.changeStatus(statusType.Active);
  const txn = await mockToken.approve(
    vault.address,
    ethers.utils.parseUnits("100000")
  );
  const receipt = await txn.wait();
  if(receipt && receipt.status) {
    console.log(`Approval txn is successful!`); // receipt status 1: success 0: reverted
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
