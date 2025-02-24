import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  IERC20,
  VoterMock,
  GaugeUpkeepManager,
  FactoryRegistryMock,
  KeeperRegistryMock,
  AutomationRegistrarMock,
  UpkeepBalanceMonitor,
} from '../../typechain-types'
import { PerformAction } from '../constants'

const { HashZero } = ethers.constants

describe('GaugeUpkeepManager Unit Tests', function () {
  let gaugeUpkeepManager: GaugeUpkeepManager
  let upkeepBalanceMonitor: UpkeepBalanceMonitor
  let linkToken: IERC20
  let keeperRegistryMock: KeeperRegistryMock
  let automationRegistrarMock: AutomationRegistrarMock
  let veloVoterMock: VoterMock
  let factoryRegistryMock: FactoryRegistryMock
  let fakeGaugeAddress: string
  let fakeCrosschainFactoryAddress: string
  let fakeNonCrosschainFactoryAddress: string
  let registerPerformData: string
  let deregisterPerformData: string
  let accounts: SignerWithAddress[]

  const upkeepFundAmount = ethers.utils.parseEther('0.1')
  const gaugesPerUpkeepLimit = 100
  const upkeepCancelBuffer = 20
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

    // deploy upkeep balance monitor
    const upkeepBalanceMonitorFactory = await ethers.getContractFactory(
      'UpkeepBalanceMonitor',
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

    // deploy gauge upkeep manager
    const gaugeUpkeepManagerFactory =
      await ethers.getContractFactory('GaugeUpkeepManager')
    gaugeUpkeepManager = await gaugeUpkeepManagerFactory.deploy(
      linkToken.address,
      keeperRegistryMock.address,
      automationRegistrarMock.address,
      upkeepBalanceMonitor.address,
      veloVoterMock.address,
      upkeepFundAmount,
      upkeepGasLimit,
      [fakeCrosschainFactoryAddress],
    )
    gaugeUpkeepManager.setTrustedForwarder(accounts[0].address, true)

    // set gauge upkeep manager as watch list manager in balance monitor
    await upkeepBalanceMonitor.grantWatchlistManagerRole(
      gaugeUpkeepManager.address,
    )

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
      [PerformAction.RegisterGauge, fakeGaugeAddress],
    )
    deregisterPerformData = abiCoder.encode(
      ['uint8', 'address'],
      [PerformAction.DeregisterGauge, fakeGaugeAddress],
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
        await gaugeUpkeepManager.callStatic.checkLog(log, HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal(registerPerformData)
    })

    it('should register a new gauge', async () => {
      const tx = await gaugeUpkeepManager.performUpkeep(registerPerformData)

      await expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeRegistered')
        .withArgs(fakeGaugeAddress)

      expect(await gaugeUpkeepManager.gaugeList(0, 1)).to.include(
        fakeGaugeAddress,
      )
    })

    it('should register a new gauge upkeep', async () => {
      const tx = await gaugeUpkeepManager.performUpkeep(registerPerformData)

      await expect(tx).to.emit(gaugeUpkeepManager, 'GaugeUpkeepRegistered')

      expect(await gaugeUpkeepManager.upkeepIds(0)).to.equal(1)
      expect(await gaugeUpkeepManager.upkeepCount()).to.equal(1)
    })

    it('should not register a new upkeep until the gauges per upkeep limit is reached', async () => {
      const bulkFakeGaugeAddresses = Array.from(
        { length: gaugesPerUpkeepLimit },
        () => ethers.Wallet.createRandom().address,
      )
      await gaugeUpkeepManager.registerGauges(bulkFakeGaugeAddresses)

      // should not register more than the gauges per upkeep limit
      expect(await gaugeUpkeepManager.upkeepCount()).to.equal(1)
      expect(await gaugeUpkeepManager.gaugeCount()).to.equal(
        gaugesPerUpkeepLimit,
      )

      // should register a new upkeep after the gauges per upkeep limit is reached
      await gaugeUpkeepManager.registerGauges([fakeGaugeAddress])

      expect(await gaugeUpkeepManager.upkeepCount()).to.equal(2)
      expect(await gaugeUpkeepManager.gaugeCount()).to.equal(
        gaugesPerUpkeepLimit + 1,
      )
    })

    it('should add registered upkeeps to the watch list', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)

      const watchList = await upkeepBalanceMonitor.getWatchList()

      expect(watchList).to.deep.include(BigNumber.from(upkeepId))
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
      expect(performData).to.equal(deregisterPerformData)
    })

    it('should deregister a gauge', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      const tx = await gaugeUpkeepManager.performUpkeep(deregisterPerformData)

      await expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeDeregistered')
        .withArgs(fakeGaugeAddress)

      expect(await gaugeUpkeepManager.gaugeList(0, 1)).to.not.include(
        fakeGaugeAddress,
      )
      expect(await gaugeUpkeepManager.gaugeCount()).to.equal(0)
    })

    it('should cancel a gauge upkeep', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      const tx = await gaugeUpkeepManager.performUpkeep(deregisterPerformData)

      await expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeUpkeepCancelled')
        .withArgs(upkeepId)

      await expect(gaugeUpkeepManager.upkeepIds(0)).to.be.reverted

      expect(await gaugeUpkeepManager.upkeepCount()).to.equal(0)
    })

    it('should not cancel upkeep before the buffer is reached', async () => {
      const bulkFakeGaugeAddresses = Array.from(
        { length: gaugesPerUpkeepLimit + 1 },
        () => ethers.Wallet.createRandom().address,
      )
      await gaugeUpkeepManager.registerGauges(bulkFakeGaugeAddresses)
      expect(await gaugeUpkeepManager.upkeepCount()).to.equal(2)

      // upkeep should not be cancelled until the buffer is reached
      await gaugeUpkeepManager.deregisterGauges(
        bulkFakeGaugeAddresses.slice(0, upkeepCancelBuffer),
      )
      expect(await gaugeUpkeepManager.upkeepCount()).to.equal(2)

      // upkeep should be cancelled after the buffer is reached
      await expect(
        gaugeUpkeepManager.deregisterGauges(
          bulkFakeGaugeAddresses.slice(
            upkeepCancelBuffer,
            upkeepCancelBuffer + 1,
          ),
        ),
      ).to.emit(gaugeUpkeepManager, 'GaugeUpkeepCancelled')
      expect(await gaugeUpkeepManager.upkeepCount()).to.equal(1)
      expect(await gaugeUpkeepManager.gaugeCount()).to.equal(
        gaugesPerUpkeepLimit - upkeepCancelBuffer,
      )
    })

    it('should remove cancelled upkeeps from the watch list', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(deregisterPerformData)

      const watchList = await upkeepBalanceMonitor.getWatchList()

      expect(watchList).to.not.include(BigNumber.from(upkeepId))
    })

    it('should add cancelled upkeeps to the cancelled upkeeps list', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(deregisterPerformData)

      expect(await gaugeUpkeepManager.cancelledUpkeeps(0, 1)).to.deep.include(
        BigNumber.from(upkeepId),
      )
    })

    it('should not allow non-trusted forwarder to cancel upkeep', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await expect(
        gaugeUpkeepManager
          .connect(accounts[1])
          .performUpkeep(deregisterPerformData),
      ).to.be.revertedWithCustomError(gaugeUpkeepManager, 'UnauthorizedSender')
    })
  })

  describe('Withdraw gauge upkeep', function () {
    it('should get cancelled upkeep ids', async () => {
      expect(await gaugeUpkeepManager.cancelledUpkeeps(0, 1)).to.be.empty

      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(deregisterPerformData)

      expect(await gaugeUpkeepManager.cancelledUpkeeps(0, 1)).to.deep.include(
        BigNumber.from(upkeepId),
      )
    })

    it('should get cancelled upkeeps count', async () => {
      expect(await gaugeUpkeepManager.cancelledUpkeepCount()).to.equal(0)

      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(deregisterPerformData)

      expect(await gaugeUpkeepManager.cancelledUpkeepCount()).to.equal(1)
    })

    it('should withdraw upkeep balance', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(deregisterPerformData)

      const tx = await gaugeUpkeepManager.withdrawCancelledUpkeeps(0, 1)

      await expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeUpkeepWithdrawn')
        .withArgs(upkeepId)
    })
  })

  describe('Revive gauge upkeep', function () {
    it('should trigger gauge revival', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(deregisterPerformData)

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

    it('should not trigger gauge revival for crosschain gauges', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)
      await gaugeUpkeepManager.performUpkeep(deregisterPerformData)
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

    it('should set a new upkeep balance monitor', async () => {
      const newUpkeepBalanceMonitor = accounts[1]

      await gaugeUpkeepManager.setUpkeepBalanceMonitor(
        newUpkeepBalanceMonitor.address,
      )

      expect(await gaugeUpkeepManager.upkeepBalanceMonitor()).to.equal(
        newUpkeepBalanceMonitor.address,
      )
    })

    it('should register gauge upkeeps in bulk', async () => {
      const gaugeAddresses = [
        accounts[1].address,
        accounts[2].address,
        accounts[3].address,
      ]

      const tx = await gaugeUpkeepManager.registerGauges(gaugeAddresses)

      await expect(tx).to.emit(gaugeUpkeepManager, 'GaugeUpkeepRegistered')
      await expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeRegistered')
        .withArgs(gaugeAddresses[0])
        .to.emit(gaugeUpkeepManager, 'GaugeRegistered')
        .withArgs(gaugeAddresses[1])
        .to.emit(gaugeUpkeepManager, 'GaugeRegistered')
        .withArgs(gaugeAddresses[2])
    })

    it('should deregister gauge upkeeps in bulk', async () => {
      const gaugeAddresses = [
        accounts[1].address,
        accounts[2].address,
        accounts[3].address,
      ]

      await gaugeUpkeepManager.registerGauges(gaugeAddresses)

      const tx = await gaugeUpkeepManager.deregisterGauges(gaugeAddresses)

      await expect(tx)
        .to.emit(gaugeUpkeepManager, 'GaugeDeregistered')
        .withArgs(gaugeAddresses[0])
        .to.emit(gaugeUpkeepManager, 'GaugeDeregistered')
        .withArgs(gaugeAddresses[1])
        .to.emit(gaugeUpkeepManager, 'GaugeDeregistered')
        .withArgs(gaugeAddresses[2])
    })
  })

  describe('Misc', function () {
    it('should return the gauge count', async () => {
      await gaugeUpkeepManager.performUpkeep(registerPerformData)

      expect(await gaugeUpkeepManager.gaugeCount()).to.equal(1)
    })

    it('should return a range of gauges', async () => {
      const bulkFakeGaugeAddresses = Array.from(
        { length: 5 },
        () => ethers.Wallet.createRandom().address,
      )
      await gaugeUpkeepManager.registerGauges(bulkFakeGaugeAddresses)

      const gauges = await gaugeUpkeepManager.gaugeList(0, 5)

      expect(gauges).to.have.lengthOf(5)
      expect(gauges).to.include.members(bulkFakeGaugeAddresses)
    })
  })
})
