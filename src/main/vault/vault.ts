/**
 * 密码本保险库容器（与 Python 版 core/vault.py 字节级兼容）
 *
 * 磁盘文件布局（整体 AES-256-GCM 加密）::
 *
 *   MAGIC "PVLT1"(5B) + version(1B) + kdf_salt(16B)   <- 22B 头
 *   verifier_blob: nonce(12) + ct(48)                  <- 加密的 32B 随机令牌
 *   data_blob:     nonce(12) + ct(加密的 SQLite 库字节)
 *
 * 解锁：Argon2id(主密码, salt) -> key -> 解密 verifier 认证通过即密码正确，
 *       再用同一 key 解密 data_blob 得到工作库。
 * 锁定：关闭工作库 + 删除临时明文文件 + 丢弃 key。
 *
 * 安全说明：工作库是解密后的临时 SQLite 文件（随机名，位于 userData/vault-work），
 * 仅在解锁期间存在，锁定/退出时立即删除。相比 Python 版的内存库，这是
 * better-sqlite3 的工程折中；正式容器文件始终整体加密。
 */
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import {
  KDF_SALT_LEN,
  GCM_NONCE_LEN,
  VERIFIER_LEN,
  deriveKey,
  encrypt,
  decrypt,
  randomBytesLen
} from './crypto'
import { initSchema } from './database'

const MAGIC = Buffer.from('PVLT1', 'utf8')
const VERSION = 1
const HEADER_SIZE = 5 + 1 + KDF_SALT_LEN // 22
const VERIFIER_BLOB_LEN = GCM_NONCE_LEN + VERIFIER_LEN + 16 // 60

export class VaultError extends Error {}

/** 工作库临时目录：userData/vault-work（仅解锁期间存在） */
function workDir(): string {
  return path.join(app.getPath('userData'), 'vault-work')
}

/** 原子写盘：先写临时文件再替换 */
function atomicWrite(filePath: string, data: Buffer): void {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, filePath)
}

export class Vault {
  path: string | null = null
  private key: Buffer | null = null
  private salt: Buffer | null = null
  private verifierBlob: Buffer | null = null
  private dataBlob: Buffer | null = null
  private workFile: string | null = null
  private db: Database.Database | null = null

  get isUnlocked(): boolean {
    return this.key !== null && this.db !== null
  }

  /**
   * 是否已从磁盘读入文件头与密文（解锁的前置条件）
   * 注意：解锁成功后密文会被释放（dataBlob=null），锁定后文件头也一并清空，
   * 因此「已解锁」≠「已打开」，再次解锁必须先重新读取库文件。
   */
  get isOpened(): boolean {
    return (
      this.salt !== null &&
      this.verifierBlob !== null &&
      this.dataBlob !== null &&
      this.dataBlob.length >= GCM_NONCE_LEN + 16
    )
  }

  /** 工作库连接（仅解锁后可用） */
  get conn(): Database.Database {
    if (!this.isUnlocked || !this.db) throw new VaultError('保险库未解锁')
    return this.db
  }

  /** 创建全新保险库并解锁 */
  async create(path: string, password: string): Promise<void> {
    this.path = path
    this.salt = randomBytesLen(KDF_SALT_LEN)
    this.key = await deriveKey(password, this.salt)
    this.verifierBlob = encrypt(this.key, randomBytes(VERIFIER_LEN))
    this.db = new Database(':memory:')
    initSchema(this.db)
    this.save()
  }

  /** 读取文件头（不解密）。文件存在且格式合法返回 true */
  open(path: string): boolean {
    if (!fs.existsSync(path)) return false
    const raw = fs.readFileSync(path)
    if (raw.length < HEADER_SIZE + GCM_NONCE_LEN + 16) {
      throw new VaultError('保险库文件损坏：长度不足')
    }
    const magic = raw.subarray(0, 5)
    const version = raw[5]
    if (!magic.equals(MAGIC)) throw new VaultError('不是有效的密码库文件（魔数不匹配）')
    if (version !== VERSION) throw new VaultError(`不支持的密码库版本: ${version}`)
    this.path = path
    this.salt = Buffer.from(raw.subarray(6, HEADER_SIZE))
    this.verifierBlob = Buffer.from(raw.subarray(HEADER_SIZE, HEADER_SIZE + VERIFIER_BLOB_LEN))
    this.dataBlob = Buffer.from(raw.subarray(HEADER_SIZE + VERIFIER_BLOB_LEN))
    return true
  }

  /** 解锁：派生密钥 -> 验证令牌 -> 解密数据。密码错误返回 false */
  async unlock(password: string): Promise<boolean> {
    // 密文不在内存（锁定后 / 从未读取）→ 从磁盘重新读取。
    // 库文件仅数十 KB，重读成本远低于一次 Argon2id 派生的成本。
    if (!this.isOpened) {
      if (!this.path) throw new VaultError('尚未打开保险库文件')
      if (!fs.existsSync(this.path)) {
        throw new VaultError('保险库文件不存在（可能已被移动或删除）')
      }
      this.open(this.path)
      if (!this.isOpened) throw new VaultError('保险库文件不完整，无法解锁')
    }
    const key = await deriveKey(password, this.salt!)
    try {
      decrypt(key, this.verifierBlob!) // GCM 认证失败 = 密码错误
    } catch {
      return false
    }
    let plain: Buffer
    try {
      plain = decrypt(key, this.dataBlob!)
    } catch {
      throw new VaultError('数据解密失败：库文件可能已损坏，请用备份恢复')
    }
    this.db = this.deserialize(plain)
    this.key = key
    this.dataBlob = null // 明文已载入工作库，释放密文引用
    return true
  }

  /** 锁定：关闭工作库、删除明文临时文件、丢弃密钥与内存中的密文 */
  lock(): void {
    try {
      this.db?.close()
    } catch {
      /* ignore */
    }
    this.db = null
    if (this.workFile) {
      try {
        if (fs.existsSync(this.workFile)) fs.unlinkSync(this.workFile)
      } catch {
        /* ignore */
      }
      this.workFile = null
    }
    this.key = null
    // 密文与文件头一并释放：保留 path 仅用于展示/记忆位置，
    // 再次解锁由 unlock() 重新读取磁盘文件（否则会出现"锁定后永远解不开"）
    this.dataBlob = null
    this.salt = null
    this.verifierBlob = null
  }

  /** 加密并写盘（原子替换）。默认写回当前路径 */
  save(target?: string): void {
    if (!this.isUnlocked || !this.key) throw new VaultError('保险库未解锁，无法保存')
    const dest = target ?? this.path
    if (!dest) throw new VaultError('未指定保险库路径')
    const dataBlob = encrypt(this.key, this.serialize())
    const header = Buffer.alloc(HEADER_SIZE)
    MAGIC.copy(header, 0)
    header[5] = VERSION
    this.salt!.copy(header, 6)
    atomicWrite(dest, Buffer.concat([header, this.verifierBlob!, dataBlob]))
    this.path = dest
  }

  /** 导出加密备份：以当前状态重新加密写盘，不改变工作路径 */
  exportBackup(target: string): void {
    this.save(target)
  }

  /** 修改主密码：验证旧密码 -> 重新派生 -> 重加密全部数据 */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!this.salt || !this.verifierBlob) throw new VaultError('尚未打开保险库')
    const oldKey = await deriveKey(oldPassword, this.salt)
    let token: Buffer
    try {
      token = decrypt(oldKey, this.verifierBlob)
    } catch {
      throw new VaultError('原主密码错误')
    }
    const newSalt = randomBytesLen(KDF_SALT_LEN)
    const newKey = await deriveKey(newPassword, newSalt)
    this.salt = newSalt
    this.verifierBlob = encrypt(newKey, token)
    this.key = newKey
    this.save()
  }

  /** 序列化工作库为字节 */
  private serialize(): Buffer {
    const db = this.conn
    db.pragma('wal_checkpoint(TRUNCATE)')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvlt-serialize-'))
    const tmp = path.join(dir, 'out.sqlite')
    try {
      db.prepare('VACUUM INTO ?').run(tmp)
      return fs.readFileSync(tmp)
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }

  /** 从字节恢复工作库（临时明文文件，锁定时删除） */
  private deserialize(raw: Buffer): Database.Database {
    const dir = workDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `work-${randomBytes(8).toString('hex')}.db`)
    fs.writeFileSync(file, raw, { mode: 0o600 })
    const db = new Database(file)
    initSchema(db)
    this.workFile = file
    return db
  }

  /** 应用退出时清理（删除残留工作库文件） */
  static cleanup(): void {
    try {
      fs.rmSync(workDir(), { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
