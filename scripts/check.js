const hre = require("hardhat");
const { ethers } = hre;

const MockToken = require("../artifacts/contracts/MockToken.sol/MockToken.json");
const Vault = require("../artifacts/contracts/Vault.sol/Vault.json");

async function main() {
  const [deployer] = await ethers.getSigners();

  const mockTokenSigner = new ethers.Contract(
    "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    MockToken.abi,
    deployer
  );

  const vaultSign = new ethers.Contract(
    "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    Vault.abi,
    deployer
  );
  const contractStatus = await vaultSign.contractStatus();
  console.log(`contractStatus: ${contractStatus}`);

  const bal = await mockTokenSigner.balanceOf(deployer.address);
  console.log(`deployer mockToken Balance: ${ethers.utils.formatEther(bal)}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
