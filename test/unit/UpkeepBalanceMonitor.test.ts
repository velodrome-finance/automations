import { expect } from 'chai'
import { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { mine } from '@nomicfoundation/hardhat-network-helpers'
import { matchSet } from '../utils'
import {
  IERC20,
  KeeperRegistryMock,
  UpkeepBalanceMonitor,
} from '../../typechain-types'

describe('UpkeepBalanceMonitor Unit Tests', function () {
  let upkeepBalanceMonitor: UpkeepBalanceMonitor
  let linkToken: IERC20
  let keeperRegistryMock: KeeperRegistryMock
  let accounts: SignerWithAddress[]

  const upkeepCount = 10

  const defaultConfig = {
    maxBatchSize: 10,
    minPercentage: 120,
    targetPercentage: 300,
    maxTopUpAmount: ethers.utils.parseEther('10'),
    maxIterations: 2,
  }

  beforeEach(async function () {
    accounts = await ethers.getSigners()

    // deploy link token
    const erc20MintableFactory =
      await ethers.getContractFactory('ERC20Mintable')
    linkToken = await erc20MintableFactory.deploy()

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
      defaultConfig,
    )

    // add upkeeps to the watch list
    for (let i = 0; i < upkeepCount; i++) {
      await upkeepBalanceMonitor.addToWatchList(i)
    }

    // transfer funds to upkeep balance monitor
    await linkToken.transfer(
      upkeepBalanceMonitor.address,
      ethers.utils.parseEther('10'),
    )
  })

  it('should iterate within the max iterations limit', async function () {
    // sanity check
    expect(defaultConfig.maxBatchSize).to.be.gte(defaultConfig.maxIterations)

    const [underfundedUpkeepIds] =
      await upkeepBalanceMonitor.getUnderfundedUpkeeps()

    expect(underfundedUpkeepIds.length).to.equal(defaultConfig.maxIterations)

    // mine a block to change the block number and start index
    await mine(1)

    const [underfundedUpkeepIds2] =
      await upkeepBalanceMonitor.getUnderfundedUpkeeps()

    expect(underfundedUpkeepIds2.length).to.equal(defaultConfig.maxIterations)
  })

  it('should cycle through all upkeeps in multiple iterations', async function () {
    const checkedUpkeepIds = new Set<number>()
    const allUpkeepIds = new Set<number>(
      Array.from({ length: upkeepCount }, (_, i) => i),
    )

    while (!matchSet(checkedUpkeepIds, allUpkeepIds)) {
      const [underfundedUpkeepIds] =
        await upkeepBalanceMonitor.getUnderfundedUpkeeps()

      underfundedUpkeepIds.forEach(async (upkeepId) => {
        checkedUpkeepIds.add(upkeepId.toNumber())
      })

      await mine(1)
    }

    const matching = matchSet(checkedUpkeepIds, allUpkeepIds)

    expect(matching).to.be.true
  })
})
