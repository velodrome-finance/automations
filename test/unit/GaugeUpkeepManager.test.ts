import { expect } from 'chai'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import {
  IERC20,
  VoterMock,
  CronUpkeep,
  CronUpkeepFactory,
  GaugeUpkeepManager,
  FactoryRegistryMock,
  KeeperRegistryMock,
  AutomationRegistrarMock,
} from '../../typechain-types'
import { getNextEpochUTC } from '../utils'
import { AutomationRegistrarMockAbi } from '../abi'
import { PerformAction } from '../constants'

const { AddressZero, HashZero } = ethers.constants

describe('GaugeUpkeepManager Unit Tests', function () {
  let gaugeUpkeepManager: GaugeUpkeepManager
  let cronUpkeep: CronUpkeep
  let cronUpkeepFactory: CronUpkeepFactory
  let linkToken: IERC20
  let keeperRegistryMock: KeeperRegistryMock
  let automationRegistrarMock: AutomationRegistrarMock
  let veloVoterMock: VoterMock
  let factoryRegistryMock: FactoryRegistryMock
  let fakeGaugeAddress: string
  let fakeCrosschainFactoryAddress: string
  let fakeNonCrosschainFactoryAddress: string
  let registerPerformData: string
  let cancelPerformData: string
  let accounts: SignerWithAddress[]

  const upkeepFundAmount = ethers.utils.parseEther('0.1')
  const upkeepGasLimit = 500000
  const upkeepId = 1

  beforeEach(async function () {
    accounts = await ethers.getSigners()

    // generate fake gauge factory addresses
    fakeCrosschainFactoryAddress = ethers.Wallet.createRandom().address
    fakeNonCrosschainFactoryAddress = ethers.Wallet.createRandom().address

    // deploy link token
    const erc20MintableFactory =
      await ethers.getContractFactory('ERC20Mintable')
    linkToken = await erc20MintableFactory.deploy()

    // deploy factory registry mock
    const factoryRegistryMockFactory = await ethers.getContractFactory(
      'FactoryRegistryMock',
    )
    factoryRegistryMock = await factoryRegistryMockFactory.deploy(
      fakeNonCrosschainFactoryAddress,
    )

    // deploy velo voter mock
    const poolMockFactory = await ethers.getContractFactory('PoolMock')
    const poolMock = await poolMockFactory.deploy()
    const veloVoterMockFactory = await ethers.getContractFactory('VoterMock')
    veloVoterMock = await veloVoterMockFactory.deploy(
      poolMock.address,
      factoryRegistryMock.address,
      fakeNonCrosschainFactoryAddress,
    )

    // deploy automation registrar mock
    const automationRegistrarMockFactory = await ethers.getContractFactory(
      'AutomationRegistrarMock',
    )
    automationRegistrarMock = await automationRegistrarMockFactory.deploy()

    // deploy keeper registry mock
    const keeperRegistryMockFactory =
      await ethers.getContractFactory('KeeperRegistryMock')
    keeperRegistryMock = await keeperRegistryMockFactory.deploy()

    // deploy cron library
    const cronLibraryFactory = await ethers.getContractFactory(
      '@chainlink/contracts/src/v0.8/automation/libraries/external/Cron.sol:Cron',
    )
    const cronLibrary = await cronLibraryFactory.deploy()

    // deploy cron upkeep factory
    const CronUpkeepFactory = await ethers.getContractFactory(
      'CronUpkeepFactory',
      {
        libraries: {
          Cron: cronLibrary.address,
        },
      },
    )
    cronUpkeepFactory = await CronUpkeepFactory.deploy()

    // deploy gauge upkeep manager
    const gaugeUpkeepManagerFactory =
      await ethers.getContractFactory('GaugeUpkeepManager')
    gaugeUpkeepManager = await gaugeUpkeepManagerFactory.deploy(
      linkToken.address,
      keeperRegistryMock.address,
      automationRegistrarMock.address,
      cronUpkeepFactory.address,
      veloVoterMock.address,
      upkeepFundAmount,
      upkeepGasLimit,
      [fakeCrosschainFactoryAddress],
    )
    gaugeUpkeepManager.setTrustedForwarder(accounts[0].address, true)

    // fund gauge upkeep manager with link token
    await linkToken.transfer(
      gaugeUpkeepManager.address,
      ethers.utils.parseEther('1'),
    )

    // generate perform data
    const abiCoder = new ethers.utils.AbiCoder()
    fakeGaugeAddress = accounts[1].address
    registerPerformData = abiCoder.encode(
      ['uint8', 'address'],
      [PerformAction.RegisterUpkeep, fakeGaugeAddress],
    )
    cancelPerformData = abiCoder.encode(
      ['uint8', 'address'],
      [PerformAction.CancelUpkeep, fakeGaugeAddress],
    )
  })

  describe('Deployment', function () {
    it('should deploy the contract with the correct parameters', async () => {
      expect(await gaugeUpkeepManager.linkToken()).to.equal(linkToken.address)
      expect(await gaugeUpkeepManager.keeperRegistry()).to.equal(
        keeperRegistryMock.address,
      )
      expect(await gaugeUpkeepManager.automationRegistrar()).to.equal(
        automationRegistrarMock.address,
      )
      expect(await gaugeUpkeepManager.cronUpkeepFactory()).to.equal(
        cronUpkeepFactory.address,
      )
      expect(await gaugeUpkeepManager.voter()).to.equal(veloVoterMock.address)
      expect(await gaugeUpkeepManager.newUpkeepFundAmount()).to.equal(
        upkeepFundAmount,
      )
      expect(await gaugeUpkeepManager.newUpkeepGasLimit()).to.equal(
        upkeepGasLimit,
      )
    })
  })

  describe('Register gauge upkeep', function () {
    it('should trigger a new upkeep registration', async () => {
      const createGaugeTx = await veloVoterMock.createGauge(fakeGaugeAddress)
      const createGaugeReceipt = await createGaugeTx.wait()
      const createGaugeLog = createGaugeReceipt.logs[0]
      const log = {
        index: createGaugeLog.transactionIndex,
        txHash: createGaugeLog.transactionHash,
        blockNumber: createGaugeLog.blockNumber,
        blockHash: createGaugeLog.blockHash,
        timestamp: 0,
        source: veloVoterMock.address,
        topics: createGaugeLog.topics,
        data: createGaugeLog.data,
      }

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(registerPerformData)
    })

    it('should register a new cron upkeep', async () => {
      const tx = await gaugeUpkeepManager.performUpkeep(registerPerformData)

      expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeUpkeepRegistered')
        .withArgs(fakeGaugeAddress, 1)

      const upkeepId = await gaugeUpkeepManager.gaugeUpkeepId(fakeGaugeAddress)
      const activeUpkeepId = await gaugeUpkeepManager.activeUpkeepIds(0)
      const activeUpkeepsCount = await gaugeUpkeepManager.activeUpkeepsCount()

      expect(upkeepId).to.equal(1)
      expect(activeUpkeepId).to.equal(1)
      expect(activeUpkeepsCount).to.equal(1)

      // get cron upkeep address and attach to contract
      const receipt = await tx.wait()
      const upkeepRegisteredLog = receipt.logs.find(
        (log) => log.address === automationRegistrarMock.address,
      )
      const iface = new ethers.utils.Interface(AutomationRegistrarMockAbi)
      const decodedLog = iface.parseLog(upkeepRegisteredLog!)
      const cronUpkeepAddress = decodedLog?.args[0][2]
      cronUpkeep = await ethers.getContractAt('CronUpkeep', cronUpkeepAddress)

      expect(cronUpkeep.address).to.be.properAddress
    })

    it('should not allow non-trusted forwarder to register upkeep', async () => {
      await expect(
        gaugeUpkeepManager
          .connect(accounts[1])
          .performUpkeep(registerPerformData),
      ).to.be.revertedWithCustomError(gaugeUpkeepManager, 'UnauthorizedSender')
    })

    it('should not trigger upkeep registration for crosschain gauges', async () => {
      await veloVoterMock.setGaugeFactory(fakeCrosschainFactoryAddress)
      const createGaugeTx = await veloVoterMock.createGauge(fakeGaugeAddress)
      const createGaugeReceipt = await createGaugeTx.wait()
      const createGaugeLog = createGaugeReceipt.logs[0]
      const log = {
        index: createGaugeLog.transactionIndex,
        txHash: createGaugeLog.transactionHash,
        blockNumber: createGaugeLog.blockNumber,
        blockHash: createGaugeLog.blockHash,
        timestamp: 0,
        source: veloVoterMock.address,
        topics: createGaugeLog.topics,
        data: createGaugeLog.data,
      }

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })
  })

  describe('Perform gauge upkeep', function () {
    it('should not trigger a cron upkeep when not scheduled', async () => {
      const [upkeepNeeded, performData] = await cronUpkeep
        .connect(AddressZero)
        .callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })

    it('should trigger a cron upkeep when scheduled', async () => {
      const timestamp = getNextEpochUTC().getTime() / 1000
      await time.increaseTo(timestamp)

      const [upkeepNeeded, performData] = await cronUpkeep
        .connect(AddressZero)
        .callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.not.equal('0x')
    })
  })

  describe('Cancel gauge upkeep', function () {
    it('should trigger upkeep cancellation', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      const killGaugeTx = await veloVoterMock.killGauge(fakeGaugeAddress)
      const killGaugeReceipt = await killGaugeTx.wait()
      const killGaugeLog = killGaugeReceipt.logs[0]
      const log = {
        index: killGaugeLog.transactionIndex,
        txHash: killGaugeLog.transactionHash,
        blockNumber: killGaugeLog.blockNumber,
        blockHash: killGaugeLog.blockHash,
        timestamp: 0,
        source: veloVoterMock.address,
        topics: killGaugeLog.topics,
        data: killGaugeLog.data,
      }

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(cancelPerformData)
    })

    it('should cancel a cron upkeep', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      const tx = await gaugeUpkeepManager.performUpkeep(cancelPerformData)
      await expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeUpkeepCancelled')
        .withArgs(fakeGaugeAddress, 1)

      const upkeepId = await gaugeUpkeepManager.gaugeUpkeepId(fakeGaugeAddress)
      const activeUpkeepsCount = await gaugeUpkeepManager.activeUpkeepsCount()

      expect(upkeepId).to.equal(0)
      expect(activeUpkeepsCount).to.equal(0)
    })

    it('should not allow non-trusted forwarder to cancel upkeep', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await expect(
        gaugeUpkeepManager
          .connect(accounts[1])
          .performUpkeep(cancelPerformData),
      ).to.be.revertedWithCustomError(gaugeUpkeepManager, 'UnauthorizedSender')
    })
  })

  describe('Withdraw gauge upkeep', function () {
    it('should withdraw a cron upkeep', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(cancelPerformData)

      const tx = await gaugeUpkeepManager.withdrawUpkeep(upkeepId)

      await expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeUpkeepWithdrawn')
        .withArgs(upkeepId)
    })
  })

  describe('Revive gauge upkeep', function () {
    it('should trigger upkeep revival', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(cancelPerformData)

      const reviveGaugeTx = await veloVoterMock.reviveGauge(fakeGaugeAddress)
      const reviveGaugeReceipt = await reviveGaugeTx.wait()
      const reviveGaugeLog = reviveGaugeReceipt.logs[0]
      const log = {
        index: reviveGaugeLog.transactionIndex,
        txHash: reviveGaugeLog.transactionHash,
        blockNumber: reviveGaugeLog.blockNumber,
        blockHash: reviveGaugeLog.blockHash,
        timestamp: 0,
        source: veloVoterMock.address,
        topics: reviveGaugeLog.topics,
        data: reviveGaugeLog.data,
      }

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(registerPerformData)
    })

    it('should revive a cron upkeep', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(cancelPerformData)

      const reviveGaugeTx = await veloVoterMock.reviveGauge(fakeGaugeAddress)
      await reviveGaugeTx.wait()

      const tx = await gaugeUpkeepManager.performUpkeep(registerPerformData)

      expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeUpkeepRegistered')
        .withArgs(fakeGaugeAddress, 1)

      const upkeepId = await gaugeUpkeepManager.gaugeUpkeepId(fakeGaugeAddress)
      const activeUpkeepId = await gaugeUpkeepManager.activeUpkeepIds(0)
      const activeUpkeepsCount = await gaugeUpkeepManager.activeUpkeepsCount()

      expect(upkeepId).to.equal(1)
      expect(activeUpkeepId).to.equal(1)
      expect(activeUpkeepsCount).to.equal(1)
    })

    it('should not allow non-trusted forwarder to revive upkeep', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(cancelPerformData)

      await expect(
        gaugeUpkeepManager
          .connect(accounts[1])
          .performUpkeep(registerPerformData),
      ).to.be.revertedWithCustomError(gaugeUpkeepManager, 'UnauthorizedSender')
    })

    it('should not trigger upkeep revival for crosschain gauges', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(cancelPerformData)
      await factoryRegistryMock.setGaugeFactory(fakeCrosschainFactoryAddress)

      const reviveGaugeTx = await veloVoterMock.reviveGauge(fakeGaugeAddress)
      const reviveGaugeReceipt = await reviveGaugeTx.wait()
      const reviveGaugeLog = reviveGaugeReceipt.logs[0]
      const log = {
        index: reviveGaugeLog.transactionIndex,
        txHash: reviveGaugeLog.transactionHash,
        blockNumber: reviveGaugeLog.blockNumber,
        blockHash: reviveGaugeLog.blockHash,
        timestamp: 0,
        source: veloVoterMock.address,
        topics: reviveGaugeLog.topics,
        data: reviveGaugeLog.data,
      }

      const [upkeepNeeded, performData] =
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })
  })

  describe('Owner functions', function () {
    it('should set a new upkeep gas limit', async () => {
      const newUpkeepGasLimit = 100000
      await gaugeUpkeepManager.setNewUpkeepGasLimit(newUpkeepGasLimit)

      expect(await gaugeUpkeepManager.newUpkeepGasLimit()).to.equal(
        newUpkeepGasLimit,
      )
    })

    it('should set a new upkeep fund amount', async () => {
      const newUpkeepFundAmount = ethers.utils.parseEther('0.2')
      await gaugeUpkeepManager.setNewUpkeepFundAmount(newUpkeepFundAmount)

      expect(await gaugeUpkeepManager.newUpkeepFundAmount()).to.equal(
        newUpkeepFundAmount,
      )
    })

    it('should set a new trusted forwarder', async () => {
      await gaugeUpkeepManager.setTrustedForwarder(accounts[1].address, true)

      expect(await gaugeUpkeepManager.trustedForwarder(accounts[1].address)).to
        .be.true
    })
  })
})
