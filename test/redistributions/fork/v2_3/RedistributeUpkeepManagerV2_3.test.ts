import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import {
  time,
  impersonateAccount,
  stopImpersonatingAccount,
  mine,
} from '@nomicfoundation/hardhat-network-helpers'
import { findLog, getNextEpochUTC } from '../../../utils'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  Voter,
  RedistributeUpkeepManagerV2_3,
  AutomationRegistrar2_3,
  IAutomationRegistryMaster2_3,
  IERC20,
} from '../../../../typechain-types'
import {
  UPKEEP_CANCELLATION_DELAY,
  MAX_UINT32,
  PerformAction,
} from '../../../constants'

// Base Mainnet Addresses
const AUTOMATION_REGISTRAR_ADDRESS =
  '0xE28Adc50c7551CFf69FCF32D45d037e5F6554264'
const KEEPER_REGISTRY_ADDRESS = '0xf4bAb6A129164aBa9B113cB96BA4266dF49f8743'
const LINK_TOKEN_ADDRESS = '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196'
const VOTER_ADDRESS = '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5'
const EXCLUDED_GAUGE_FACTORIES = [
  '0x42e403b73898320f23109708b0ba1Ae85838C445',
  '0xeAD23f606643E387a073D0EE8718602291ffaAeB',
]
const POOL_FACTORY_ADDRESS = '0x420dd381b31aef6683db6b902084cb0ffece40da'
const POOL_ADDRESS = '0x81ebea20ea6acb544c0511e1ed9d6835d8532ed6'
const LINK_HOLDER_ADDRESS = '0xdf812b91d8bf6df698bfd1d8047839479ba63420'

const { AddressZero, HashZero, MaxUint256 } = ethers.constants

async function simulatePerformUpkeep(
  keeperRegistry: IAutomationRegistryMaster2_3,
  upkeepId: BigNumber,
  performData: string,
) {
  await impersonateAccount(AddressZero)
  const zeroSigner = await ethers.getSigner(AddressZero)
  const performTx =
    await keeperRegistry.populateTransaction.simulatePerformUpkeep(
      upkeepId,
      performData,
    )
  const performResultTx = await zeroSigner.sendTransaction({
    ...performTx,
    from: AddressZero,
  })
  await stopImpersonatingAccount(AddressZero)
  const performReceipt = await performResultTx.wait()
  return { tx: performResultTx, receipt: performReceipt }
}

async function registerLogTriggerUpkeep(
  automationRegistrar: AutomationRegistrar2_3,
  eventSignature: string,
  voterAddress: string,
  redistributeUpkeepManagerAddress: string,
) {
  const triggerConfig = ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint8', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
    [
      voterAddress,
      '000', // no topic filters
      eventSignature,
      HashZero,
      HashZero,
      HashZero,
    ],
  )
  const registerTx = await automationRegistrar.registerUpkeep({
    name: 'LogTriggerUpkeep',
    encryptedEmail: '0x',
    upkeepContract: redistributeUpkeepManagerAddress,
    gasLimit: 5_000_000,
    adminAddress: redistributeUpkeepManagerAddress,
    triggerType: 1,
    checkData: '0x',
    triggerConfig,
    offchainConfig: '0x',
    amount: ethers.utils.parseEther('10'),
    billingToken: LINK_TOKEN_ADDRESS,
  })
  const registerReceipt = await registerTx.wait()

  const registrationApprovedLog = findLog(
    registerReceipt,
    automationRegistrar.interface.getEventTopic('RegistrationApproved'),
  )
  const logUpkeepId = automationRegistrar.interface.parseLog(
    registrationApprovedLog,
  ).args.upkeepId

  return ethers.BigNumber.from(logUpkeepId)
}

let snapshotId: any

describe('RedistributeUpkeepManagerV2_3 Script Tests', function () {
  let accounts: SignerWithAddress[]
  let redistributeUpkeepManager: RedistributeUpkeepManagerV2_3
  let voter: Voter
  let keeperRegistry: IAutomationRegistryMaster2_3
  let linkToken: IERC20
  let createGaugeLogUpkeepId: BigNumber
  let killGaugeLogUpkeepId: BigNumber
  let reviveGaugeLogUpkeepId: BigNumber
  let redistributeUpkeepId: BigNumber
  let gaugeAddress: string
  let redistributeUpkeepAddress: string

  const batchSize = 5
  const newUpkeepGasLimit = 1e6
  const newUpkeepFundAmount = ethers.utils.parseEther('1')

  before(async function () {
    accounts = await ethers.getSigners()
    // take a snapshot at the start
    snapshotId = await network.provider.send('evm_snapshot')
    // setup link token contract
    linkToken = await ethers.getContractAt('ERC20Mintable', LINK_TOKEN_ADDRESS)
    // setup automation registrar contract
    const automationRegistrar = await ethers.getContractAt(
      'AutomationRegistrar2_3',
      AUTOMATION_REGISTRAR_ADDRESS,
    )
    // setup keeper registry contract
    keeperRegistry = await ethers.getContractAt(
      'IAutomationRegistryMaster2_3',
      KEEPER_REGISTRY_ADDRESS,
    )
    // setup voter contract
    voter = await ethers.getContractAt('Voter', VOTER_ADDRESS)
    // deploy upkeep balance monitor
    const upkeepBalanceMonitorFactory = await ethers.getContractFactory(
      'UpkeepBalanceMonitorV2_3',
    )
    const upkeepBalanceMonitor = await upkeepBalanceMonitorFactory.deploy(
      linkToken.address,
      keeperRegistry.address,
      {
        maxBatchSize: 10,
        minPercentage: 120,
        targetPercentage: 300,
        maxTopUpAmount: ethers.utils.parseEther('10'),
        maxIterations: 10,
      },
    )
    // setup redistribute upkeep manager
    const redistributeUpkeepManagerFactory = await ethers.getContractFactory(
      'RedistributeUpkeepManagerV2_3',
    )
    redistributeUpkeepManager = await redistributeUpkeepManagerFactory.deploy(
      linkToken.address,
      keeperRegistry.address,
      automationRegistrar.address,
      upkeepBalanceMonitor.address,
      voter.address,
      newUpkeepFundAmount,
      newUpkeepGasLimit,
      batchSize,
      EXCLUDED_GAUGE_FACTORIES,
    )
    // set redistribute upkeep manager as watch list manager in balance monitor
    await upkeepBalanceMonitor.grantWatchlistManagerRole(
      redistributeUpkeepManager.address,
    )
    // transfer link tokens to deployer
    await impersonateAccount(LINK_HOLDER_ADDRESS)
    const linkHolderSigner = await ethers.getSigner(LINK_HOLDER_ADDRESS)
    const transferLinkTx = await linkToken.populateTransaction.transfer(
      accounts[0].address,
      ethers.utils.parseEther('100'),
    )
    await linkHolderSigner.sendTransaction({
      ...transferLinkTx,
      from: LINK_HOLDER_ADDRESS,
    })
    await stopImpersonatingAccount(LINK_HOLDER_ADDRESS)
    // transfer link tokens to redistribute upkeep manager
    await linkToken.transfer(
      redistributeUpkeepManager.address,
      ethers.utils.parseEther('50'),
    )
    // transfer link tokens to upkeep balance monitor
    await linkToken.transfer(
      upkeepBalanceMonitor.address,
      ethers.utils.parseEther('10'),
    )
    // impersonate automation registrar owner and set auto approve for log trigger type
    const automationRegistrarOwner = await automationRegistrar.owner()
    await accounts[0].sendTransaction({
      to: automationRegistrarOwner,
      value: ethers.utils.parseEther('1'),
    })
    await impersonateAccount(automationRegistrarOwner)
    const automationRegistrarOwnerSigner = await ethers.getSigner(
      automationRegistrarOwner,
    )
    const setAutoApproveTx =
      await automationRegistrar.populateTransaction.setTriggerConfig(
        1, // log triggerType
        2, // approve all
        10000, // auto approve max allowed
      )
    await automationRegistrarOwnerSigner.sendTransaction({
      ...setAutoApproveTx,
      from: automationRegistrarOwner,
    })
    await stopImpersonatingAccount(automationRegistrarOwner)
    // register upkeep triggers
    await linkToken.approve(automationRegistrar.address, MaxUint256)
    createGaugeLogUpkeepId = await registerLogTriggerUpkeep(
      automationRegistrar,
      voter.interface.getEventTopic('GaugeCreated'),
      voter.address,
      redistributeUpkeepManager.address,
    )
    killGaugeLogUpkeepId = await registerLogTriggerUpkeep(
      automationRegistrar,
      voter.interface.getEventTopic('GaugeKilled'),
      voter.address,
      redistributeUpkeepManager.address,
    )
    reviveGaugeLogUpkeepId = await registerLogTriggerUpkeep(
      automationRegistrar,
      voter.interface.getEventTopic('GaugeRevived'),
      voter.address,
      redistributeUpkeepManager.address,
    )
    // get trusted forwarder addresses of all upkeeps and set them in redistribute upkeep manager
    const forwarders = await Promise.all([
      keeperRegistry.getForwarder(createGaugeLogUpkeepId),
      keeperRegistry.getForwarder(killGaugeLogUpkeepId),
      keeperRegistry.getForwarder(reviveGaugeLogUpkeepId),
    ])
    for (const forwarder of forwarders) {
      await redistributeUpkeepManager.setTrustedForwarder(forwarder, true)
    }
  })

  after(async function () {
    // revert to the initial snapshot
    await network.provider.send('evm_revert', [snapshotId])
  })

  it('Redistribute upkeep registration flow', async () => {
    // create gauge via voter
    const voterGovernor = await voter.governor()
    await accounts[0].sendTransaction({
      to: voterGovernor,
      value: ethers.utils.parseEther('1'),
    })
    await impersonateAccount(voterGovernor)
    const voterSigner = await ethers.getSigner(voterGovernor)
    const createGaugeTx = await voter.populateTransaction.createGauge(
      POOL_FACTORY_ADDRESS,
      POOL_ADDRESS,
    )
    const resultTx = await voterSigner.sendTransaction({
      ...createGaugeTx,
      from: voterGovernor,
    })
    await stopImpersonatingAccount(voterGovernor)
    const resultReceipt = await resultTx.wait()
    const gaugeCreatedLog = findLog(
      resultReceipt,
      voter.interface.getEventTopic('GaugeCreated'),
    )
    gaugeAddress = voter.interface.parseLog(gaugeCreatedLog).args.gauge

    expect(gaugeAddress).to.exist

    // checkLog should return correct perform data on GaugeCreated event
    const triggerLog = {
      index: gaugeCreatedLog.transactionIndex,
      txHash: gaugeCreatedLog.transactionHash,
      blockNumber: gaugeCreatedLog.blockNumber,
      blockHash: gaugeCreatedLog.blockHash,
      timestamp: 0,
      source: voter.address,
      topics: gaugeCreatedLog.topics,
      data: gaugeCreatedLog.data,
    }
    const checkLogResult = await redistributeUpkeepManager.callStatic.checkLog(
      triggerLog,
      HashZero,
    )

    expect(checkLogResult.upkeepNeeded).to.be.true
    expect(checkLogResult.performData).to.equal(
      ethers.utils.defaultAbiCoder.encode(
        ['uint8', 'address'],
        [PerformAction.RegisterGauge, gaugeAddress],
      ),
    )

    // call performUpkeep with register perform data via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      createGaugeLogUpkeepId,
      checkLogResult.performData,
    )

    // check if gauge is registered
    const gaugeRegisteredLog = findLog(
      performReceipt,
      redistributeUpkeepManager.interface.getEventTopic('GaugeRegistered'),
    )
    const { gauge: registeredGauge } =
      redistributeUpkeepManager.interface.parseLog(gaugeRegisteredLog).args

    expect(registeredGauge).to.equal(gaugeAddress)
    expect(await redistributeUpkeepManager.gaugeList(0, 1)).to.include(
      gaugeAddress,
    )

    // check if redistribute upkeep is registered
    const redistributeUpkeepCreatedLog = findLog(
      performReceipt,
      redistributeUpkeepManager.interface.getEventTopic(
        'RedistributeUpkeepRegistered',
      ),
    )
    const { redistributeUpkeep, upkeepId } =
      redistributeUpkeepManager.interface.parseLog(
        redistributeUpkeepCreatedLog,
      ).args

    expect(redistributeUpkeep).to.be.properAddress
    expect(await redistributeUpkeepManager.upkeepIds(0)).to.equal(upkeepId)

    // set redistribute upkeep address and id
    redistributeUpkeepAddress = redistributeUpkeep
    redistributeUpkeepId = upkeepId
  })

  it('Redistribute upkeep execution flow', async () => {
    // attach to redistribute upkeep contract
    const redistributeUpkeep = await ethers.getContractAt(
      'RedistributeUpkeep',
      redistributeUpkeepAddress,
    )

    // get latest block timestamp
    const latestBlockTimestamp = await time.latest()
    const latestDate = new Date(latestBlockTimestamp * 1000)

    // redistribute upkeep should not be needed before epoch time
    const beforeEpochFlip = getNextEpochUTC(latestDate).getTime() / 1000 - 100
    await time.increaseTo(beforeEpochFlip)

    const [redistributeUpkeepNeeded, redistributeUpkeepPerformData] =
      await redistributeUpkeep.callStatic.checkUpkeep(HashZero)

    expect(redistributeUpkeepNeeded).to.be.false
    expect(redistributeUpkeepPerformData).to.equal('0x')

    // redistribute upkeep should be needed after epoch time
    const afterEpochFlip = getNextEpochUTC(latestDate).getTime() / 1000
    await time.increaseTo(afterEpochFlip)

    const [redistributeUpkeepNeededAfter, redistributeUpkeepPerformDataAfter] =
      await redistributeUpkeep.callStatic.checkUpkeep(HashZero)

    expect(redistributeUpkeepNeededAfter).to.be.true
    expect(redistributeUpkeepPerformDataAfter).to.equal('0x')

    // perform redistribute upkeep via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      redistributeUpkeepId,
      redistributeUpkeepPerformDataAfter,
    )

    // check if redistribute upkeep is successfully executed
    const upkeepPerformedLog = findLog(
      performReceipt,
      redistributeUpkeep.interface.getEventTopic('RedistributeUpkeepPerformed'),
    )
    expect(upkeepPerformedLog).to.exist
  })

  it('Redistribute upkeep cancellation flow', async () => {
    // impersonate voter emergency council and kill gauge
    const voterEmergencyCouncil = await voter.emergencyCouncil()
    await accounts[0].sendTransaction({
      to: voterEmergencyCouncil,
      value: ethers.utils.parseEther('1'),
    })
    await impersonateAccount(voterEmergencyCouncil)
    const emergencyCouncilOwnerSigner = await ethers.getSigner(
      voterEmergencyCouncil,
    )
    const killGaugeTx = await voter.populateTransaction.killGauge(gaugeAddress)
    const killResultTx = await emergencyCouncilOwnerSigner.sendTransaction({
      ...killGaugeTx,
      from: voterEmergencyCouncil,
    })
    await stopImpersonatingAccount(voterEmergencyCouncil)
    const killResultReceipt = await killResultTx.wait()
    const gaugeKilledLog = findLog(
      killResultReceipt,
      voter.interface.getEventTopic('GaugeKilled'),
    )
    const { gauge: killedGauge } = voter.interface.parseLog(gaugeKilledLog).args

    expect(killedGauge).to.equal(gaugeAddress)

    // checkLog should return correct perform data for GaugeKilled event
    const triggerLog = {
      index: gaugeKilledLog.transactionIndex,
      txHash: gaugeKilledLog.transactionHash,
      blockNumber: gaugeKilledLog.blockNumber,
      blockHash: gaugeKilledLog.blockHash,
      timestamp: 0,
      source: voter.address,
      topics: gaugeKilledLog.topics,
      data: gaugeKilledLog.data,
    }
    const checkLogResult = await redistributeUpkeepManager.callStatic.checkLog(
      triggerLog,
      HashZero,
    )

    expect(checkLogResult.upkeepNeeded).to.be.true
    expect(checkLogResult.performData).to.equal(
      ethers.utils.defaultAbiCoder.encode(
        ['uint8', 'address'],
        [PerformAction.DeregisterGauge, gaugeAddress],
      ),
    )

    // check if redistribute upkeep is active
    const upkeepDetailsBefore =
      await keeperRegistry.getUpkeep(redistributeUpkeepId)
    expect(upkeepDetailsBefore.maxValidBlocknumber).to.equal(MAX_UINT32)

    // call performUpkeep with cancel perform data via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      killGaugeLogUpkeepId,
      checkLogResult.performData,
    )

    // check if gauge is removed
    const gaugeDeregisteredLog = findLog(
      performReceipt,
      redistributeUpkeepManager.interface.getEventTopic('GaugeDeregistered'),
    )
    const { gauge: deregisteredGauge } =
      redistributeUpkeepManager.interface.parseLog(gaugeDeregisteredLog).args

    expect(deregisteredGauge).to.equal(gaugeAddress)
    expect(await redistributeUpkeepManager.gaugeList(0, 1)).to.not.include(
      gaugeAddress,
    )

    // check if redistribute upkeep is cancelled
    const redistributeUpkeepCancelledLog = findLog(
      performReceipt,
      redistributeUpkeepManager.interface.getEventTopic(
        'RedistributeUpkeepCancelled',
      ),
    )
    const { upkeepId: cancelledUpkeepId } =
      redistributeUpkeepManager.interface.parseLog(
        redistributeUpkeepCancelledLog,
      ).args
    const upkeepDetailsAfter =
      await keeperRegistry.getUpkeep(redistributeUpkeepId)

    expect(cancelledUpkeepId).to.equal(redistributeUpkeepId)
    expect(upkeepDetailsAfter.maxValidBlocknumber).to.not.equal(MAX_UINT32)

    // check if upkeep is included in cancelledUpkeeps set
    expect(
      await redistributeUpkeepManager.cancelledUpkeeps(0, 1),
    ).to.deep.include(cancelledUpkeepId)
  })

  it('Redistribute upkeep withdrawal flow', async () => {
    // wait for cancellation delay after upkeep is cancelled so that it can be withdrawn
    await mine(UPKEEP_CANCELLATION_DELAY)

    const redistributeUpkeepManagerBalanceBefore = await linkToken.balanceOf(
      redistributeUpkeepManager.address,
    )
    const upkeepDetailsBefore =
      await keeperRegistry.getUpkeep(redistributeUpkeepId)

    // withdraw upkeep balance via RedistributeUpkeepManager
    const withdrawTx = await redistributeUpkeepManager.withdrawCancelledUpkeeps(
      0,
      1,
    )
    const withdrawReceipt = await withdrawTx.wait()

    // check if redistribute upkeep is withdrawn
    const redistributeUpkeepWithdrawnLog = findLog(
      withdrawReceipt,
      redistributeUpkeepManager.interface.getEventTopic(
        'RedistributeUpkeepWithdrawn',
      ),
    )
    const { upkeepId: withdrawnUpkeepId } =
      redistributeUpkeepManager.interface.parseLog(
        redistributeUpkeepWithdrawnLog,
      ).args
    const redistributeUpkeepManagerBalanceAfter = await linkToken.balanceOf(
      redistributeUpkeepManager.address,
    )

    expect(withdrawnUpkeepId).to.equal(redistributeUpkeepId)
    expect(redistributeUpkeepManagerBalanceAfter).to.equal(
      redistributeUpkeepManagerBalanceBefore.add(upkeepDetailsBefore.balance),
    )
  })

  it('Redistribute upkeep revival flow', async () => {
    // impersonate voter emergency council and revive gauge
    const voterEmergencyCouncil = await voter.emergencyCouncil()
    await accounts[0].sendTransaction({
      to: voterEmergencyCouncil,
      value: ethers.utils.parseEther('1'),
    })
    await impersonateAccount(voterEmergencyCouncil)
    const emergencyCouncilOwnerSigner = await ethers.getSigner(
      voterEmergencyCouncil,
    )
    const reviveGaugeTx =
      await voter.populateTransaction.reviveGauge(gaugeAddress)
    const reviveResultTx = await emergencyCouncilOwnerSigner.sendTransaction({
      ...reviveGaugeTx,
      from: voterEmergencyCouncil,
    })
    await stopImpersonatingAccount(voterEmergencyCouncil)
    const reviveResultReceipt = await reviveResultTx.wait()
    const gaugeRevivedLog = findLog(
      reviveResultReceipt,
      voter.interface.getEventTopic('GaugeRevived'),
    )
    const { gauge: revivedGauge } =
      voter.interface.parseLog(gaugeRevivedLog).args

    expect(revivedGauge).to.equal(gaugeAddress)

    // checkLog should return correct perform data for GaugeRevived event
    const triggerLog = {
      index: gaugeRevivedLog.transactionIndex,
      txHash: gaugeRevivedLog.transactionHash,
      blockNumber: gaugeRevivedLog.blockNumber,
      blockHash: gaugeRevivedLog.blockHash,
      timestamp: 0,
      source: voter.address,
      topics: gaugeRevivedLog.topics,
      data: gaugeRevivedLog.data,
    }
    const checkLogResult = await redistributeUpkeepManager.callStatic.checkLog(
      triggerLog,
      HashZero,
    )

    expect(checkLogResult.upkeepNeeded).to.be.true
    expect(checkLogResult.performData).to.equal(
      ethers.utils.defaultAbiCoder.encode(
        ['uint8', 'address'],
        [PerformAction.RegisterGauge, gaugeAddress],
      ),
    )

    // call performUpkeep with perform data via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      reviveGaugeLogUpkeepId,
      checkLogResult.performData,
    )

    // check if gauge is registered again
    const gaugeRegisteredLog = findLog(
      performReceipt,
      redistributeUpkeepManager.interface.getEventTopic('GaugeRegistered'),
    )
    const { gauge: registeredGauge } =
      redistributeUpkeepManager.interface.parseLog(gaugeRegisteredLog).args

    expect(registeredGauge).to.equal(gaugeAddress)
    expect(await redistributeUpkeepManager.gaugeList(0, 1)).to.include(
      gaugeAddress,
    )

    // check if redistribute upkeep is registered again
    const redistributeUpkeepCreatedLog = findLog(
      performReceipt,
      redistributeUpkeepManager.interface.getEventTopic(
        'RedistributeUpkeepRegistered',
      ),
    )
    const { redistributeUpkeep, upkeepId } =
      redistributeUpkeepManager.interface.parseLog(
        redistributeUpkeepCreatedLog,
      ).args

    expect(redistributeUpkeep).to.be.properAddress
    expect(await redistributeUpkeepManager.upkeepIds(0)).to.equal(upkeepId)
  })

  it('Withdraw contract LINK balance', async () => {
    const ownerBalanceBefore = await linkToken.balanceOf(accounts[0].address)
    const contractBalanceBefore = await linkToken.balanceOf(
      redistributeUpkeepManager.address,
    )
    await redistributeUpkeepManager.withdrawLinkBalance()
    const ownerBalanceAfter = await linkToken.balanceOf(accounts[0].address)
    const contractBalanceAfter = await linkToken.balanceOf(
      redistributeUpkeepManager.address,
    )

    expect(contractBalanceAfter).to.equal(0)
    expect(ownerBalanceAfter).to.equal(
      ownerBalanceBefore.add(contractBalanceBefore),
    )
  })
})
