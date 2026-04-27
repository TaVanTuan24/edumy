const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'
const isProduction = process.env.NODE_ENV === 'production'
const encryptionSecret = String(process.env.AI_KEY_ENCRYPTION_SECRET || '').trim()
let warnedAboutEncryptionSecret = false

function getEncryptionKey() {
    const secret = encryptionSecret
        || process.env.SESSION_SECRET
        || 'dev-ai-key-encryption-secret-change-me'

    if (isProduction && !encryptionSecret && !warnedAboutEncryptionSecret) {
        warnedAboutEncryptionSecret = true
        console.warn('[ai-settings] AI_KEY_ENCRYPTION_SECRET is not set in production. Falling back to SESSION_SECRET for BYOK key encryption. Set AI_KEY_ENCRYPTION_SECRET to avoid invalidating saved AI keys when SESSION_SECRET changes.')
    }

    return crypto.createHash('sha256').update(String(secret)).digest()
}

function encryptKey(value) {
    const plain = String(value || '').trim()
    if (!plain) return ''

    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv)
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    return [
        iv.toString('base64'),
        tag.toString('base64'),
        encrypted.toString('base64')
    ].join(':')
}

function decryptKey(value) {
    const encrypted = String(value || '').trim()
    if (!encrypted) return ''

    try {
        const [ivValue, tagValue, cipherValue] = encrypted.split(':')
        if (!ivValue || !tagValue || !cipherValue) return ''

        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            getEncryptionKey(),
            Buffer.from(ivValue, 'base64')
        )
        decipher.setAuthTag(Buffer.from(tagValue, 'base64'))

        return Buffer.concat([
            decipher.update(Buffer.from(cipherValue, 'base64')),
            decipher.final()
        ]).toString('utf8')
    } catch (_error) {
        return ''
    }
}

module.exports = {
    encryptKey,
    decryptKey
}
