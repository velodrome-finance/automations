import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import {
  impersonateAccount,
  stopImpersonatingAccount,
} from '@nomicfoundation/hardhat-network-helpers'
import { findLog } from '../utils'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  Voter,
  GaugeUpkeepManager,
  IKeeperRegistryMaster,
  IERC20,
  UpkeepBalanceMonitor,
} from '../../typechain-types'
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
} from '../constants'

const { HashZero } = ethers.constants

let snapshotId: any

describe('UpkeepBalanceMonitor Script Tests', function () {
  let accounts: SignerWithAddress[]
  let upkeepBalanceMonitor: UpkeepBalanceMonitor
  let gaugeUpkeepManager: GaugeUpkeepManager
  let voter: Voter
  let keeperRegistry: IKeeperRegistryMaster
  let linkToken: IERC20
  let gaugeAddress: string

  before(async function () {
    accounts = await ethers.getSigners()
    // take a snapshot at the start
    snapshotId = await network.provider.send('evm_snapshot')
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
      ethers.utils.parseEther('10'),
    )
    // deploy upkeep balance monitor
    const upkeepBalanceMonitorFactory = await ethers.getContractFactory(
      'UpkeepBalanceMonitor',
    )
    upkeepBalanceMonitor = await upkeepBalanceMonitorFactory.deploy(
      gaugeUpkeepManager.address,
      {
        maxBatchSize: 10,
        minPercentage: 120,
        targetPercentage: 300,
        maxTopUpAmount: ethers.utils.parseEther('10'),
      },
    )
    // transfer link tokens to upkeep balance monitor
    await linkToken.transfer(
      upkeepBalanceMonitor.address,
      ethers.utils.parseEther('10'),
    )
  })

  after(async function () {
    // revert to the initial snapshot
    await network.provider.send('evm_revert', [snapshotId])
  })

  it('Gauge upkeep balance top-up flow', async function () {
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

    // set new upkeep fund amount to be lower than the minimum percentage
    await gaugeUpkeepManager.setNewUpkeepFundAmount(
      ethers.utils.parseEther('1'),
    )

    // register gauge upkeep via gauge upkeep manager
    await gaugeUpkeepManager.registerGaugeUpkeeps([gaugeAddress])
    const [underfundedUpkeepsBefore] =
      await upkeepBalanceMonitor.callStatic.getUnderfundedUpkeeps()

    expect(underfundedUpkeepsBefore.length).to.equal(1)

    // upkeep should be triggered
    const checkUpkeepResult =
      await upkeepBalanceMonitor.callStatic.checkUpkeep(HashZero)

    expect(checkUpkeepResult.upkeepNeeded).to.be.true

    // perform upkeep with check data
    await upkeepBalanceMonitor.performUpkeep(checkUpkeepResult.performData)

    const [underfundedUpkeepsAfter] =
      await upkeepBalanceMonitor.callStatic.getUnderfundedUpkeeps()

    expect(underfundedUpkeepsAfter.length).to.equal(0)
  })
})
