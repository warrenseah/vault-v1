const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    loadFixture,
    time,
} = require("@nomicfoundation/hardhat-network-helpers");

const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("Vault Affiliate Test", function () {
    let vault, mockToken, MockToken, mockTokenSign;
    let deployer, wallet1, wallet2, wallet3, wallet4;
    let vaultSign, vaultWallet1, vaultWallet2, vaultWallet4;
    let yieldTokenAmt;

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

        [deployer, wallet1, wallet2, wallet3, wallet4] = await ethers.getSigners();

        const Vault = await ethers.getContractFactory("Vault");
        vault = await Vault.deploy();
        await vault.deployed();

        mockTokenSign = mockToken.connect(deployer);
        vaultSign = vault.connect(deployer);
        vaultWallet1 = vault.connect(wallet1);
        vaultWallet2 = vault.connect(wallet2);
        vaultWallet3 = vault.connect(wallet3);
        vaultWallet4 = vault.connect(wallet4);

        await vaultSign.changeStatus(statusType.Active);
        yieldTokenAmt = await mockToken.balanceOf(deployer.address);
        // Approve yield tokens for platform to spend
        await expect(mockTokenSign.approve(vault.address, yieldTokenAmt))
        .to.emit(mockToken, "Approval")
        .withArgs(deployer.address, vault.address, yieldTokenAmt);
    }

    describe("Deposit", function () {
        let firstAccount, refereeAccount1, refereeAccount2, refereeAccount3;

        before(async function () {
            await loadFixture(deployContractsFixture); // refresh states back to initial
            
            // Deposit
            const deposit1 = ethers.utils.parseUnits("1");
            const deposit1WithFee = await vault.amtWithFee(feeType.Entry, deposit1);
            await vaultWallet1.deposit(0, { value: deposit1 });
        });
        it("should update accounts struct", async function() {
            firstAccount = await vault.accounts(wallet1.address);
            expect(firstAccount.id).to.equal(1, "id is not 1");
            expect(firstAccount.referrer).to.equal(ethers.constants.AddressZero, "referrer is not address(0)");
            expect(firstAccount.referredCount).to.equal(0, "referredCount is not 0");
            expect(firstAccount.lastActiveTimestamp).to.be.gt(0, "lastActiveTimestamp is still 0");
            expect(firstAccount.haveStakes).be.true;
        });
        it("should update referrer when a referee deposits", async function() {
            // deposit 2 
            const deposit2 = ethers.utils.parseUnits("4");
            const deposit2WithFee = await vault.amtWithFee(feeType.Entry, deposit2);
            await expect(vaultWallet2.deposit(firstAccount.id, { value: deposit2 })).to.emit(vaultWallet2, "RegisteredReferer").withArgs(wallet2.address, wallet1.address);

            refereeAccount1 = await vault.accounts(wallet2.address);
            expect(refereeAccount1.id).to.equal(2, "id is not 2");
            expect(refereeAccount1.referrer).to.equal(wallet1.address, "referrer is not wallet1 address");
            expect(refereeAccount1.referredCount).to.equal(0, "referredCount is not 0");
            expect(refereeAccount1.lastActiveTimestamp).to.be.gt(0, "lastActiveTimestamp is still 0");
            expect(refereeAccount1.haveStakes).be.true;

            expect(await vault.idToUser(firstAccount.id)).to.equal(wallet1.address, "Address is not equal");

            firstAccount = await vault.accounts(wallet1.address);
            expect(firstAccount.referredCount).to.equal(1, "referredCount is not 1");
        });

        it("should update lastActiveTimestamp on subsequent deposits", async function() {
            // deposit 2
            const deposit3 = ethers.utils.parseUnits("4");
            const deposit3WithFee = await vault.amtWithFee(feeType.Entry, deposit3);
            await expect(vaultWallet3.deposit(2, { value: deposit3 })).to.emit(vaultWallet3, "RegisteredReferer").withArgs(wallet3.address, wallet2.address);
            refereeAccount2 = await vault.accounts(wallet3.address);

            expect(refereeAccount2.id).to.equal(3, "id is not 3");
            expect(refereeAccount2.referrer).to.equal(wallet2.address, "referrer is not wallet2 address");
            expect(refereeAccount2.referredCount).to.equal(0, "referredCount is not 0");
            expect(refereeAccount2.lastActiveTimestamp).to.be.gt(0, "lastActiveTimestamp is still 0");
            expect(refereeAccount2.haveStakes).be.true;

            await time.increase(3600); // move time to check if lastActiveTimestamp is updated

            await expect(vaultWallet3.deposit(2, { value: deposit3 })).to.emit(vaultWallet3, "RegisteredRefererFailed").withArgs(wallet3.address, wallet2.address, "Address have been registered upline");
            const wallet3StakeArr = await vault.addressToStakeArr(wallet3.address);
            // console.log(wallet3StakeArr);
            expect(wallet3StakeArr.length).to.equal(2, "Stake array length is not equal to 2");
            const latestReferee2 = await vault.accounts(wallet3.address);
            expect(latestReferee2.lastActiveTimestamp).to.be.gt(refereeAccount2.lastActiveTimestamp, "lastActiveTimestamp is not updated when deposit is called");
            refereeAccount2 = latestReferee2; // update global variable to latest
        });

        it("should pay 70% of token rewards as referral profits when direct referee claimYieldTokens", async function() {
            
            refereeAccount1 = await vault.accounts(wallet2.address);
            expect(refereeAccount1.referredCount).to.equal(1, "referredCount is not 1");

            // admin end yield program
            await time.increase(3600); // move time so that deposit 3 can claim token yields later
            await vaultSign.addYieldTokens(await time.latest(),await vault.totalStakes());
            await time.increase(3600);
            await vaultSign.amendYieldTokens(1, mockToken.address, yieldTokenAmt, 0, await time.latest());
            
            // wallet2 claimYieldTokens
            const [totalAmt2, netFees2] = await vaultWallet2.getClaimsFor(2, 1);
            const totalProfits = totalAmt2.sub(netFees2); // 30% of token amount
            await expect(vaultWallet2.claimYieldTokens(2,1)).to.changeTokenBalance(mockToken, wallet2, netFees2)
                .to.emit(vaultWallet2, "PaidReferral").withArgs(wallet2.address, wallet1.address, anyValue, 1, mockToken.address);
            expect(await vault.tokensOfUserBalance(mockToken.address, wallet2.address)).to.equal(0, "The token yield should be 0");
            
            const latestReferee1 = await vault.accounts(wallet2.address);
            expect(latestReferee1.lastActiveTimestamp).to.be.gt(refereeAccount1.lastActiveTimestamp, "lastActiveTimestamp is not updated when claiming yield tokens");
            refereeAccount1 = latestReferee1;  // update latest for global variable

            const adminBal = await vault.profitsInToken(mockToken.address); // 23% of token amount
            const firstAcctBal = await vault.tokensOfUserBalance(mockToken.address, wallet1.address); // 7% of token amount
            expect(adminBal.add(firstAcctBal)).to.equal(totalProfits, "Rewards distribution is not the same");
            
            // admin withdraw profits
            await expect(vaultSign.withdrawTokenProfits(mockToken.address)).to.changeTokenBalance(mockToken, deployer, adminBal.toString());
            expect(await vault.profitsInToken(mockToken.address)).to.equal(0, "profits is not 0");
            // console.log(totalAmt2.sub(netFees2).toString());
            
            // firstAccount (referrer) claimYieldTokens together with referral profits
            const [totalAmt1, netFees1] = await vaultWallet1.getClaimsFor(1, 1);
            await expect(vaultWallet1.claimYieldTokens(1,1)).to.changeTokenBalance(mockToken, wallet1, netFees1.add(firstAcctBal));
            expect(await vault.tokensOfUserBalance(mockToken.address, wallet1.address)).to.equal(0, "The token yield should be 0");

            const latestFirstAccount = await vault.accounts(wallet1.address);
            expect(await latestFirstAccount.lastActiveTimestamp).to.be.gt(firstAccount.lastActiveTimestamp, "lastActiveTimestamp is not updated when claiming yield tokens");
            firstAccount = latestFirstAccount; // update global variable

            // admin withdraw profits with event emitted check
            await expect(vaultSign.withdrawTokenProfits(mockToken.address)).to.emit(vaultSign, "ProfitWithdraw").withArgs(feeType.Farming, totalAmt1.sub(netFees1), mockToken.address, deployer.address);
            expect(await vault.profitsInToken(mockToken.address)).to.equal(0, "profits is not 0");
        });

        it("should receive 30% of profits from second level of referee claimYieldTokens", async function() {
            // deposit 3 claimYieldTokens
            const [totalAmt3, netFees3] = await vaultWallet3.getClaimsFor(3, 1);
            await expect(vaultWallet3.claimYieldTokens(3,1)).to.changeTokenBalance(mockToken, wallet3, netFees3)
                .to.emit(vaultWallet3, "PaidReferral").withArgs(wallet3.address, wallet2.address, anyValue, 1, mockToken.address)
                .withArgs(wallet3.address, wallet1.address, anyValue, 2, mockToken.address);
            expect(await mockToken.balanceOf(wallet3.address)).to.equal(netFees3, "Yield is not transfer to user");

            // Check referral profits distributions
            const totalProfits = totalAmt3.sub(netFees3); // 30% of token amount
            const adminBal = await vault.profitsInToken(mockToken.address); // 20% of token amount
            const firstAcctBal = await vault.tokensOfUserBalance(mockToken.address, wallet1.address); // 3% of token amount
            const directAcctBal = await vault.tokensOfUserBalance(mockToken.address, wallet2.address); // 7% of token amount

            // console.log("30%: ", totalProfits.toString());
            // console.log("20%: ", adminBal.toString());
            // console.log("7%: ", directAcctBal.toString());
            // console.log("3%: ", firstAcctBal.toString());
            expect(firstAcctBal.add(directAcctBal)).to.equal(totalProfits.sub(adminBal));

            // refereeAcct 1 withdrawTokenProfits
            await expect(vaultWallet2.withdrawTokenProfits(mockToken.address)).to.changeTokenBalance(mockToken, wallet2, directAcctBal);
            const latestRefereeAcct1 = await vault.accounts(wallet2.address);
            expect(latestRefereeAcct1.lastActiveTimestamp).to.be.gt(refereeAccount1.lastActiveTimestamp, "lastActiveTimestamp is not updated when user withdrawTokenProfits");

            // firstAccount withdrawTokenProfits
            await expect(vaultWallet1.withdrawTokenProfits(mockToken.address)).to.changeTokenBalance(mockToken, wallet1, firstAcctBal);
            const latestFirstAcct = await vault.accounts(wallet1.address);
            expect(latestFirstAcct.lastActiveTimestamp).to.be.gt(firstAccount.lastActiveTimestamp, "lastActiveTimestamp is not updated when user withdrawTokenProfits");
        });

        it("should update lastActiveTimestamp when direct referrer withdrawTokenProfits", async function() {
            // deposit 3 claimYieldTokens again
            const [totalAmt3, netFees3] = await vaultWallet3.getClaimsFor(4, 1);
            await vaultWallet3.claimYieldTokens(4,1);

            // check referrers withdrawYieldToken with event fired
            await expect(vaultWallet2.withdrawTokenProfits(mockToken.address)).to.emit(vaultWallet2, "ProfitWithdraw").withArgs(feeType.Referral, anyValue, mockToken.address, wallet2.address);
            await expect(vaultWallet1.withdrawTokenProfits(mockToken.address)).to.emit(vaultWallet1, "ProfitWithdraw").withArgs(feeType.Referral, anyValue, mockToken.address, wallet1.address);
        });

        it("should not update referredCount when deposit is less than 3 bnb", async function() {
            await vaultWallet4.deposit(2, { value: ethers.utils.parseUnits("1") });
            const referrerAddr = await vault.idToUser(2);
            expect(wallet2.address).to.equal(referrerAddr, "referral address account not the same");
            
            refereeAccount3 = await vault.accounts(wallet4.address);
            expect(refereeAccount3.referrer).to.equal(ethers.constants.AddressZero, "referrer is not address(0)");
            
            refereeAccount1 = await vault.accounts(wallet2.address);
            expect(refereeAccount1.referredCount).to.equal(1, "referredCount should not incrememt because deposit is less than 3 bnb");
        });
    });

    describe("submitWithdrawal and withdraw func", function() {
        let firstAccount, refereeAccount1, refereeAccount2, refereeAccount3;
        it("should update timestamp only when submitWithdraw", async function() {
            refereeAccount2 = await vault.accounts(wallet3.address);
            let stakeArr3 = await vault.addressToStakeArr(wallet3.address);
            expect(stakeArr3.length).to.equal(2, "user does not have more than 1 stakes");
            // submitWithdraw for stake.id 3
            await vaultWallet3.submitWithdrawal(stakeArr3[0].toString());
            
            const stakeId3 = await vault.stakes(2);
            expect(stakeId3.tillTime).to.be.gt(0, "Unstake time is not registered");

            const withdrawArr3 = await vault.addressToWithdrawArr(wallet3.address);
            expect(withdrawArr3.length).to.equal(1, "withdrawal array does not have items");
            expect(withdrawArr3[0]).to.equal(1, "withdrawal array does not have items");

            const withdrawId1 = await vault.withdrawals(0); // id 1 - 1 = 0
            expect(withdrawId1.user).to.equal(wallet3.address, "user is not the same");
            expect(withdrawId1.end).to.be.gt(0, "endTime must be set for an end to timelock");
            expect(withdrawId1.sent).to.be.false;

            // should decrement by 1 in stake3Arr
            const latestRefereeAccount2 = await vault.accounts(wallet3.address);
            stakeArr3 = await vault.addressToStakeArr(wallet3.address);
            expect(stakeArr3.length).to.equal(1, "user stakedArr should decrement by 1 stake");
            expect(latestRefereeAccount2.referrer).to.equal(wallet2.address, "referrer address remains");
            expect(latestRefereeAccount2.lastActiveTimestamp).to.be.gt(refereeAccount2.lastActiveTimestamp, "lastActiveTimestamp is not updated");
            refereeAcount2 = latestRefereeAccount2; // update global state to latest
        });

        it("should decrement parent.referredCount and set user.haveStakes to false when user withdraw final stake", async function() {
            refereeAccount1 = await vault.accounts(wallet2.address);
            expect(refereeAccount1.referredCount).to.equal(1, "referredCount should not decrement");

            // refereeAccount2 withdraw last and final stake id 4
            await vaultWallet3.submitWithdrawal(4);
            const latestRefereeAccount2 = await vault.accounts(wallet3.address);
            const stakeArr3 = await vault.addressToStakeArr(wallet3.address);
            expect(stakeArr3.length).to.equal(0, "user stakedArr should be 0");
            expect(latestRefereeAccount2.haveStakes).to.be.false;

            refereeAccount1 = await vault.accounts(wallet2.address);
            expect(refereeAccount1.referredCount).to.equal(0, "referredCount did not decrement");
        });

        it("should withdraw successfully", async function() {
            await time.increase(3600);
            const stakeArr3 = await vault.addressToWithdrawArr(wallet3.address);
            await expect(vaultWallet3.withdraw(stakeArr3[0].toString())).to.changeEtherBalance(vaultWallet3, "-3960000000000000000").to.emit(vaultWallet3, "Withdrawn").withArgs(wallet3.address, 0); // withdraw id 1 (0)

            const withdrawId1 = await vault.withdrawals(0); // id 1 - 1 = 0
            expect(withdrawId1.user).to.equal(wallet3.address, "user is not the same");
            expect(withdrawId1.sent).to.be.true;

            const latestStakeArr3 = await vault.addressToWithdrawArr(wallet3.address);
            expect(latestStakeArr3.length).to.equal(1, "withdrawal array does not have items");
            expect(latestStakeArr3[0]).to.equal(2, "withdrawal item is not 2");
            
            await expect(vaultWallet3.withdraw(stakeArr3[1].toString())).to.emit(vaultWallet3, "Withdrawn").withArgs(wallet3.address, 1); // withdraw id 2 (1)
            const withdrawId2 = await vault.withdrawals(1); // id 2 - 1 = 1
            expect(withdrawId2.user).to.equal(wallet3.address, "user is not the same");
            expect(withdrawId2.sent).to.be.true;

            const finalStakeArr3 = await vault.addressToWithdrawArr(wallet3.address);
            expect(finalStakeArr3).to.be.empty;
        });

        it("should not pay referral if parent.hasStakes is false", async function() {
            await loadFixture(deployContractsFixture); // refresh states back to initial
            await vaultWallet1.deposit(0, {value: ethers.utils.parseUnits("1")});
            await vaultWallet2.deposit(1, {value: ethers.utils.parseUnits("3")});
            await vaultWallet3.deposit(2, {value: ethers.utils.parseUnits("3")});

            firstAccount = await vault.accounts(wallet1.address);
            refereeAccount1 = await vault.accounts(wallet2.address);
            refereeAccount2 = await vault.accounts(wallet3.address);

            // Admin end yield
            await time.increase(3600); // move time so that deposits can claim token yields later
            await vaultSign.addYieldTokens(await time.latest(),await vault.totalStakes());
            await time.increase(3600);
            await vaultSign.amendYieldTokens(1, mockToken.address, yieldTokenAmt, 0, await time.latest());
            
            // refereeAccount1 withdraw
            await vaultWallet2.submitWithdrawal(2);
            refereeAccount1 = await vault.accounts(wallet2.address);
            expect(refereeAccount1.haveStakes).to.be.false;
            await expect(vaultWallet2.claimYieldTokens(2,1)).to.be.revertedWith("stakeId must belong to caller");

            // refereeAccount 2 claimYieldTokens, directReferrer withdrawn will not get reward, second-level referrer will receive rewards 30%
            await expect(vaultWallet3.claimYieldTokens(3,1))
                .to.emit(vaultWallet3, "PaidReferral").withArgs(wallet3.address, wallet1.address, anyValue, 2, mockToken.address)
                .to.emit(vaultWallet3, "ClaimedTokens").withArgs(0,2,mockToken.address, wallet3.address, anyValue);
            

            const secondTierRewards = await vault.tokensOfUserBalance(mockToken.address, wallet1.address); // 3%
            expect(await vault.tokensOfUserBalance(mockToken.address, wallet2.address)).to.equal(0, "direct referrer should not have comms");
            expect(secondTierRewards).to.be.gt(0, "second-level referrer should have comms");

            const rewards = await mockToken.balanceOf(wallet3.address); // 70%
            const adminRewards = await vault.profitsInToken(mockToken.address); // 27%

            // console.log(rewards);
            // console.log(adminRewards);
            // console.log(secondTierRewards);
        });

        it("should not pay any referral if all parent.hasStakes are false", async function() {
            await loadFixture(deployContractsFixture); // refresh states back to initial
            await vaultWallet1.deposit(0, {value: ethers.utils.parseUnits("1")});
            await vaultWallet2.deposit(1, {value: ethers.utils.parseUnits("3")});
            await vaultWallet3.deposit(2, {value: ethers.utils.parseUnits("3")});

            firstAccount = await vault.accounts(wallet1.address);
            refereeAccount1 = await vault.accounts(wallet2.address);
            refereeAccount2 = await vault.accounts(wallet3.address);

            // Admin end yield
            await time.increase(3600); // move time so that deposits can claim token yields later
            await vaultSign.addYieldTokens(await time.latest(),await vault.totalStakes());
            await time.increase(3600);
            await vaultSign.amendYieldTokens(1, mockToken.address, yieldTokenAmt, 0, await time.latest());
            
            // firstAccount withdraw
            await vaultWallet1.submitWithdrawal(1);
            firstAccount = await vault.accounts(wallet1.address);
            expect(firstAccount.haveStakes).to.be.false;
            await expect(vaultWallet1.claimYieldTokens(1,1)).to.be.revertedWith("stakeId must belong to caller");

            // refereeAccount1 withdraw
            await vaultWallet2.submitWithdrawal(2);
            refereeAccount1 = await vault.accounts(wallet2.address);
            expect(refereeAccount1.haveStakes).to.be.false;
            await expect(vaultWallet2.claimYieldTokens(2,1)).to.be.revertedWith("stakeId must belong to caller");

            // refereeAccount 2 claimYieldTokens, directReferrer withdrawn will not get reward, second-level referrer will receive rewards 30%
            const [totalRewards, netRewards] = await vaultWallet3.getClaimsFor(3,1);
            const adminRewards = totalRewards.sub(netRewards);
            await expect(vaultWallet3.claimYieldTokens(3,1))
                .to.emit(vaultWallet3, "ClaimedTokens").withArgs(0,2,mockToken.address, wallet3.address, anyValue);
            
            expect(await vault.tokensOfUserBalance(mockToken.address, wallet2.address)).to.equal(0, "direct referrer should not have comms");
            expect(await vault.tokensOfUserBalance(mockToken.address, wallet1.address)).to.equal(0, "second-level referrer should not have comms");

            const rewards = await mockToken.balanceOf(wallet3.address); // 70%
            const adminProfits = await vault.profitsInToken(mockToken.address); // 30%
            expect(adminProfits).to.equal(adminRewards, "admin profitInTokens is not the same");

            // console.log(rewards);
            // console.log(adminProfits);
        });

        it("should not pay any referral if parent is inactive", async function() {
            await loadFixture(deployContractsFixture); // refresh states back to initial
            await vaultWallet1.deposit(0, {value: ethers.utils.parseUnits("1")});
            await vaultWallet2.deposit(1, {value: ethers.utils.parseUnits("3")});
            await vaultWallet3.deposit(2, {value: ethers.utils.parseUnits("3")});

            firstAccount = await vault.accounts(wallet1.address);
            refereeAccount1 = await vault.accounts(wallet2.address);
            refereeAccount2 = await vault.accounts(wallet3.address);

            // admin set OnlyRewardAActiveReferrers to true
            await vaultSign.setOnlyRewardAActiveReferrers(true);
            expect(await vault.onlyRewardActiveReferrers()).to.be.true;

            // Admin end yield
            await time.increase(3600); // move time so that deposits can claim token yields later
            await vaultSign.addYieldTokens(await time.latest(),await vault.totalStakes());
            await time.increase(86400); // 1 day past
            await vaultSign.amendYieldTokens(1, mockToken.address, yieldTokenAmt, 0, await time.latest());
            await time.increase(3600);
        
            // refereeAccount 2 claimYieldTokens, directReferrer withdrawn will not get reward, second-level referrer will receive rewards 30%
            const [totalRewards, netRewards] = await vaultWallet3.getClaimsFor(3,1);
            const adminRewards = totalRewards.sub(netRewards);
            await expect(vaultWallet3.claimYieldTokens(3,1))
                .to.emit(vaultWallet3, "ClaimedTokens").withArgs(0,2,mockToken.address, wallet3.address, anyValue);
            
            expect(await vault.tokensOfUserBalance(mockToken.address, wallet2.address)).to.equal(0, "direct referrer should not have comms");
            expect(await vault.tokensOfUserBalance(mockToken.address, wallet1.address)).to.equal(0, "second-level referrer should not have comms");

            const rewards = await mockToken.balanceOf(wallet3.address); // 70%
            const adminProfits = await vault.profitsInToken(mockToken.address); // 30%
            expect(adminProfits).to.equal(adminRewards, "admin profitInTokens is not the same");

            // console.log(rewards);
            // console.log(adminProfits);
        });
    });
});