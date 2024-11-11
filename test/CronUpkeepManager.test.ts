import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { time, mine } from "@nomicfoundation/hardhat-network-helpers";
import {
  CronUpkeep,
  GaugeUpkeepManager,
  AutomationRegistrarMock,
  VoterMock,
} from "../typechain-types";

import { abi as AutomationRegistrarMockAbi } from "../artifacts/contracts/test/AutomationRegistrarMock.sol/AutomationRegistrarMock.json";

const { AddressZero, HashZero } = ethers.constants;

enum PerformAction {
  RegisterUpkeep = 0,
  CancelUpkeep = 1,
  WithdrawUpkeep = 2,
}

const UPKEEP_CANCELLATION_DELAY = 100;

describe("GaugeUpkeepManager", function () {
  let gaugeUpkeepManager: GaugeUpkeepManager;
  let cronUpkeep: CronUpkeep;
  let automationRegistrarMock: AutomationRegistrarMock;
  let veloVoterMock: VoterMock;
  let fakeGaugeAddress: string;
  let registerPerformData: string;
  let cancelPerformData: string;
  let withdrawPerformData: string;
  let accounts: SignerWithAddress[];

  const upkeepFundAmount = ethers.utils.parseEther("0.1");
  const upkeepGasLimit = 500000;

  beforeEach(async function () {
    accounts = await ethers.getSigners();

    // deploy link token
    const erc20MintableFactory = await ethers.getContractFactory(
      "ERC20Mintable"
    );
    const linkToken = await erc20MintableFactory.deploy();

    // deploy cron delegate
    const cronUpkeepDelegateFactory = await ethers.getContractFactory(
      "CronUpkeepDelegate"
    );
    const cronUpkeepDelegate = await cronUpkeepDelegateFactory.deploy();

    // deploy cron library
    const cronLibraryFactory = await ethers.getContractFactory(
      "@chainlink/contracts/src/v0.8/automation/libraries/external/Cron.sol:Cron"
    );
    const cronLibrary = await cronLibraryFactory.deploy();

    // deploy velo voter mock
    const veloVoterMockFactory = await ethers.getContractFactory("VoterMock");
    veloVoterMock = await veloVoterMockFactory.deploy();

    // deploy automation registrar mock
    const automationRegistrarMockFactory = await ethers.getContractFactory(
      "AutomationRegistrarMock"
    );
    automationRegistrarMock = await automationRegistrarMockFactory.deploy();

    // deploy keeper registry mock
    const keeperRegistryMockFactory = await ethers.getContractFactory(
      "KeeperRegistryMock"
    );
    const keeperRegistryMock = await keeperRegistryMockFactory.deploy();

    // deploy gauge upkeep manager
    const gaugeUpkeepManagerFactory = await ethers.getContractFactory(
      "GaugeUpkeepManager",
      {
        libraries: {
          Cron: cronLibrary.address,
        },
      }
    );
    gaugeUpkeepManager = await gaugeUpkeepManagerFactory.deploy(
      linkToken.address,
      keeperRegistryMock.address,
      automationRegistrarMock.address,
      cronUpkeepDelegate.address,
      veloVoterMock.address,
      upkeepFundAmount,
      upkeepGasLimit
    );

    // fund cron upkeep manager with link token
    await linkToken.transfer(
      gaugeUpkeepManager.address,
      ethers.utils.parseEther("1")
    );

    // generate perform data
    const abiCoder = new ethers.utils.AbiCoder();
    fakeGaugeAddress = accounts[1].address;
    registerPerformData = abiCoder.encode(
      ["uint8", "address"],
      [PerformAction.RegisterUpkeep, fakeGaugeAddress]
    );
    cancelPerformData = abiCoder.encode(
      ["uint8", "address"],
      [PerformAction.CancelUpkeep, fakeGaugeAddress]
    );
    withdrawPerformData = abiCoder.encode(
      ["uint8", "address"],
      [PerformAction.WithdrawUpkeep, fakeGaugeAddress]
    );
  });

  describe("Register gauge upkeep", function () {
    it("should trigger a new upkeep registration", async () => {
      const createGaugeTx = await veloVoterMock.createGauge(fakeGaugeAddress);
      const createGaugeReceipt = await createGaugeTx.wait();
      const createGaugeLog = createGaugeReceipt.logs[0];
      const log = {
        index: createGaugeLog.transactionIndex,
        txHash: createGaugeLog.transactionHash,
        blockNumber: createGaugeLog.blockNumber,
        blockHash: createGaugeLog.blockHash,
        timestamp: 0,
        source: veloVoterMock.address,
        topics: createGaugeLog.topics,
        data: createGaugeLog.data,
      };

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero);

      expect(upkeepNeeded).to.be.true;
      expect(performData).to.equal(registerPerformData);
    });

    it("should register a new cron upkeep", async () => {
      const tx = await gaugeUpkeepManager.performUpkeep(registerPerformData);

      expect(tx)
        .to.emit(gaugeUpkeepManager, "GaugeUpkeepRegistered")
        .withArgs(fakeGaugeAddress, 1);

      const receipt = await tx.wait();
      const upkeepRegisteredLog = receipt.logs.find(
        (log) => log.address === automationRegistrarMock.address
      );

      expect(upkeepRegisteredLog).to.exist;

      const iface = new ethers.utils.Interface(AutomationRegistrarMockAbi);
      const decodedLog = iface.parseLog(upkeepRegisteredLog!);
      const cronUpkeepAddress = decodedLog?.args[0][2];
      cronUpkeep = await ethers.getContractAt("CronUpkeep", cronUpkeepAddress);

      expect(cronUpkeep.address).to.be.properAddress;
    });
  });

  describe("Perform gauge upkeep", function () {
    it("should not trigger a cron upkeep when not scheduled", async () => {
      const [upkeepNeeded, performData] = await cronUpkeep
        .connect(AddressZero)
        .callStatic.checkUpkeep(HashZero);

      expect(upkeepNeeded).to.be.false;
      expect(performData).to.equal("0x");
    });

    it("should trigger a cron upkeep when scheduled", async () => {
      const timestamp = getNextWednesdayMidnightUTC().getTime() / 1000;
      await time.increaseTo(timestamp);

      const [upkeepNeeded, performData] = await cronUpkeep
        .connect(AddressZero)
        .callStatic.checkUpkeep(HashZero);

      expect(upkeepNeeded).to.be.true;
      expect(performData).to.not.equal("0x");
    });
  });

  describe("Cancel gauge upkeep", function () {
    it("should trigger upkeep cancellation", async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData);
      const killGaugeTx = await veloVoterMock.killGauge(fakeGaugeAddress);
      const killGaugeReceipt = await killGaugeTx.wait();
      const killGaugeLog = killGaugeReceipt.logs[0];
      const log = {
        index: killGaugeLog.transactionIndex,
        txHash: killGaugeLog.transactionHash,
        blockNumber: killGaugeLog.blockNumber,
        blockHash: killGaugeLog.blockHash,
        timestamp: 0,
        source: veloVoterMock.address,
        topics: killGaugeLog.topics,
        data: killGaugeLog.data,
      };

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero);

      expect(upkeepNeeded).to.be.true;
      expect(performData).to.equal(cancelPerformData);
    });

    it("should cancel a cron upkeep", async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData);
      const tx = await gaugeUpkeepManager.performUpkeep(cancelPerformData);
      await expect(tx)
        .to.emit(gaugeUpkeepManager, "GaugeUpkeepCancelled")
        .withArgs(fakeGaugeAddress, 1);
    });
  });

  describe("Withdraw gauge upkeep", function () {
    it("should not trigger upkeep withdrawal before cancellation delay", async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData);
      await gaugeUpkeepManager.performUpkeep(cancelPerformData);

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkUpkeep(HashZero);

      expect(upkeepNeeded).to.be.false;
      expect(performData).to.equal("0x");
    });

    it("should trigger upkeep withdrawal after cancellation delay", async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData);
      await gaugeUpkeepManager.performUpkeep(cancelPerformData);

      await mine(UPKEEP_CANCELLATION_DELAY);

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkUpkeep(HashZero);

      expect(upkeepNeeded).to.be.true;
      expect(performData).to.equal(withdrawPerformData);
    });

    it("should withdraw a cron upkeep", async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData);
      await gaugeUpkeepManager.performUpkeep(cancelPerformData);

      await mine(UPKEEP_CANCELLATION_DELAY);

      const tx = await gaugeUpkeepManager.performUpkeep(withdrawPerformData);

      await expect(tx)
        .to.emit(gaugeUpkeepManager, "GaugeUpkeepWithdrawn")
        .withArgs(fakeGaugeAddress, 1);
    });

    it("should remove a cron upkeep after withdrawal", async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData);
      await gaugeUpkeepManager.performUpkeep(cancelPerformData);

      await mine(UPKEEP_CANCELLATION_DELAY);

      await gaugeUpkeepManager.performUpkeep(withdrawPerformData);

      // should not trigger upkeep withdrawal after removal
      const [logicUpkeepNeeded, logicPerformData] =
        await gaugeUpkeepManager.callStatic.checkUpkeep(HashZero);
      expect(logicUpkeepNeeded).to.be.false;
      expect(logicPerformData).to.equal("0x");

      // should be able to register a new upkeep with the same gauge address
      const createGaugeTx = await veloVoterMock.createGauge(fakeGaugeAddress);
      const createGaugeReceipt = await createGaugeTx.wait();
      const createGaugeLog = createGaugeReceipt.logs[0];
      const log = {
        index: createGaugeLog.transactionIndex,
        txHash: createGaugeLog.transactionHash,
        blockNumber: createGaugeLog.blockNumber,
        blockHash: createGaugeLog.blockHash,
        timestamp: 0,
        source: veloVoterMock.address,
        topics: createGaugeLog.topics,
        data: createGaugeLog.data,
      };
      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero);
      expect(upkeepNeeded).to.be.true;
      expect(performData).to.equal(registerPerformData);
    });
  });

  describe("Revive gauge upkeep", function () {
    it("should trigger upkeep revival", async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData);
      await gaugeUpkeepManager.performUpkeep(cancelPerformData);
      await mine(UPKEEP_CANCELLATION_DELAY);
      await gaugeUpkeepManager.performUpkeep(withdrawPerformData);

      const reviveGaugeTx = await veloVoterMock.reviveGauge(fakeGaugeAddress);
      const reviveGaugeReceipt = await reviveGaugeTx.wait();
      const reviveGaugeLog = reviveGaugeReceipt.logs[0];
      const log = {
        index: reviveGaugeLog.transactionIndex,
        txHash: reviveGaugeLog.transactionHash,
        blockNumber: reviveGaugeLog.blockNumber,
        blockHash: reviveGaugeLog.blockHash,
        timestamp: 0,
        source: veloVoterMock.address,
        topics: reviveGaugeLog.topics,
        data: reviveGaugeLog.data,
      };

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero);

      expect(upkeepNeeded).to.be.true;
      expect(performData).to.equal(registerPerformData);
    });
  });
});

function getNextWednesdayMidnightUTC(): Date {
  const now = new Date();
  const currentDay = now.getUTCDay();
  const daysUntilWednesday = (3 - currentDay + 7) % 7 || 7;
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysUntilWednesday,
      0,
      0,
      0,
      0
    )
  );
}
