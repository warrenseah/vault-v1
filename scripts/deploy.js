// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const { ethers } = hre;

const MockTokenJson = require("../artifacts/contracts/MockToken.sol/MockToken.json");
const VaultJson = require("../artifacts/contracts/Vault.sol/Vault.json");

const fs = require('fs');

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
  // Store this in a json file residing in client folder
  const metaPath = './client/src/contractMeta.json'; // relative from root directory
  const metaData = JSON.stringify({
    mockTokenAddress: mockToken.address,
    mockTokenAbi: MockTokenJson.abi,
    vaultAddress: vault.address,
    vaultAbi: VaultJson.abi
  }, null, 2);

  
  try {
    fs.writeFileSync(metaPath, metaData, 'utf8');
    console.log('metaData successfully saved to disk');
  } catch (error) {
    console.log('An error has occurred, ', error);
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
