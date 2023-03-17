# Solidity Vault Contract Codebase

## Summary

This is a vault smart contract project in solidity using hardhat framework. It serves as a basic template for accepting an ERC20 token for a yield generating event. Each individual contributions are accounted and when an yield is concluded and send into the smart contract by owner, each stake or person who have participated will them be able to claim their respective farmed altcoins.

Hardhat config file is preset with Bsc testnet and mainnet configurations. You are free to refer to hardhat documentation for other blockchain networks deployments.

## Basic Setup

Install all project dependencies with npm.
`npm install`

Prepare the .env environment variables found in the .env_example file. It requires the coinmarketcap api key for fetching of live prices for the hardhat-gas-reporter plugin. BscScan api key is also required for contract verification at bscScan. This project require 4 private wallet keys in order for testing code to run. Once all of these variables are specified, the file should be renamed to '.env'.

Get your CMC api key here [COINMARKETCAPAPI](https://coinmarketcap.com/api/)
Get BscScan key [BSCSCANAPIKEY](https://bscscan.com/login)
PRIVATEKEY_DEPLOYER=
PRIVATEKEY_WALLET_1=
PRIVATEKEY_WALLET_2=
PRIVATEKEY_WALLET_3=

Compile the smart contracts
`npx hardhat compile`

Run test
`npx hardhat test`

Start a local node and open another terminal to deploy smart contract to local blockchain
`npx hardhat node`
`npx hardhat run --network localhost scripts/deploy.js`

Deploy smart contracts to bnb chain testnet
`npx hardhat run scripts/deploy.js --network testnet`

Deploy smart contracts to bnb chain mainnet
`npx hardhat run scripts/deploy.js --network mainnet`

Verify smart contract
`npx hardhat verify --network <network> DEPLOYED_CONTRACT_ADDRESS`

## Smart Contract Files

## Deposit

Deposits will create a new Account struct if it is a first-time depositor. The account struct will provide the base level where a referral / affiliate payout can be implemented by owner. Also deposit function comes with uint input parameter so that the parentId can be specified. If no referrer, "0" should be specified.

An account owner can have multiple stakes struct and withdrawal struct

## Withdrawal

Withdrawal of deposited token comes with a waiting period as defined by contract owner.

## Other Hardhat commands

```shell
npx hardhat accounts
npx hardhat compile
npx hardhat clean
npx hardhat test
npx hardhat node
node scripts/sample-script.js
npx hardhat help
```
