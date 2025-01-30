import { expect } from 'chai'
import { ethers } from 'hardhat'
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
  const endIndex = 10
  const gaugeCount = endIndex - startIndex
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

    // deploy gauge upkeep
    const gaugeUpkeepFactory = await ethers.getContractFactory('GaugeUpkeep')
    gaugeUpkeep = await gaugeUpkeepFactory.deploy(
      voterMock.address,
      gaugeUpkeepManagerMock.address,
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
    before(async function () {
      const afterEpochFlip = getNextEpochUTC().getTime() / 1000
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
  })
})
