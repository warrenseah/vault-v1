const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  mine,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("Vault Add/Amend/Claim Yield Test", function () {
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
  describe("onlyOwner function to distribute yields", function () {
    let yieldTokenAmt, totalStakesAtTime;

    before(async function () {
      await loadFixture(deployContractsFixture); // refresh states back to initial
      await vaultSign.changeStatus(2);
      yieldTokenAmt = await mockToken.balanceOf(deployer.address);

      const deposit1 = ethers.utils.parseUnits("1");
      const deposit1WithFee = await vault.amtWithFee(0, deposit1);

      const deposit2 = ethers.utils.parseUnits("4");
      const deposit2WithFee = await vault.amtWithFee(0, deposit2);

      await vaultWallet1.deposit({ value: deposit1 });
      await vaultWallet2.deposit({ value: deposit2 });

      expect(yieldTokenAmt).to.equal(ethers.utils.parseUnits("100000"));

      // approve
      expect(await mockToken.approve(vault.address, yieldTokenAmt))
        .to.emit("Approval")
        .withArgs(deployer, vault, yieldTokenAmt);
      totalStakesAtTime = await vault.totalStakes();
    });

    describe("addYieldTokens", function () {
      it("should revert when sinceTime is passed a 0 value", async function () {
        await expect(
          vaultSign.addYieldTokens(0, totalStakesAtTime)
        ).to.be.revertedWith("Must not be 0");
      });

      it("should revert when totalStakeAtTime is passed a 0 value", async function () {
        const startTime = await time.latest();
        await expect(vaultSign.addYieldTokens(startTime, 0)).to.be.revertedWith(
          "Must not be 0"
        );
      });

      it("should be adding yield tokens to addYieldTokens func", async function () {
        // Happy pass
        const startTime = await time.latest();
        await vaultSign.addYieldTokens(startTime, totalStakesAtTime.toString());

        expect(await vault.yieldsLength()).to.equal(1);
        await time.increase(360); // increase by 360 secs

        const firstYield = await vault.yields(0);
        expect(firstYield.id).to.equal(0, "id is not 0");
        expect(firstYield.amount).to.equal(0, "amount is not 0");
        expect(firstYield.sinceTime).to.be.lt(
          await time.latest(),
          "sinceTime is not in the past"
        );
        expect(firstYield.tillTime).to.equal(0, "tillTime is not 0");
        expect(firstYield.yieldPerTokenStaked).to.equal(
          0,
          "yieldPerTokenStaked is not 0"
        );
        expect(firstYield.totalStakeAtTime).to.equal(
          totalStakesAtTime,
          "totalStakes is not the same as input"
        );
        expect(firstYield.token).to.equal(
          ethers.constants.AddressZero,
          "token address is not 0"
        );

        expect(await vault.nextYieldId()).to.equal(
          1,
          "yieldId should increment by 1"
        );
      });
    });
    describe("amendYieldTokens", function () {
      let endTime;

      it("should change sinceTime via amendYieldTokens func", async function () {
        const newTime = await time.latest();
        await vaultSign.amendYieldTokens(
          1,
          ethers.constants.AddressZero,
          0,
          newTime,
          0
        );
        const firstYield = await vault.yields(0);
        expect(firstYield.sinceTime).to.equal(newTime);
      });

      it("should revert with a token zero address", async function () {
        // Unhappy pass allocateYieldTokens to stakers with a ethereum zero address
        endTime = await time.increase(360);
        await expect(
          vaultSign.amendYieldTokens(
            1,
            ethers.constants.AddressZero,
            yieldTokenAmt,
            0,
            endTime
          )
        ).to.be.revertedWith("token address cannot be 0");
      });

      it("should revert when an invalid tillTime is passed", async function () {
        // pass a new time
        const newTime = await time.latest();
        await vaultSign.amendYieldTokens(
          1,
          ethers.constants.AddressZero,
          0,
          newTime,
          0
        );

        // use the earlier endTime
        await expect(
          vaultSign.amendYieldTokens(
            1,
            mockToken.address,
            yieldTokenAmt,
            0,
            endTime
          )
        ).to.be.revertedWith("End time must be greater than startTime");
      });

      it("should revert if yieldId is zero", async function () {
        await time.increase(360);
        endTime = await time.latest();
        await expect(
          vaultSign.amendYieldTokens(
            0,
            mockToken.address,
            yieldTokenAmt,
            0,
            endTime
          )
        ).to.be.revertedWith("yieldId cannot be 0");
      });

      it("should revert if deployer does not have enough yield tokens to send", async function () {
        await expect(
          vaultSign.amendYieldTokens(
            1,
            mockToken.address,
            ethers.utils.parseUnits("200000"),
            0,
            endTime
          )
        ).to.be.revertedWith("Not enough tokens");
      });

      it("should end the yield programme when all input are processed", async function () {
        // Before ending yield
        const yieldArr = await vault.getPendingYield();
        const yieldId = yieldArr[0].toString();
        expect(yieldId).to.equal("1");
        expect(await vault.getEndedYield()).to.eql([
          ethers.BigNumber.from("0"),
        ]);

        await vaultSign.amendYieldTokens(
          yieldId,
          mockToken.address,
          yieldTokenAmt,
          0,
          endTime
        );

        // after ending yield
        expect(await vault.getPendingYield()).to.eql([
          ethers.BigNumber.from("0"),
        ]);
        expect(await vault.getEndedYield()).to.eql([
          ethers.BigNumber.from("1"),
        ]);

        const checkYield = await vault.yields(0);
        expect(checkYield.amount).to.equal(
          yieldTokenAmt,
          "amount is not reflecting yield token amount"
        );
        expect(checkYield.tillTime).to.be.gt(
          0,
          "tillTime must be greater than 0"
        );
        expect(checkYield.token).to.equal(
          mockToken.address,
          "token address is not reflecting the correct address"
        );

        const yieldPerStaked = yieldTokenAmt
          .mul(await vault.PRECISION_FACTOR())
          .div(totalStakesAtTime);
        expect(checkYield.yieldPerTokenStaked).to.equal(
          yieldPerStaked,
          "yieldPerTokenStaked is not reflecting a result"
        );
      });
    });

    describe("User claim yield tokens", function () {
      it("should revert when a 0 id is passed to func", async function () {
        await expect(vaultWallet1.claimYieldTokens(0, 1)).to.be.revertedWith(
          "id cannot be 0"
        );
        await expect(vaultWallet1.claimYieldTokens(1, 0)).to.be.revertedWith(
          "id cannot be 0"
        );
        await expect(vaultWallet1.claimYieldTokens(0, 0)).to.be.revertedWith(
          "id cannot be 0"
        );
      });

      it("should revert when caller specify someone else stakeId", async function () {
        await expect(vaultWallet1.claimYieldTokens(2, 1)).to.be.revertedWith(
          "stakeId must belong to caller"
        );
      });

      it("should update state variables when tokens are claimed", async function () {
        // Claim tokens
        const wallet1StakeArr = await vault.addressToStakeArr(wallet1.address);
        const filterWallet1Stake = wallet1StakeArr.map((obj) => obj.toNumber());

        // Check claims
        let [total, afterFee] = await vaultWallet1.getClaimsFor(
          filterWallet1Stake[0],
          1
        );
        const adminFee = total.sub(afterFee);
        afterFee = afterFee.toString();

        expect(await vaultWallet1.claimYieldTokens(filterWallet1Stake[0], 1))
          .to.emit("ClaimedTokens")
          .withArgs(
            0,
            filterWallet1Stake[0] - 1,
            mockToken.address,
            wallet1.address,
            afterFee
          );
        expect(await mockToken.balanceOf(wallet1.address)).to.equal(
          afterFee,
          "claimedTokens is not transferred to wallet1"
        );

        expect(await vault.addressClaimedYieldRewards(wallet1.address, 1, 1)).to
          .be.true;
        expect(
          await vault.tokensOfUserBalance(mockToken.address, wallet1.address)
        ).to.equal(
          afterFee,
          "Claim token amount not reflected on tokensOfUserBalance"
        );

        // check admin profits
        expect(await vault.profitsInToken(mockToken.address)).to.equal(
          adminFee,
          "Admin profit is not reflected in profitsInToken"
        );

        await expect(vaultWallet2.claimYieldTokens(2, 1)).to.changeTokenBalance(
          mockToken,
          wallet2,
          "63999999999999998720000"
        );
      });

      it("should revert when user claimed again", async function () {
        await expect(vaultWallet1.claimYieldTokens(1, 1)).to.be.revertedWith(
          "User must not claim rewards already"
        );
      });

      it("should revert when user deposit after the start of yield programme", async function () {
        // new user deposit
        await vaultWallet3.deposit({ value: ethers.utils.parseUnits("1") });
        await expect(vaultWallet3.claimYieldTokens(3, 1)).to.be.revertedWith(
          "User must have staked before start of yieldProgram"
        );
      });

      it("should revert when a yield programme has not concluded", async function () {
        // add new yields
        const mockToken2 = await MockToken.deploy();
        expect(await mockToken2.balanceOf(deployer.address)).to.equal(
          ethers.utils.parseUnits("100000"),
          "Admin address did not receive 100000 tokens"
        );
        const totalStateNow = await vault.totalStakes();
        await vaultSign.addYieldTokens(
          await time.latest(),
          totalStateNow.toString()
        );
        await expect(vaultWallet3.claimYieldTokens(3, 2)).to.be.revertedWith(
          "Yield program must have ended."
        );
      });
    });

    describe("admin claim profits", function () {
      it("should send bnb to owner", async function () {
        const bnbProfits = ethers.utils.parseUnits("0.3");
        expect(await vaultSign.withdrawProfits())
          .to.changeEtherBalance(vaultSign, "-300000000000000000")
          .to.emit("ProfitWithdraw")
          .withArgs(0, bnbProfits, ethers.constants.AddressZero);
      });

      it("should revert if profits is 0", async function () {
        await expect(vaultSign.withdrawProfits()).to.be.revertedWith(
          "Not enough gasToken to withdraw"
        );
      });

      it("should send tokens profits to owner", async function () {
        expect(await vaultSign.withdrawTokenProfits(mockToken.address))
          .to.changeTokenBalance(
            mockToken,
            deployer.address,
            "19999999999999999600000"
          )
          .to.emit("ProfitWithdraw")
          .withArgs(1, "19999999999999999600000", mockToken.address);
      });
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
        expect(await vaultSign.transferOwnership(wallet1.address))
          .to.emit("OwnershipTransferred")
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
        expect(await vaultWallet1.renounceOwnership())
          .to.emit("OwnershipTransferred")
          .withArgs(wallet1.address, ethers.constants.AddressZero);
        expect(await vault.owner()).to.equal(
          ethers.constants.AddressZero,
          "Owner address is not zero"
        );
      });
    });
  });
});