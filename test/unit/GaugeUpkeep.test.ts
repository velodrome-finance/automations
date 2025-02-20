import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  GaugeUpkeep,
  GaugeUpkeepManagerMock,
  VoterMock,
} from '../../typechain-types'
import { defaultAbiCoder } from '@ethersproject/abi'
import { getNextEpochUTC } from '../utils'

const { AddressZero, HashZero } = ethers.constants

describe('GaugeUpkeep Unit Tests', function () {
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
    const gaugeUpkeepFactory = await ethers.getContractFactory(
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
      const latestBlockTimestamp = await time.latest()
      const latestDate = new Date(latestBlockTimestamp * 1000)
      const afterEpochFlip = getNextEpochUTC(latestDate).getTime() / 1000
      await time.increaseTo(afterEpochFlip)
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

    it('should not perform upkeep if not needed', async function () {
      // perform upkeep for all gauges
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

    it('should perform upkeep correctly when batch is not full', async function () {
      gaugeList.push(ethers.Wallet.createRandom().address)
      await gaugeUpkeepManagerMock.setGaugeList(gaugeList)

      let newGaugeCount = gaugeList.length
      let newIterationsCount = Math.ceil(newGaugeCount / batchSize)

      const distributedGauges: string[] = []
      for (let i = 0; i < newIterationsCount; i++) {
        const startIdx = i * batchSize
        let endIdx = i * batchSize + batchSize
        endIdx = endIdx > gaugeCount ? newGaugeCount : endIdx

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
      expect(distributedGauges).to.have.members(gaugeList)
    })
  })
})
