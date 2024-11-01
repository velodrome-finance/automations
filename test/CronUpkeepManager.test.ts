import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  CronUpkeep,
  CronUpkeepManager,
  AutomationRegistrarMock,
  VoterMock,
} from "../typechain-types";

import { abi as AutomationRegistrarMockAbi } from "../artifacts/contracts/test/AutomationRegistrarMock.sol/AutomationRegistrarMock.json";

const { AddressZero, HashZero } = ethers.constants;

describe("CronUpkeepManager", function () {
  let cronUpkeepManager: CronUpkeepManager;
  let cronUpkeep: CronUpkeep;
  let automationRegistrarMock: AutomationRegistrarMock;
  let veloVoterMock: VoterMock;
  let fakeGaugeAddress: string;
  let encodedGaugeAddress: string;
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

    // deploy cron upkeep manager
    const cronUpkeepManagerFactory = await ethers.getContractFactory(
      "CronUpkeepManager",
      {
        libraries: {
          Cron: cronLibrary.address,
        },
      }
    );
    cronUpkeepManager = await cronUpkeepManagerFactory.deploy(
      linkToken.address,
      automationRegistrarMock.address,
      cronUpkeepDelegate.address,
      veloVoterMock.address,
      upkeepFundAmount,
      upkeepGasLimit
    );

    // fund cron upkeep manager with link token
    await linkToken.transfer(
      cronUpkeepManager.address,
      ethers.utils.parseEther("1")
    );

    const abiCoder = new ethers.utils.AbiCoder();
    fakeGaugeAddress = accounts[1].address;
    encodedGaugeAddress = abiCoder.encode(["address"], [fakeGaugeAddress]);
  });

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
      await cronUpkeepManager.callStatic.checkLog(log, HashZero);

    expect(upkeepNeeded).to.be.true;
    expect(performData).to.equal(encodedGaugeAddress);
  });

  it("should register a new cron upkeep", async () => {
    const tx = await cronUpkeepManager.performUpkeep(encodedGaugeAddress);

    expect(tx)
      .to.emit(cronUpkeepManager, "GaugeUpkeepRegistered")
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
