import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  GaugeUpkeep,
  GaugeUpkeep__factory,
  GaugeUpkeepManagerMock,
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

describe('GaugeUpkeep Unit Tests', function () {
  let gaugeUpkeepFactory: GaugeUpkeep__factory
  let gaugeUpkeep: GaugeUpkeep
  let voterMock: VoterMock
  let gaugeUpkeepManagerMock: GaugeUpkeepManagerMock
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

    // deploy gauge upkeep manager mock
    const gaugeUpkeepManagerMockFactory = await ethers.getContractFactory(
      'GaugeUpkeepManagerMock',
    )
    gaugeUpkeepManagerMock = await gaugeUpkeepManagerMockFactory.deploy()

    // set gauge list
    gaugeList = Array.from(
      { length: gaugeCount },
      () => ethers.Wallet.createRandom().address,
    )
    await gaugeUpkeepManagerMock.setGaugeList(gaugeList)

    // impersonate gauge upkeep manager
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [gaugeUpkeepManagerMock.address],
    })
    const impersonatedSigner = ethers.provider.getSigner(
      gaugeUpkeepManagerMock.address,
    )
    await network.provider.send('hardhat_setBalance', [
      gaugeUpkeepManagerMock.address,
      '0xffffffffffffffff',
    ])

    // deploy gauge upkeep
    gaugeUpkeepFactory = await ethers.getContractFactory(
      'GaugeUpkeep',
      impersonatedSigner,
    )
    gaugeUpkeep = await gaugeUpkeepFactory.deploy(
      voterMock.address,
      startIndex,
      endIndex,
    )
  })

  describe('Before epoch flip', function () {
    before(async function () {
      const beforeEpochFlip = getNextEpochUTC().getTime() / 1000 - 100
      await time.increaseTo(beforeEpochFlip)
    })

    it('should not trigger upkeep', async function () {
      const [upkeepNeeded, performData] =
        await gaugeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })

    it('should not perform upkeep', async function () {
      await expect(
        gaugeUpkeep.performUpkeep(HashZero),
      ).to.be.revertedWithCustomError(gaugeUpkeep, 'UpkeepNotNeeded')
    })
  })

  describe('After epoch flip', function () {
    beforeEach(async function () {
      await increaseTimeToNextEpoch()
    })

    it('should trigger upkeep', async function () {
      const [upkeepNeeded, performData] =
        await gaugeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.true
      expect(performData).to.equal('0x')
    })

    it('should perform upkeep', async function () {
      for (let i = 0; i < iterationsCount; i++) {
        await expect(gaugeUpkeep.performUpkeep(HashZero))
          .to.emit(gaugeUpkeep, 'GaugeUpkeepPerformed')
          .withArgs(i * batchSize, i * batchSize + batchSize)
      }
    })

    it('should perform upkeep on an interval', async function () {
      for (let i = 0; i < iterationsCount; i++) {
        await expect(gaugeUpkeep.performUpkeep(HashZero))
          .to.emit(gaugeUpkeep, 'GaugeUpkeepPerformed')
          .withArgs(i * batchSize, i * batchSize + batchSize)
      }

      await time.increase(epochLengthInSeconds)

      for (let i = 0; i < iterationsCount; i++) {
        await expect(gaugeUpkeep.performUpkeep(HashZero))
          .to.emit(gaugeUpkeep, 'GaugeUpkeepPerformed')
          .withArgs(i * batchSize, i * batchSize + batchSize)
      }
    })

    it('should distribute all gauges', async function () {
      const distributedGauges: string[] = []
      for (let i = 0; i < iterationsCount; i++) {
        const tx = await gaugeUpkeep.performUpkeep(HashZero)
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
      await gaugeUpkeepManagerMock.removeGaugeList()
      await gaugeUpkeepManagerMock.setGaugeList(newGaugeList)

      const newBatchSize = 3
      await gaugeUpkeepManagerMock.setBatchSize(newBatchSize)

      const newIterationsCount = Math.ceil(newGaugeCount / newBatchSize)

      const distributedGauges: string[] = []
      for (let i = 0; i < newIterationsCount; i++) {
        const startIdx = i * newBatchSize
        let endIdx = i * newBatchSize + newBatchSize
        endIdx = endIdx > newGaugeCount ? newGaugeCount : endIdx

        const tx = await gaugeUpkeep.performUpkeep(HashZero)
        await expect(tx)
          .to.emit(gaugeUpkeep, 'GaugeUpkeepPerformed')
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
        await gaugeUpkeep.performUpkeep(HashZero)
      }

      await expect(
        gaugeUpkeep.performUpkeep(HashZero),
      ).to.be.revertedWithCustomError(gaugeUpkeep, 'UpkeepNotNeeded')

      const [upkeepNeeded, performData] =
        await gaugeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')
    })

    it('should not perform upkeep if the gauge list is empty', async function () {
      await gaugeUpkeepManagerMock.removeGaugeList()

      const [upkeepNeeded, performData] =
        await gaugeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')

      await expect(
        gaugeUpkeep.performUpkeep(HashZero),
      ).to.be.revertedWithCustomError(gaugeUpkeep, 'UpkeepNotNeeded')
    })

    it('should not perform upkeep if outside of the range', async function () {
      const newStartIndex = gaugeCount
      const newEndIndex = gaugeCount * 2
      const newGaugeUpkeep = await gaugeUpkeepFactory.deploy(
        voterMock.address,
        newStartIndex,
        newEndIndex,
      )
      await increaseTimeToNextEpoch()

      const [upkeepNeeded, performData] =
        await newGaugeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeeded).to.be.false
      expect(performData).to.equal('0x')

      await expect(
        newGaugeUpkeep.performUpkeep(HashZero),
      ).to.be.revertedWithCustomError(gaugeUpkeep, 'UpkeepNotNeeded')

      // add one gauge in the range
      gaugeList.push(ethers.Wallet.createRandom().address)
      await gaugeUpkeepManagerMock.setGaugeList(gaugeList)

      const [upkeepNeededAfter, performDataAfter] =
        await newGaugeUpkeep.callStatic.checkUpkeep(HashZero)

      expect(upkeepNeededAfter).to.be.true
      expect(performDataAfter).to.equal('0x')
    })

    it('should continue upkeep after entire batch fails', async function () {
      for (const gauge of gaugeList.slice(0, gaugeList.length / 2)) {
        await voterMock.setFailingGauge(gauge, true)
      }

      const tx = await expect(gaugeUpkeep.performUpkeep(HashZero))
      for (let i = 0; i < batchSize; i++) {
        await tx.to
          .emit(gaugeUpkeep, 'DistributeFailed')
          .withArgs(gaugeList[i], startIndex + i)
      }

      await expect(gaugeUpkeep.performUpkeep(HashZero))
        .to.emit(gaugeUpkeep, 'GaugeUpkeepPerformed')
        .withArgs(batchSize, batchSize * 2)
    })

    it('should continue upkeep after batch partially fails', async function () {
      /// @dev Mock failed distributes
      const failedIndexes = [0, 3]
      for (const failedIndex of failedIndexes) {
        await voterMock.setFailingGauge(gaugeList[failedIndex], true)
      }

      /// @dev Ensure gauges on non-failing indexes received distributes
      const tx = await expect(gaugeUpkeep.performUpkeep(HashZero))
      for (let i = 0; i < batchSize; i++) {
        if (!failedIndexes.includes(i)) {
          await tx.to.emit(voterMock, 'Distributed').withArgs(gaugeList[i])
        } else {
          await tx.to
            .emit(gaugeUpkeep, 'DistributeFailed')
            .withArgs(gaugeList[i], startIndex + i)
        }
      }

      await expect(gaugeUpkeep.performUpkeep(HashZero))
        .to.emit(gaugeUpkeep, 'GaugeUpkeepPerformed')
        .withArgs(batchSize, batchSize * 2)
    })
  })
})
