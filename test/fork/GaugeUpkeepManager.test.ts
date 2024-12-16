import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  time,
  impersonateAccount,
  stopImpersonatingAccount,
  mine,
} from '@nomicfoundation/hardhat-network-helpers'
import { findLog, getNextEpochUTC } from '../utils'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  Voter,
  GaugeUpkeepManager,
  AutomationRegistrar2_1,
  IKeeperRegistryMaster,
  IERC20,
} from '../../typechain-types'
import {
  CronUpkeepFactoryAbi,
  CronUpkeepAbi,
  EmergencyCouncilAbi,
} from '../abi'
import {
  AUTOMATION_REGISTRAR_ADDRESS,
  KEEPER_REGISTRY_ADDRESS,
  LINK_TOKEN_ADDRESS,
  VOTER_ADDRESS,
  CROSSCHAIN_GAUGE_FACTORIES,
  NEW_UPKEEP_FUND_AMOUNT,
  NEW_UPKEEP_GAS_LIMIT,
  POOL_FACTORY_ADDRESS,
  POOL_ADDRESS,
  LINK_HOLDER_ADDRESS,
  UPKEEP_CANCELLATION_DELAY,
  MAX_UINT32,
  PerformAction,
} from '../constants'

const { AddressZero, HashZero, MaxUint256 } = ethers.constants

async function simulatePerformUpkeep(
  keeperRegistry: IKeeperRegistryMaster,
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
  automationRegistrar: AutomationRegistrar2_1,
  eventSignature: string,
  voterAddress: string,
  gaugeUpkeepManagerAddress: string,
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
    upkeepContract: gaugeUpkeepManagerAddress,
    gasLimit: 5_000_000,
    adminAddress: gaugeUpkeepManagerAddress,
    triggerType: 1,
    checkData: '0x',
    triggerConfig,
    offchainConfig: '0x',
    amount: ethers.utils.parseEther('10'),
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

describe('GaugeUpkeepManager Script Tests', function () {
  let accounts: SignerWithAddress[]
  let gaugeUpkeepManager: GaugeUpkeepManager
  let voter: Voter
  let keeperRegistry: IKeeperRegistryMaster
  let linkToken: IERC20
  let createGaugeLogUpkeepId: BigNumber
  let killGaugeLogUpkeepId: BigNumber
  let reviveGaugeLogUpkeepId: BigNumber
  let gaugeUpkeepId: BigNumber
  let gaugeAddress: string
  let cronUpkeepAddress: string

  before(async function () {
    accounts = await ethers.getSigners()
    // setup link token contract
    linkToken = await ethers.getContractAt('ERC20Mintable', LINK_TOKEN_ADDRESS)
    // setup automation registrar contract
    const automationRegistrar = await ethers.getContractAt(
      'AutomationRegistrar2_1',
      AUTOMATION_REGISTRAR_ADDRESS,
    )
    // setup keeper registry contract
    keeperRegistry = await ethers.getContractAt(
      'IKeeperRegistryMaster',
      KEEPER_REGISTRY_ADDRESS,
    )
    // setup voter contract
    voter = await ethers.getContractAt('Voter', VOTER_ADDRESS)
    // setup cron library
    const cronLibraryFactory = await ethers.getContractFactory(
      '@chainlink/contracts/src/v0.8/automation/libraries/external/Cron.sol:Cron',
    )
    const cronLibrary = await cronLibraryFactory.deploy()
    // setup cron upkeep factory
    const CronUpkeepFactory = await ethers.getContractFactory(
      'CronUpkeepFactory',
      {
        libraries: {
          Cron: cronLibrary.address,
        },
      },
    )
    const cronUpkeepFactory = await CronUpkeepFactory.deploy()
    // setup gauge upkeep manager
    const gaugeUpkeepManagerFactory =
      await ethers.getContractFactory('GaugeUpkeepManager')
    gaugeUpkeepManager = await gaugeUpkeepManagerFactory.deploy(
      linkToken.address,
      keeperRegistry.address,
      automationRegistrar.address,
      cronUpkeepFactory.address,
      voter.address,
      NEW_UPKEEP_FUND_AMOUNT,
      NEW_UPKEEP_GAS_LIMIT,
      CROSSCHAIN_GAUGE_FACTORIES.split(','),
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
    // transfer link tokens to gauge upkeep manager
    await linkToken.transfer(
      gaugeUpkeepManager.address,
      ethers.utils.parseEther('50'),
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
      gaugeUpkeepManager.address,
    )
    killGaugeLogUpkeepId = await registerLogTriggerUpkeep(
      automationRegistrar,
      voter.interface.getEventTopic('GaugeKilled'),
      voter.address,
      gaugeUpkeepManager.address,
    )
    reviveGaugeLogUpkeepId = await registerLogTriggerUpkeep(
      automationRegistrar,
      voter.interface.getEventTopic('GaugeRevived'),
      voter.address,
      gaugeUpkeepManager.address,
    )
    // get tursted forwarder addresses of all upkeeps and set them in gauge upkeep manager
    const forwarders = await Promise.all([
      keeperRegistry.getForwarder(createGaugeLogUpkeepId),
      keeperRegistry.getForwarder(killGaugeLogUpkeepId),
      keeperRegistry.getForwarder(reviveGaugeLogUpkeepId),
    ])
    for (const forwarder of forwarders) {
      await gaugeUpkeepManager.setTrustedForwarder(forwarder, true)
    }
  })

  it('Gauge upkeep registration flow', async () => {
    // create gauge via voter
    const voterGovernor = await voter.governor()
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
    const checkLogResult = await gaugeUpkeepManager.callStatic.checkLog(
      triggerLog,
      HashZero,
    )

    expect(checkLogResult.upkeepNeeded).to.be.true
    expect(checkLogResult.performData).to.equal(
      ethers.utils.defaultAbiCoder.encode(
        ['uint8', 'address'],
        [PerformAction.RegisterUpkeep, gaugeAddress],
      ),
    )

    // call performUpkeep with register perform data via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      createGaugeLogUpkeepId,
      checkLogResult.performData,
    )

    // check if gauge upkeep is registered
    const gaugeUpkeepCreatedLog = findLog(
      performReceipt,
      gaugeUpkeepManager.interface.getEventTopic('GaugeUpkeepRegistered'),
    )
    const { gauge, upkeepId } = gaugeUpkeepManager.interface.parseLog(
      gaugeUpkeepCreatedLog,
    ).args
    gaugeUpkeepId = await gaugeUpkeepManager.gaugeUpkeepId(gaugeAddress)

    expect(gauge).to.equal(gaugeAddress)
    expect(gaugeUpkeepId).to.equal(upkeepId)

    // get cron upkeep address from event
    const cronUpkeepFactoryIface = new ethers.utils.Interface(
      CronUpkeepFactoryAbi,
    )
    const cronUpkeepCreatedLog = findLog(
      performReceipt,
      cronUpkeepFactoryIface.getEventTopic('NewCronUpkeepCreated'),
    )
    cronUpkeepAddress =
      cronUpkeepFactoryIface.parseLog(cronUpkeepCreatedLog).args.upkeep
  })

  it('Gauge upkeep execution flow', async () => {
    // gauge upkeep should not be needed before epoch time
    const gaugeUpkeep = await ethers.getContractAt(
      'CronUpkeep',
      cronUpkeepAddress,
    )
    const [gaugeUpkeepNeeded, gaugeUpkeepPerformData] = await gaugeUpkeep
      .connect(AddressZero)
      .callStatic.checkUpkeep(HashZero)

    expect(gaugeUpkeepNeeded).to.be.false
    expect(gaugeUpkeepPerformData).to.equal('0x')

    // gauge upkeep should be needed after epoch time
    const timestamp = getNextEpochUTC().getTime() / 1000
    await time.increaseTo(timestamp)

    const [gaugeUpkeepNeededAfter, gaugeUpkeepPerformDataAfter] =
      await gaugeUpkeep.connect(AddressZero).callStatic.checkUpkeep(HashZero)

    expect(gaugeUpkeepNeededAfter).to.be.true
    expect(gaugeUpkeepPerformDataAfter).to.not.equal('0x')

    // perform gauge cron upkeep via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      gaugeUpkeepId,
      gaugeUpkeepPerformDataAfter,
    )

    // check if gauge upkeep is successfully executed
    const cronUpkeepIface = new ethers.utils.Interface(CronUpkeepAbi)
    const cronJobExecutedLog = findLog(
      performReceipt,
      cronUpkeepIface.getEventTopic('CronJobExecuted'),
    )
    const { success } = cronUpkeepIface.parseLog(cronJobExecutedLog!).args

    expect(success).to.be.true

    // todo: check if distribute is called on gauge
  })

  it('Gauge upkeep cancellation flow', async () => {
    // impersonate voter emergency council and kill gauge
    const voterEmergencyCouncil = await voter.emergencyCouncil()
    const emergencyCouncil = new ethers.Contract(
      voterEmergencyCouncil,
      EmergencyCouncilAbi,
      accounts[0],
    )
    const emergencyCouncilOwner = await emergencyCouncil.owner()
    await accounts[0].sendTransaction({
      to: emergencyCouncilOwner,
      value: ethers.utils.parseEther('1'),
    })
    await impersonateAccount(emergencyCouncilOwner)
    const emergencyCouncilOwnerSigner = await ethers.getSigner(
      emergencyCouncilOwner,
    )
    const killGaugeTx =
      await emergencyCouncil.populateTransaction.killRootGauge(gaugeAddress)
    const killResultTx = await emergencyCouncilOwnerSigner.sendTransaction({
      ...killGaugeTx,
      from: emergencyCouncilOwner,
    })
    await stopImpersonatingAccount(emergencyCouncilOwner)
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
    const checkLogResult = await gaugeUpkeepManager.callStatic.checkLog(
      triggerLog,
      HashZero,
    )

    expect(checkLogResult.upkeepNeeded).to.be.true
    expect(checkLogResult.performData).to.equal(
      ethers.utils.defaultAbiCoder.encode(
        ['uint8', 'address'],
        [PerformAction.CancelUpkeep, gaugeAddress],
      ),
    )

    // check if gauge upkeep is active
    const upkeepDetailsBefore = await keeperRegistry.getUpkeep(gaugeUpkeepId)
    expect(upkeepDetailsBefore.maxValidBlocknumber).to.equal(MAX_UINT32)

    // call performUpkeep with cancel perform data via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      killGaugeLogUpkeepId,
      checkLogResult.performData,
    )

    // check if gauge upkeep is cancelled
    const gaugeUpkeepCancelledLog = findLog(
      performReceipt,
      gaugeUpkeepManager.interface.getEventTopic('GaugeUpkeepCancelled'),
    )
    const { gauge: cancelledGauge, upkeepId: cancelledUpkeepId } =
      gaugeUpkeepManager.interface.parseLog(gaugeUpkeepCancelledLog).args
    const gaugeUpkeepIdAfter =
      await gaugeUpkeepManager.gaugeUpkeepId(gaugeAddress)
    const upkeepDetailsAfter = await keeperRegistry.getUpkeep(gaugeUpkeepId)

    expect(cancelledGauge).to.equal(gaugeAddress)
    expect(cancelledUpkeepId).to.equal(gaugeUpkeepId)
    expect(gaugeUpkeepIdAfter).to.equal(0)
    expect(upkeepDetailsAfter.maxValidBlocknumber).to.not.equal(MAX_UINT32)
  })

  it('Gauge upkeep withdrawal flow', async () => {
    // wait for cancellation delay after upkeep is cancelled so that it can be withdrawn
    await mine(UPKEEP_CANCELLATION_DELAY)

    const gaugeUpkeepManagerBalanceBefore = await linkToken.balanceOf(
      gaugeUpkeepManager.address,
    )
    const upkeepDetailsBefore = await keeperRegistry.getUpkeep(gaugeUpkeepId)

    // call withdrawGaugeUpkeep via GaugeUpkeepManager
    const withdrawTx = await gaugeUpkeepManager.withdrawUpkeep(gaugeUpkeepId)
    const withdrawReceipt = await withdrawTx.wait()

    // check if gauge upkeep is withdrawn
    const gaugeUpkeepWithdrawnLog = findLog(
      withdrawReceipt,
      gaugeUpkeepManager.interface.getEventTopic('GaugeUpkeepWithdrawn'),
    )
    const { upkeepId: withdrawnUpkeepId } =
      gaugeUpkeepManager.interface.parseLog(gaugeUpkeepWithdrawnLog).args
    const gaugeUpkeepManagerBalanceAfter = await linkToken.balanceOf(
      gaugeUpkeepManager.address,
    )

    expect(withdrawnUpkeepId).to.equal(gaugeUpkeepId)
    expect(gaugeUpkeepManagerBalanceAfter).to.equal(
      gaugeUpkeepManagerBalanceBefore.add(upkeepDetailsBefore.balance),
    )
  })

  it('Gauge upkeep revival flow', async () => {
    // impersonate voter emergency council and revive gauge
    const voterEmergencyCouncil = await voter.emergencyCouncil()
    const emergencyCouncil = new ethers.Contract(
      voterEmergencyCouncil,
      EmergencyCouncilAbi,
      accounts[0],
    )
    const emergencyCouncilOwner = await emergencyCouncil.owner()
    await accounts[0].sendTransaction({
      to: emergencyCouncilOwner,
      value: ethers.utils.parseEther('1'),
    })
    await impersonateAccount(emergencyCouncilOwner)
    const emergencyCouncilOwnerSigner = await ethers.getSigner(
      emergencyCouncilOwner,
    )
    const reviveGaugeTx =
      await emergencyCouncil.populateTransaction.reviveRootGauge(gaugeAddress)
    const reviveResultTx = await emergencyCouncilOwnerSigner.sendTransaction({
      ...reviveGaugeTx,
      from: emergencyCouncilOwner,
    })
    await stopImpersonatingAccount(emergencyCouncilOwner)
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
    const checkLogResult = await gaugeUpkeepManager.callStatic.checkLog(
      triggerLog,
      HashZero,
    )

    expect(checkLogResult.upkeepNeeded).to.be.true
    expect(checkLogResult.performData).to.equal(
      ethers.utils.defaultAbiCoder.encode(
        ['uint8', 'address'],
        [PerformAction.RegisterUpkeep, gaugeAddress],
      ),
    )

    // call performUpkeep with perform data via KeeperRegistry
    const { receipt: performReceipt } = await simulatePerformUpkeep(
      keeperRegistry,
      reviveGaugeLogUpkeepId,
      checkLogResult.performData,
    )

    // check if gauge upkeep is registered again
    const gaugeUpkeepCreatedLog = findLog(
      performReceipt,
      gaugeUpkeepManager.interface.getEventTopic('GaugeUpkeepRegistered'),
    )
    const { gauge, upkeepId } = gaugeUpkeepManager.interface.parseLog(
      gaugeUpkeepCreatedLog,
    ).args
    gaugeUpkeepId = await gaugeUpkeepManager.gaugeUpkeepId(gaugeAddress)

    expect(gauge).to.equal(gaugeAddress)
    expect(gaugeUpkeepId).to.equal(upkeepId)
  })

  it('Gauge upkeep transfer flow', async () => {
    await gaugeUpkeepManager.transferUpkeepAdmin(
      gaugeUpkeepId,
      accounts[0].address,
    )
    await keeperRegistry.acceptUpkeepAdmin(gaugeUpkeepId)
    const upkeepInfo = await keeperRegistry.getUpkeep(gaugeUpkeepId)

    expect(upkeepInfo.admin).to.equal(accounts[0].address)
  })

  it('Withdraw contract LINK balance', async () => {
    const ownerBalanceBefore = await linkToken.balanceOf(accounts[0].address)
    const contractBalanceBefore = await linkToken.balanceOf(
      gaugeUpkeepManager.address,
    )
    await gaugeUpkeepManager.withdrawLinkBalance()
    const ownerBalanceAfter = await linkToken.balanceOf(accounts[0].address)
    const contractBalanceAfter = await linkToken.balanceOf(
      gaugeUpkeepManager.address,
    )

    expect(contractBalanceAfter).to.equal(0)
    expect(ownerBalanceAfter).to.equal(
      ownerBalanceBefore.add(contractBalanceBefore),
    )
  })
})
