import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  IERC20,
  VoterMock,
  RedistributeUpkeepManagerV2_3,
  FactoryRegistryMock,
  KeeperRegistryMock,
  AutomationRegistrarMockV2_3,
  UpkeepBalanceMonitorV2_3,
} from '../../../../typechain-types'
import { PerformAction } from '../../../constants'

const { HashZero } = ethers.constants

describe('RedistributeUpkeepManagerV2_3 Unit Tests', function () {
  let redistributeUpkeepManager: RedistributeUpkeepManagerV2_3
  let upkeepBalanceMonitor: UpkeepBalanceMonitorV2_3
  let linkToken: IERC20
  let keeperRegistryMock: KeeperRegistryMock
  let automationRegistrarMock: AutomationRegistrarMockV2_3
  let veloVoterMock: VoterMock
  let factoryRegistryMock: FactoryRegistryMock
  let fakeGaugeAddress: string
  let fakeExcludedFactoryAddress: string
  let fakeRegularFactoryAddress: string
  let registerPerformData: string
  let deregisterPerformData: string
  let accounts: SignerWithAddress[]

  const upkeepFundAmount = ethers.utils.parseEther('0.1')
  const gaugesPerUpkeepLimit = 100
  const upkeepCancelBuffer = 20
  const upkeepGasLimit = 500000
  const batchSize = 5
  const upkeepId = BigNumber.from(1)

  beforeEach(async function () {
    accounts = await ethers.getSigners()

    // generate fake gauge factory addresses
    fakeExcludedFactoryAddress = ethers.Wallet.createRandom().address
    fakeRegularFactoryAddress = ethers.Wallet.createRandom().address

    // deploy link token
    const erc20MintableFactory =
      await ethers.getContractFactory('ERC20Mintable')
    linkToken = await erc20MintableFactory.deploy()

    // deploy factory registry mock
    const factoryRegistryMockFactory = await ethers.getContractFactory(
      'FactoryRegistryMock',
    )
    factoryRegistryMock = await factoryRegistryMockFactory.deploy(
      fakeRegularFactoryAddress,
    )

    // deploy velo voter mock
    const poolMockFactory = await ethers.getContractFactory('PoolMock')
    const poolMock = await poolMockFactory.deploy()
    const veloVoterMockFactory = await ethers.getContractFactory('VoterMock')
    veloVoterMock = await veloVoterMockFactory.deploy(
      poolMock.address,
      factoryRegistryMock.address,
      fakeRegularFactoryAddress,
    )

    // deploy automation registrar mock
    const automationRegistrarMockFactory = await ethers.getContractFactory(
      'AutomationRegistrarMockV2_3',
    )
    automationRegistrarMock = await automationRegistrarMockFactory.deploy()

    // deploy keeper registry mock
    const keeperRegistryMockFactory =
      await ethers.getContractFactory('KeeperRegistryMock')
    keeperRegistryMock = await keeperRegistryMockFactory.deploy()

    // deploy upkeep balance monitor
    const upkeepBalanceMonitorFactory = await ethers.getContractFactory(
      'UpkeepBalanceMonitorV2_3',
    )
    upkeepBalanceMonitor = await upkeepBalanceMonitorFactory.deploy(
      linkToken.address,
      keeperRegistryMock.address,
      {
        maxBatchSize: 10,
        minPercentage: 120,
        targetPercentage: 300,
        maxTopUpAmount: ethers.utils.parseEther('10'),
        maxIterations: 10,
      },
    )

    // deploy redistribute upkeep manager
    const redistributeUpkeepManagerFactory = await ethers.getContractFactory(
      'RedistributeUpkeepManagerV2_3',
    )
    redistributeUpkeepManager = await redistributeUpkeepManagerFactory.deploy(
      linkToken.address,
      keeperRegistryMock.address,
      automationRegistrarMock.address,
      upkeepBalanceMonitor.address,
      veloVoterMock.address,
      upkeepFundAmount,
      upkeepGasLimit,
      batchSize,
      [fakeExcludedFactoryAddress],
    )
    redistributeUpkeepManager.setTrustedForwarder(accounts[0].address, true)

    // set redistribute upkeep manager as watch list manager in balance monitor
    await upkeepBalanceMonitor.grantWatchlistManagerRole(
      redistributeUpkeepManager.address,
    )

    // fund redistribute upkeep manager with link token
    await linkToken.transfer(
      redistributeUpkeepManager.address,
      ethers.utils.parseEther('1'),
    )

    // generate perform data
    const abiCoder = new ethers.utils.AbiCoder()
    fakeGaugeAddress = accounts[1].address
    registerPerformData = abiCoder.encode(
      ['uint8', 'address'],
      [PerformAction.RegisterGauge, fakeGaugeAddress],
    )
    deregisterPerformData = abiCoder.encode(
      ['uint8', 'address'],
      [PerformAction.DeregisterGauge, fakeGaugeAddress],
    )
  })

  describe('Deployment', function () {
    it('should deploy the contract with the correct parameters', async () => {
      expect(await redistributeUpkeepManager.linkToken()).to.equal(linkToken.address)
      expect(await redistributeUpkeepManager.keeperRegistry()).to.equal(
        keeperRegistryMock.address,
      )
      expect(await redistributeUpkeepManager.automationRegistrar()).to.equal(
        automationRegistrarMock.address,
      )
      expect(await redistributeUpkeepManager.voter()).to.equal(veloVoterMock.address)
      expect(await redistributeUpkeepManager.newUpkeepFundAmount()).to.equal(
        upkeepFundAmount,
      )
      expect(await redistributeUpkeepManager.newUpkeepGasLimit()).to.equal(
        upkeepGasLimit,
      )
    })
  })

  describe('Register redistribute upkeep', function () {
    it('should trigger a new gauge registration', async () => {
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
        await redistributeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(registerPerformData)
    })

    it('should register a new gauge', async () => {
      const tx = await redistributeUpkeepManager.performUpkeep(registerPerformData)

      await expect(tx)
        .to.emit(redistributeUpkeepManager, 'GaugeRegistered')
        .withArgs(fakeGaugeAddress)

      expect(await redistributeUpkeepManager.gaugeList(0, 1)).to.include(
        fakeGaugeAddress,
      )
    })

    it('should register a new redistribute upkeep', async () => {
      const tx = await redistributeUpkeepManager.performUpkeep(registerPerformData)

      await expect(tx).to.emit(redistributeUpkeepManager, 'RedistributeUpkeepRegistered')

      expect(await redistributeUpkeepManager.upkeepIds(0)).to.equal(1)
      expect(await redistributeUpkeepManager.upkeepCount()).to.equal(1)
    })

    it('should not register a new upkeep until the gauges per upkeep limit is reached', async () => {
      const bulkFakeGaugeAddresses = Array.from(
        { length: gaugesPerUpkeepLimit },
        () => ethers.Wallet.createRandom().address,
      )
      await redistributeUpkeepManager.registerGauges(bulkFakeGaugeAddresses)

      // should not register more than the gauges per upkeep limit
      expect(await redistributeUpkeepManager.upkeepCount()).to.equal(1)
      expect(await redistributeUpkeepManager.gaugeCount()).to.equal(
        gaugesPerUpkeepLimit,
      )

      // should register a new upkeep after the gauges per upkeep limit is reached
      await redistributeUpkeepManager.registerGauges([fakeGaugeAddress])

      expect(await redistributeUpkeepManager.upkeepCount()).to.equal(2)
      expect(await redistributeUpkeepManager.gaugeCount()).to.equal(
        gaugesPerUpkeepLimit + 1,
      )
    })

    it('should add registered upkeeps to the watch list', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)

      const watchList = await upkeepBalanceMonitor.getWatchList()

      expect(watchList).to.deep.include(upkeepId)
    })

    it('should not allow non-trusted forwarder to register upkeep', async () => {
      await expect(
        redistributeUpkeepManager
          .connect(accounts[1])
          .performUpkeep(registerPerformData),
      ).to.be.revertedWithCustomError(redistributeUpkeepManager, 'UnauthorizedSender')
    })

    it('should not trigger upkeep registration for excluded gauge factories', async () => {
      await veloVoterMock.setGaugeFactory(fakeExcludedFactoryAddress)
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
        await redistributeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })
  })

  describe('Cancel redistribute upkeep', function () {
    it('should trigger upkeep cancellation', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)
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
        await redistributeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(deregisterPerformData)
    })

    it('should deregister a gauge', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)
      const tx = await redistributeUpkeepManager.performUpkeep(deregisterPerformData)

      await expect(tx)
        .to.emit(redistributeUpkeepManager, 'GaugeDeregistered')
        .withArgs(fakeGaugeAddress)

      expect(await redistributeUpkeepManager.gaugeList(0, 1)).to.not.include(
        fakeGaugeAddress,
      )
      expect(await redistributeUpkeepManager.gaugeCount()).to.equal(0)
      expect(await redistributeUpkeepManager.cancelledUpkeeps(0, 1)).deep.include(
        upkeepId,
      )
    })

    it('should cancel a redistribute upkeep', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)
      const tx = await redistributeUpkeepManager.performUpkeep(deregisterPerformData)

      await expect(tx)
        .to.emit(redistributeUpkeepManager, 'RedistributeUpkeepCancelled')
        .withArgs(upkeepId)

      await expect(redistributeUpkeepManager.upkeepIds(0)).to.be.reverted

      expect(await redistributeUpkeepManager.upkeepCount()).to.equal(0)
    })

    it('should not cancel upkeep before the buffer is reached', async () => {
      const bulkFakeGaugeAddresses = Array.from(
        { length: gaugesPerUpkeepLimit + 1 },
        () => ethers.Wallet.createRandom().address,
      )
      await redistributeUpkeepManager.registerGauges(bulkFakeGaugeAddresses)
      expect(await redistributeUpkeepManager.upkeepCount()).to.equal(2)

      // upkeep should not be cancelled until the buffer is reached
      await redistributeUpkeepManager.deregisterGauges(
        bulkFakeGaugeAddresses.slice(0, upkeepCancelBuffer),
      )
      expect(await redistributeUpkeepManager.upkeepCount()).to.equal(2)

      // upkeep should be cancelled after the buffer is reached
      await expect(
        redistributeUpkeepManager.deregisterGauges(
          bulkFakeGaugeAddresses.slice(
            upkeepCancelBuffer,
            upkeepCancelBuffer + 1,
          ),
        ),
      ).to.emit(redistributeUpkeepManager, 'RedistributeUpkeepCancelled')
      expect(await redistributeUpkeepManager.upkeepCount()).to.equal(1)
      expect(await redistributeUpkeepManager.gaugeCount()).to.equal(
        gaugesPerUpkeepLimit - upkeepCancelBuffer,
      )
    })

    it('should remove cancelled upkeeps from the watch list', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)
      await redistributeUpkeepManager.performUpkeep(deregisterPerformData)

      const watchList = await upkeepBalanceMonitor.getWatchList()

      expect(watchList).to.not.include(upkeepId)
    })

    it('should not allow non-trusted forwarder to cancel upkeep', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)
      await expect(
        redistributeUpkeepManager
          .connect(accounts[1])
          .performUpkeep(deregisterPerformData),
      ).to.be.revertedWithCustomError(redistributeUpkeepManager, 'UnauthorizedSender')
    })
  })

  describe('Withdraw redistribute upkeep', function () {
    it('should get cancelled upkeep ids', async () => {
      expect(await redistributeUpkeepManager.cancelledUpkeeps(0, 1)).to.be.empty

      await redistributeUpkeepManager.performUpkeep(registerPerformData)
      await redistributeUpkeepManager.performUpkeep(deregisterPerformData)

      expect(await redistributeUpkeepManager.cancelledUpkeeps(0, 1)).to.deep.include(
        upkeepId,
      )
    })

    it('should get cancelled upkeeps count', async () => {
      expect(await redistributeUpkeepManager.cancelledUpkeepCount()).to.equal(0)

      await redistributeUpkeepManager.performUpkeep(registerPerformData)
      await redistributeUpkeepManager.performUpkeep(deregisterPerformData)

      expect(await redistributeUpkeepManager.cancelledUpkeepCount()).to.equal(1)
    })

    it('should withdraw cancelled upkeep balance', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)
      await redistributeUpkeepManager.performUpkeep(deregisterPerformData)

      const tx = await redistributeUpkeepManager.withdrawCancelledUpkeeps(0, 1)

      await expect(tx)
        .to.emit(redistributeUpkeepManager, 'RedistributeUpkeepWithdrawn')
        .withArgs(upkeepId)
    })

    it('should withdraw multiple cancelled upkeeps', async () => {
      const upkeepCount = 2
      const fakeGaugeAddresses = Array.from(
        { length: gaugesPerUpkeepLimit * upkeepCount },
        () => ethers.Wallet.createRandom().address,
      )
      await redistributeUpkeepManager.registerGauges(fakeGaugeAddresses)
      await redistributeUpkeepManager.deregisterGauges(fakeGaugeAddresses)

      expect(await redistributeUpkeepManager.cancelledUpkeepCount()).to.equal(
        upkeepCount,
      )

      const tx = await redistributeUpkeepManager.withdrawCancelledUpkeeps(
        0,
        upkeepCount,
      )
      const receipt = await tx.wait()
      const redistributeUpkeepWithdrawnLogs = receipt.logs.filter(
        (log) =>
          log.topics[0] ===
          redistributeUpkeepManager.interface.getEventTopic('RedistributeUpkeepWithdrawn'),
      )

      expect(redistributeUpkeepWithdrawnLogs.length).to.equal(upkeepCount)
      expect(await redistributeUpkeepManager.cancelledUpkeepCount()).to.equal(0)
    })
  })

  describe('Revive redistribute upkeep', function () {
    it('should trigger gauge revival', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)
      await redistributeUpkeepManager.performUpkeep(deregisterPerformData)

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
        await redistributeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(registerPerformData)
    })

    it('should not trigger gauge revival for excluded gauge factories', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)
      await redistributeUpkeepManager.performUpkeep(deregisterPerformData)
      await factoryRegistryMock.setGaugeFactory(fakeExcludedFactoryAddress)

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
        await redistributeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })
  })

  describe('Owner functions', function () {
    it('should set a new upkeep gas limit', async () => {
      const newUpkeepGasLimit = 100000
      await redistributeUpkeepManager.setNewUpkeepGasLimit(newUpkeepGasLimit)

      expect(await redistributeUpkeepManager.newUpkeepGasLimit()).to.equal(
        newUpkeepGasLimit,
      )
    })

    it('should set a new upkeep fund amount', async () => {
      const newUpkeepFundAmount = ethers.utils.parseEther('0.2')
      await redistributeUpkeepManager.setNewUpkeepFundAmount(newUpkeepFundAmount)

      expect(await redistributeUpkeepManager.newUpkeepFundAmount()).to.equal(
        newUpkeepFundAmount,
      )
    })

    it('should set a new batch size', async () => {
      const newBatchSize = 10
      await redistributeUpkeepManager.setBatchSize(newBatchSize)

      expect(await redistributeUpkeepManager.batchSize()).to.equal(newBatchSize)
    })

    it('should revert when setting batch size to 0', async () => {
      await expect(
        redistributeUpkeepManager.setBatchSize(0),
      ).to.be.revertedWithCustomError(redistributeUpkeepManager, 'InvalidBatchSize')
    })

    it('should revert when setting batch size greater than the gauges per upkeep limit', async () => {
      await expect(
        redistributeUpkeepManager.setBatchSize(gaugesPerUpkeepLimit + 1),
      ).to.be.revertedWithCustomError(redistributeUpkeepManager, 'InvalidBatchSize')
    })

    it('should set a new trusted forwarder', async () => {
      await redistributeUpkeepManager.setTrustedForwarder(accounts[1].address, true)

      expect(await redistributeUpkeepManager.trustedForwarder(accounts[1].address)).to
        .be.true
    })

    it('should set a new upkeep balance monitor', async () => {
      const newUpkeepBalanceMonitor = accounts[1]

      await redistributeUpkeepManager.setUpkeepBalanceMonitor(
        newUpkeepBalanceMonitor.address,
      )

      expect(await redistributeUpkeepManager.upkeepBalanceMonitor()).to.equal(
        newUpkeepBalanceMonitor.address,
      )
    })

    it('should set excluded factory address', async () => {
      const newFactoryAddress = ethers.Wallet.createRandom().address
      await redistributeUpkeepManager.setExcludedGaugeFactory(newFactoryAddress, true)

      expect(
        await redistributeUpkeepManager.excludedGaugeFactory(newFactoryAddress),
      ).to.equal(true)

      await redistributeUpkeepManager.setExcludedGaugeFactory(newFactoryAddress, false)

      expect(
        await redistributeUpkeepManager.excludedGaugeFactory(newFactoryAddress),
      ).to.equal(false)
    })

    it('should register redistribute upkeeps in bulk', async () => {
      const gaugeAddresses = [
        accounts[1].address,
        accounts[2].address,
        accounts[3].address,
      ]

      const tx = await redistributeUpkeepManager.registerGauges(gaugeAddresses)

      await expect(tx).to.emit(redistributeUpkeepManager, 'RedistributeUpkeepRegistered')
      await expect(tx)
        .to.emit(redistributeUpkeepManager, 'GaugeRegistered')
        .withArgs(gaugeAddresses[0])
        .to.emit(redistributeUpkeepManager, 'GaugeRegistered')
        .withArgs(gaugeAddresses[1])
        .to.emit(redistributeUpkeepManager, 'GaugeRegistered')
        .withArgs(gaugeAddresses[2])
    })

    it('should deregister redistribute upkeeps in bulk', async () => {
      const gaugeAddresses = [
        accounts[1].address,
        accounts[2].address,
        accounts[3].address,
      ]

      await redistributeUpkeepManager.registerGauges(gaugeAddresses)

      const tx = await redistributeUpkeepManager.deregisterGauges(gaugeAddresses)

      await expect(tx)
        .to.emit(redistributeUpkeepManager, 'GaugeDeregistered')
        .withArgs(gaugeAddresses[0])
        .to.emit(redistributeUpkeepManager, 'GaugeDeregistered')
        .withArgs(gaugeAddresses[1])
        .to.emit(redistributeUpkeepManager, 'GaugeDeregistered')
        .withArgs(gaugeAddresses[2])
    })
  })

  describe('Misc', function () {
    it('should return the gauge count', async () => {
      await redistributeUpkeepManager.performUpkeep(registerPerformData)

      expect(await redistributeUpkeepManager.gaugeCount()).to.equal(1)
    })

    it('should return a range of gauges', async () => {
      const bulkFakeGaugeAddresses = Array.from(
        { length: 5 },
        () => ethers.Wallet.createRandom().address,
      )
      await redistributeUpkeepManager.registerGauges(bulkFakeGaugeAddresses)

      const gauges = await redistributeUpkeepManager.gaugeList(0, 5)

      expect(gauges).to.have.lengthOf(5)
      expect(gauges).to.include.members(bulkFakeGaugeAddresses)
    })
  })
})
