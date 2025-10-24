import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  RedistributeUpkeep,
  RedistributeUpkeep__factory,
  RedistributeUpkeepManagerMock,
  VoterMock,
} from '../../../typechain-types'
import { defaultAbiCoder } from '@ethersproject/abi'
import { getNextEpochUTC } from '../../utils'

const { AddressZero, HashZero } = ethers.constants

async function increaseTimeToNextEpoch() {
  const latestBlockTimestamp = await time.latest()
  const latestDate = new Date(latestBlockTimestamp * 1000)
  const afterEpochFlip = getNextEpochUTC(latestDate).getTime() / 1000
  await time.increaseTo(afterEpochFlip)
}

let snapshotId: any

describe('RedistributeUpkeep Unit Tests', function () {
  let redistributeUpkeepFactory: RedistributeUpkeep__factory
  let redistributeUpkeep: RedistributeUpkeep
  let voterMock: VoterMock
  let redistributeUpkeepManagerMock: RedistributeUpkeepManagerMock
  let gaugeList: string[]
  let accounts: SignerWithAddress[]

  const batchSize = 5
  const startIndex = 0
  const endIndex = 100
  const gaugeCount = 10
  const epochLengthInSeconds = 604800
  const iterationsCount = gaugeCount / batchSize

  beforeEach(async function () {
    accounts = await ethers.getSigners()

    // deploy voter mock
    const voterMockFactory = await ethers.getContractFactory('VoterMock')
    voterMock = await voterMockFactory.deploy(
      AddressZero,
      AddressZero,
      AddressZero,
    )

    // deploy redistribute upkeep manager mock
    const redistributeUpkeepManagerMockFactory =
      await ethers.getContractFactory('RedistributeUpkeepManagerMock')
    redistributeUpkeepManagerMock =
      await redistributeUpkeepManagerMockFactory.deploy()

    // set gauge list
    gaugeList = Array.from(
      { length: gaugeCount },
      () => ethers.Wallet.createRandom().address,
    )
    await redistributeUpkeepManagerMock.setGaugeList(gaugeList)

    // impersonate redistribute upkeep manager
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [redistributeUpkeepManagerMock.address],
    })
    const impersonatedSigner = ethers.provider.getSigner(
      redistributeUpkeepManagerMock.address,
    )
    await network.provider.send('hardhat_setBalance', [
      redistributeUpkeepManagerMock.address,
      '0xffffffffffffffff',
    ])

    // deploy redistribute upkeep
    redistributeUpkeepFactory = await ethers.getContractFactory(
      'RedistributeUpkeep',
      impersonatedSigner,
    )
    redistributeUpkeep = await redistributeUpkeepFactory.deploy(
      voterMock.address,
      startIndex,
      endIndex,
    )
  })

  before(async function () {
    // take a snapshot at the start
    snapshotId = await network.provider.send('evm_snapshot')
  })

  after(async function () {
    // revert to the initial snapshot
    await network.provider.send('evm_revert', [snapshotId])
  })

  describe('Before epoch flip', function () {
    before(async function () {
      const beforeEpochFlip = getNextEpochUTC().getTime() / 1000 - 100
      await time.increaseTo(beforeEpochFlip)
    })

    it('should not trigger upkeep', async function () {
      const [upkeepNeeded, performData] =
        await redistributeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })

    it('should not perform upkeep', async function () {
      await expect(
        redistributeUpkeep.performUpkeep(HashZero),
      ).to.be.revertedWithCustomError(redistributeUpkeep, 'UpkeepNotNeeded')
    })
  })

  describe('After epoch flip', function () {
    beforeEach(async function () {
      await increaseTimeToNextEpoch()
    })

    it('should trigger upkeep', async function () {
      const [upkeepNeeded, performData] =
        await redistributeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal('0x')
    })

    it('should perform upkeep', async function () {
      for (let i = 0; i < iterationsCount; i++) {
        await expect(redistributeUpkeep.performUpkeep(HashZero))
          .to.emit(redistributeUpkeep, 'RedistributeUpkeepPerformed')
          .withArgs(i * batchSize, i * batchSize + batchSize)
      }
    })

    it('should perform upkeep on an interval', async function () {
      for (let i = 0; i < iterationsCount; i++) {
        await expect(redistributeUpkeep.performUpkeep(HashZero))
          .to.emit(redistributeUpkeep, 'RedistributeUpkeepPerformed')
          .withArgs(i * batchSize, i * batchSize + batchSize)
      }

      await time.increase(epochLengthInSeconds)

      for (let i = 0; i < iterationsCount; i++) {
        await expect(redistributeUpkeep.performUpkeep(HashZero))
          .to.emit(redistributeUpkeep, 'RedistributeUpkeepPerformed')
          .withArgs(i * batchSize, i * batchSize + batchSize)
      }
    })

    it('should distribute all gauges', async function () {
      const distributedGauges: string[] = []
      for (let i = 0; i < iterationsCount; i++) {
        const tx = await redistributeUpkeep.performUpkeep(HashZero)
        const receipt = await tx.wait()
        const distributeLogs = receipt.logs.filter(
          (log) =>
            log.topics[0] === voterMock.interface.getEventTopic('Distributed'),
        )
        distributedGauges.push(
          ...distributeLogs.map((log) =>
            defaultAbiCoder.decode(['address'], log.topics[1]).toString(),
          ),
        )
      }
      expect(distributedGauges.length).to.equal(gaugeCount)
      expect(distributedGauges).to.have.members(gaugeList)
    })

    it('should perform upkeep correctly if gauge count is not a multiple of batch size', async function () {
      const newGaugeCount = 13
      const newGaugeList = Array.from(
        { length: newGaugeCount },
        () => ethers.Wallet.createRandom().address,
      )
      await redistributeUpkeepManagerMock.removeGaugeList()
      await redistributeUpkeepManagerMock.setGaugeList(newGaugeList)

      const newBatchSize = 3
      await redistributeUpkeepManagerMock.setBatchSize(newBatchSize)

      const newIterationsCount = Math.ceil(newGaugeCount / newBatchSize)

      const distributedGauges: string[] = []
      for (let i = 0; i < newIterationsCount; i++) {
        const startIdx = i * newBatchSize
        let endIdx = i * newBatchSize + newBatchSize
        endIdx = endIdx > newGaugeCount ? newGaugeCount : endIdx

        const tx = await redistributeUpkeep.performUpkeep(HashZero)
        await expect(tx)
          .to.emit(redistributeUpkeep, 'RedistributeUpkeepPerformed')
          .withArgs(startIdx, endIdx)

        const receipt = await tx.wait()
        const distributeLogs = receipt.logs.filter(
          (log) =>
            log.topics[0] === voterMock.interface.getEventTopic('Distributed'),
        )
        distributedGauges.push(
          ...distributeLogs.map((log) =>
            defaultAbiCoder.decode(['address'], log.topics[1]).toString(),
          ),
        )
      }
      expect(distributedGauges.length).to.equal(newGaugeCount)
      expect(distributedGauges).to.have.members(newGaugeList)
    })

    it('should not perform upkeep if all gauges are distributed', async function () {
      for (let i = 0; i < iterationsCount; i++) {
        await redistributeUpkeep.performUpkeep(HashZero)
      }

      await expect(
        redistributeUpkeep.performUpkeep(HashZero),
      ).to.be.revertedWithCustomError(redistributeUpkeep, 'UpkeepNotNeeded')

      const [upkeepNeeded, performData] =
        await redistributeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })

    it('should not perform upkeep if the gauge list is empty', async function () {
      await redistributeUpkeepManagerMock.removeGaugeList()

      const [upkeepNeeded, performData] =
        await redistributeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')

      await expect(
        redistributeUpkeep.performUpkeep(HashZero),
      ).to.be.revertedWithCustomError(redistributeUpkeep, 'UpkeepNotNeeded')
    })

    it('should not perform upkeep if outside of the range', async function () {
      const newStartIndex = gaugeCount
      const newEndIndex = gaugeCount * 2
      const newRedistributeUpkeep = await redistributeUpkeepFactory.deploy(
        voterMock.address,
        newStartIndex,
        newEndIndex,
      )
      await increaseTimeToNextEpoch()

      const [upkeepNeeded, performData] =
        await newRedistributeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')

      await expect(
        newRedistributeUpkeep.performUpkeep(HashZero),
      ).to.be.revertedWithCustomError(redistributeUpkeep, 'UpkeepNotNeeded')

      // add one gauge in the range
      gaugeList.push(ethers.Wallet.createRandom().address)
      await redistributeUpkeepManagerMock.setGaugeList(gaugeList)

      const [upkeepNeededAfter, performDataAfter] =
        await newRedistributeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeededAfter).to.be.true
      expect(performDataAfter).to.equal('0x')
    })

    it('should continue upkeep after entire batch fails', async function () {
      for (const gauge of gaugeList.slice(0, gaugeList.length / 2)) {
        await voterMock.setFailingGauge(gauge, true)
      }

      const tx = await expect(redistributeUpkeep.performUpkeep(HashZero))
      for (let i = 0; i < batchSize; i++) {
        await tx.to
          .emit(redistributeUpkeep, 'DistributeFailed')
          .withArgs(gaugeList[i], startIndex + i)
      }

      await expect(redistributeUpkeep.performUpkeep(HashZero))
        .to.emit(redistributeUpkeep, 'RedistributeUpkeepPerformed')
        .withArgs(batchSize, batchSize * 2)
    })

    it('should continue upkeep after batch partially fails', async function () {
      /// @dev Mock failed distributes
      const failedIndexes = [0, 3]
      for (const failedIndex of failedIndexes) {
        await voterMock.setFailingGauge(gaugeList[failedIndex], true)
      }

      /// @dev Ensure gauges on non-failing indexes received distributes
      const tx = await expect(redistributeUpkeep.performUpkeep(HashZero))
      for (let i = 0; i < batchSize; i++) {
        if (!failedIndexes.includes(i)) {
          await tx.to.emit(voterMock, 'Distributed').withArgs(gaugeList[i])
        } else {
          await tx.to
            .emit(redistributeUpkeep, 'DistributeFailed')
            .withArgs(gaugeList[i], startIndex + i)
        }
      }

      await expect(redistributeUpkeep.performUpkeep(HashZero))
        .to.emit(redistributeUpkeep, 'RedistributeUpkeepPerformed')
        .withArgs(batchSize, batchSize * 2)
    })
  })
})
