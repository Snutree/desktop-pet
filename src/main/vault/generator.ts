/**
 * 密码生成器（与 Python 版 core/generator.py 行为一致）
 * 基于 node:crypto 的 CSPRNG，支持自定义字符集与长度。
 */
import { randomInt } from 'node:crypto'

const CHARSETS: Record<string, string> = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digit: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>?/~'
}

/** 易混淆字符（可排除） */
const AMBIGUOUS = new Set('il1Lo0O')

export interface GenerateOptions {
  length: number
  use_lower?: boolean
  use_upper?: boolean
  use_digit?: boolean
  use_symbol?: boolean
  custom?: string
  avoid_ambiguous?: boolean
}

function securePick(pool: string): string {
  return pool[randomInt(pool.length)]
}

/** 生成密码：每个已选字符集至少出现 1 个字符，其余随机填充 */
export function generatePassword(opts: GenerateOptions): string {
  const {
    length,
    use_lower = true,
    use_upper = true,
    use_digit = true,
    use_symbol = true,
    custom = '',
    avoid_ambiguous = false
  } = opts

  if (!(length >= 4 && length <= 256)) throw new Error('长度需在 4~256 之间')

  const pools: string[] = []
  for (const [key, enabled] of [
    ['lower', use_lower],
    ['upper', use_upper],
    ['digit', use_digit],
    ['symbol', use_symbol]
  ] as const) {
    if (enabled) {
      let cs = CHARSETS[key]
      if (avoid_ambiguous) cs = [...cs].filter((c) => !AMBIGUOUS.has(c)).join('')
      pools.push(cs)
    }
  }

  // custom 去重且保序
  const customDedup = [...new Set(custom)].join('')
  if (customDedup) pools.push(customDedup)
  if (pools.length === 0) throw new Error('至少选择一种字符集')

  let len = length
  if (len < pools.length) len = pools.length // 长度不足时自动抬升

  const allChars = pools.join('')
  const chars = pools.map((p) => securePick(p))
  for (let i = chars.length; i < len; i++) chars.push(securePick(allChars))

  // Fisher-Yates 洗牌
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
