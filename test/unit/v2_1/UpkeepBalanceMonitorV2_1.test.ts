import { expect } from 'chai'
import { ethers } from 'hardhat'
import { BigNumber } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { mine } from '@nomicfoundation/hardhat-network-helpers'
import { matchSet } from '../../utils'
import {
  IERC20,
  KeeperRegistryMock,
  UpkeepBalanceMonitorV2_1,
} from '../../../typechain-types'

describe('UpkeepBalanceMonitorV2_1 Unit Tests', function () {
  let upkeepBalanceMonitor: UpkeepBalanceMonitorV2_1
  let linkToken: IERC20
  let keeperRegistryMock: KeeperRegistryMock
  let accounts: SignerWithAddress[]
  let upkeepIds: number[]

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
      'UpkeepBalanceMonitorV2_1',
    )
    upkeepBalanceMonitor = await upkeepBalanceMonitorFactory.deploy(
      linkToken.address,
      keeperRegistryMock.address,
      defaultConfig,
    )

    upkeepIds = Array.from({ length: upkeepCount }, (_, i) => i + 1)

    // add upkeeps to the watch list
    await upkeepBalanceMonitor.addMultipleToWatchList(upkeepIds)

    // set balances and min balances for upkeeps
    for (let i = 1; i <= upkeepCount; i++) {
      await keeperRegistryMock.setBalance(i, ethers.utils.parseEther('1'))
      await keeperRegistryMock.setMinBalance(i, ethers.utils.parseEther('2'))
    }

    // transfer funds to upkeep balance monitor
    await linkToken.transfer(
      upkeepBalanceMonitor.address,
      ethers.utils.parseEther('10'),
    )
  })

  describe('Get underfunded upkeeps', function () {
    it('should not revert if upkeepBalance is greater than target balance', async function () {
      const upkeepId = 1
      const minBalance = ethers.utils.parseEther('1')
      const upkeepBalance = ethers.utils.parseEther('5') // greater than target balance

      await keeperRegistryMock.setMinBalance(upkeepId, minBalance)
      await keeperRegistryMock.setBalance(upkeepId, upkeepBalance)

      const [underfundedUpkeepIds, topUpAmounts] =
        await upkeepBalanceMonitor.getUnderfundedUpkeeps()

      expect(underfundedUpkeepIds).to.not.include(upkeepId)
      expect(topUpAmounts).to.not.include(ethers.utils.parseEther('0.5'))
    })

    it('should not return more than maxBatchSize upkeep ids', async function () {
      await upkeepBalanceMonitor.setConfig({
        ...defaultConfig,
        maxBatchSize: 1,
      })

      const [underfundedUpkeepIds] =
        await upkeepBalanceMonitor.getUnderfundedUpkeeps()

      expect(underfundedUpkeepIds.length).to.eq(1)
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
      const allUpkeepIds = new Set<number>(upkeepIds)

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

  describe('Watch list', function () {
    it('should retrieve watch list', async function () {
      const watchList = await upkeepBalanceMonitor.getWatchList()

      expect(watchList.length).to.equal(upkeepCount)
    })

    it('should add to watch list', async function () {
      const newUpkeepId = upkeepCount + 1

      await upkeepBalanceMonitor.addToWatchList(newUpkeepId)

      const watchList = await upkeepBalanceMonitor.getWatchList()

      expect(watchList.length).to.equal(upkeepCount + 1)
      expect(watchList).to.deep.include(BigNumber.from(newUpkeepId))
    })

    it('should remove from watch list', async function () {
      const upkeepIdToRemove = 1

      await upkeepBalanceMonitor.removeFromWatchList(upkeepIdToRemove)

      const watchList = await upkeepBalanceMonitor.getWatchList()

      expect(watchList.length).to.equal(upkeepCount - 1)
      expect(watchList).to.not.deep.include(BigNumber.from(upkeepIdToRemove))
    })

    it('should return the length of the watchlist', async function () {
      expect(
        (await upkeepBalanceMonitor.getWatchListLength()).toNumber(),
      ).to.equal(upkeepCount)
    })

    it('should return the item from the watchlist by index', async function () {
      for (let i = 0; i < upkeepCount; i++) {
        expect(
          (await upkeepBalanceMonitor.getWatchListItem(i)).toNumber(),
        ).to.equal(i + 1)
      }
    })
  })
})
