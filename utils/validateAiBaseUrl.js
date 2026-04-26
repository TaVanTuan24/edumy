const net = require('net')

const PROVIDER_LABELS = {
    openai: 'OpenAI',
    xai: 'xAI',
    claude: 'Claude',
    gemini: 'Gemini'
}

function readBoolean(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function normalizeBaseUrl(input, provider) {
    const raw = String(input || '').trim()
    if (!raw) return null

    if (!readBoolean(process.env.ALLOW_AI_CUSTOM_BASE_URLS, true)) {
        throw new Error('Custom AI base URLs are disabled on this server.')
    }

    if (raw.length > 2048) {
        throw new Error(`${getProviderLabel(provider)} base URL is too long.`)
    }

    let parsed
    try {
        parsed = new URL(raw)
    } catch {
        throw new Error(`${getProviderLabel(provider)} base URL must be a valid http:// or https:// URL.`)
    }

    const protocol = String(parsed.protocol || '').toLowerCase()
    if (!['http:', 'https:'].includes(protocol)) {
        throw new Error(`${getProviderLabel(provider)} base URL must use http:// or https://.`)
    }

    if (parsed.username || parsed.password) {
        throw new Error(`${getProviderLabel(provider)} base URL cannot include username or password credentials.`)
    }

    if (parsed.search || parsed.hash) {
        throw new Error(`${getProviderLabel(provider)} base URL cannot include query strings or fragments.`)
    }

    const hostname = String(parsed.hostname || '').trim().toLowerCase()
    if (!hostname) {
        throw new Error(`${getProviderLabel(provider)} base URL must include a hostname.`)
    }

    const isLocalTarget = isLocalHostname(hostname) || isLocalIpLiteral(hostname)
    const isPrivateTarget = isPrivateIpLiteral(hostname)
    const allowLocalTargets = readBoolean(
        process.env.ALLOW_AI_LOCAL_BASE_URLS,
        process.env.NODE_ENV !== 'production'
    )

    if ((isLocalTarget || isPrivateTarget) && !allowLocalTargets) {
        throw new Error(`${getProviderLabel(provider)} base URL cannot target localhost or a private network on this server.`)
    }

    if (protocol === 'http:' && !allowLocalTargets) {
        throw new Error(`${getProviderLabel(provider)} base URL must use https:// on this server.`)
    }

    if (protocol === 'http:' && !(isLocalTarget || isPrivateTarget)) {
        throw new Error(`${getProviderLabel(provider)} base URL must use https:// unless it targets localhost or a local development address.`)
    }

    const pathname = normalizeProviderPath(parsed.pathname, provider)
    const normalized = `${parsed.origin}${pathname}`
    return normalized.replace(/\/+$/, '') || parsed.origin
}

function getSafeBaseUrlHost(baseUrl) {
    if (!baseUrl) return ''
    try {
        const parsed = new URL(String(baseUrl))
        return parsed.host || parsed.hostname || ''
    } catch {
        return ''
    }
}

function getProviderLabel(provider) {
    return PROVIDER_LABELS[String(provider || '').toLowerCase()] || 'AI provider'
}

function normalizeProviderPath(pathname, provider) {
    const cleanPath = normalizePath(pathname)
    const providerKey = String(provider || '').toLowerCase()

    if (!cleanPath) return ''

    if (providerKey === 'openai' || providerKey === 'xai') {
        return stripTerminalPath(cleanPath, ['/responses', '/chat/completions'])
    }

    if (providerKey === 'claude') {
        return stripTerminalPath(cleanPath, ['/messages'])
    }

    if (providerKey === 'gemini') {
        const lower = cleanPath.toLowerCase()
        const modelIndex = lower.indexOf('/models/')
        if (modelIndex >= 0) {
            return normalizePath(cleanPath.slice(0, modelIndex))
        }
    }

    return cleanPath
}

function stripTerminalPath(pathname, suffixes) {
    const lower = pathname.toLowerCase()
    for (const suffix of suffixes) {
        if (lower.endsWith(suffix)) {
            return normalizePath(pathname.slice(0, pathname.length - suffix.length))
        }
    }
    return pathname
}

function normalizePath(pathname) {
    const value = String(pathname || '').replace(/\/+$/, '')
    if (!value || value === '/') return ''
    return value.startsWith('/') ? value : `/${value}`
}

function isLocalHostname(hostname) {
    const value = String(hostname || '').toLowerCase()
    return value === 'localhost' || value.endsWith('.localhost')
}

function isLocalIpLiteral(hostname) {
    const ipVersion = net.isIP(hostname)
    if (!ipVersion) return false
    if (hostname === '127.0.0.1' || hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
        return true
    }
    if (ipVersion === 4 && hostname.startsWith('127.')) {
        return true
    }
    return false
}

function isPrivateIpLiteral(hostname) {
    const ipVersion = net.isIP(hostname)
    if (!ipVersion) return false

    if (ipVersion === 4) {
        const parts = hostname.split('.').map(Number)
        const first = parts[0]
        const second = parts[1]
        return first === 10
            || (first === 172 && second >= 16 && second <= 31)
            || (first === 192 && second === 168)
            || (first === 169 && second === 254)
    }

    const normalized = hostname.toLowerCase()
    return normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80:')
}

module.exports = {
    normalizeBaseUrl,
    getSafeBaseUrlHost
}
