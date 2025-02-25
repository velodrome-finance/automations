import { TransactionReceipt } from '@ethersproject/providers'

export function findLog(receipt: TransactionReceipt, eventSignature: string) {
  const log = receipt.logs.find((log) => log.topics[0] === eventSignature)
  if (!log) {
    throw new Error(`Event log not found for ${eventSignature}`)
  }
  return log
}

export function getNextEpochUTC(date: Date = new Date()): Date {
  const currentDay = date.getUTCDay()
  const daysUntilThursday = (4 - currentDay + 7) % 7 || 7
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + daysUntilThursday,
      0,
      0,
      0,
      0,
    ),
  )
}

export function matchSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) {
    return false
  }

  for (const elem of a) {
    if (!b.has(elem)) {
      return false
    }
  }

  return true
}
