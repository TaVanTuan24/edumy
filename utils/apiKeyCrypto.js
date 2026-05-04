const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'
let warnedAboutEncryptionSecret = false

function getEncryptionKey() {
    const isProduction = process.env.NODE_ENV === 'production'
    const encryptionSecret = String(process.env.USER_AI_KEY_ENCRYPTION_SECRET || process.env.AI_KEY_ENCRYPTION_SECRET || '').trim()
    const secret = encryptionSecret
        || process.env.SESSION_SECRET
        || 'dev-ai-key-encryption-secret-change-me'

    if (isProduction && !encryptionSecret) {
        throw new Error('USER_AI_KEY_ENCRYPTION_SECRET is required to encrypt user AI keys in production.')
    }

    if (!isProduction && !encryptionSecret && !warnedAboutEncryptionSecret) {
        warnedAboutEncryptionSecret = true
        console.warn('[ai-settings] USER_AI_KEY_ENCRYPTION_SECRET is not set. Falling back to SESSION_SECRET for local development.')
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

function maskApiKey(value, last4Fallback = '') {
    const plain = String(value || '').trim()
    const last4 = plain ? plain.slice(-4) : String(last4Fallback || '').trim().slice(-4)
    if (!last4) return ''

    const prefixMatch = plain.match(/^([A-Za-z0-9]+)-/)
    const prefix = prefixMatch ? `${prefixMatch[1]}-` : ''
    return `${prefix}...${last4}`
}

module.exports = {
    encryptKey,
    decryptKey,
    maskApiKey
}
