import { TransactionReceipt } from '@ethersproject/providers'

export function findLog(receipt: TransactionReceipt, eventSignature: string) {
  const log = receipt.logs.find((log) => log.topics[0] === eventSignature)
  if (!log) {
    throw new Error(`Event log not found for ${eventSignature}`)
  }
  return log
}

export function getNextEpochUTC(): Date {
  const now = new Date()
  const currentDay = now.getUTCDay()
  const daysUntilThursday = (4 - currentDay + 7) % 7 || 7
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysUntilThursday,
      0,
      0,
      0,
      0,
    ),
  )
}
