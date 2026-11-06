/**
 * 密码本密码学原语（与 PasswordVault Python 版完全兼容）
 *
 * - Argon2id 派生 32 字节主密钥（64 MiB / t=3 / p=1）
 * - AES-256-GCM 加密，nonce(12) + 密文(含末尾 16B 认证标签)
 *
 * 文件布局与 Python 版 core/crypto.py + core/vault.py 保持一致，
 * 可直接解锁已有 vault.pvlt 密码库。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { argon2id } from 'hash-wasm'

export const KDF_SALT_LEN = 16
export const GCM_NONCE_LEN = 12
export const KEY_LEN = 32
export const VERIFIER_LEN = 32

/** Argon2id 参数：与 Python 版一致（64 MiB / 3 轮 / 1 并行） */
export const KDF_MEMORY_COST = 64 * 1024
export const KDF_TIME_COST = 3
export const KDF_PARALLELISM = 1

/** 主密码 -> 32 字节主密钥（Argon2id，WASM 实现，参数与 Python 版一致） */
export async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  if (salt.length !== KDF_SALT_LEN) {
    throw new Error('盐长度必须为 16 字节')
  }
  const raw = await argon2id({
    password,
    salt,
    parallelism: KDF_PARALLELISM,
    iterations: KDF_TIME_COST,
    memorySize: KDF_MEMORY_COST, // KiB
    hashLength: KEY_LEN,
    outputType: 'binary'
  })
  return Buffer.from(raw)
}

/** AES-256-GCM 加密：nonce(12) + 密文 + tag(16)，与 Python 布局一致 */
export function encrypt(key: Buffer, plaintext: Buffer): Buffer {
  const nonce = randomBytes(GCM_NONCE_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ct, tag])
}

/** AES-256-GCM 解密；密钥错误或密文被篡改时抛异常 */
export function decrypt(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < GCM_NONCE_LEN + 16) {
    throw new Error('密文长度不足')
  }
  const nonce = blob.subarray(0, GCM_NONCE_LEN)
  const tag = blob.subarray(blob.length - 16)
  const ct = blob.subarray(GCM_NONCE_LEN, blob.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

export function randomBytesLen(n: number): Buffer {
  return randomBytes(n)
}
