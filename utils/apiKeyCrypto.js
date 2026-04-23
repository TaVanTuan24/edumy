const crypto = require('crypto')

const ALGORITHM = 'aes-256-gcm'

function getEncryptionKey() {
    const secret = process.env.AI_KEY_ENCRYPTION_SECRET
        || process.env.SESSION_SECRET
        || 'dev-ai-key-encryption-secret-change-me'
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
