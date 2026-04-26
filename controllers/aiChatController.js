const Chat = require('../models/chat')
const User = require('../models/user')
const UserAISettings = require('../models/userAISettings')
const mongoose = require('mongoose')
const { awardGamification } = require('../utils/gamification')
const { encryptKey, decryptKey } = require('../utils/apiKeyCrypto')
const { validateApiKey, buildKeyStatus } = require('../utils/apiKeySecurity')
const { logAuditEvent } = require('../utils/auditLogger')
const { normalizeBaseUrl, getSafeBaseUrlHost } = require('../utils/validateAiBaseUrl')
const {
    generateChatReply,
    generateChatReplyStream,
    getAiErrorResponse,
    getModelOptions,
    normalizeAiModel,
    aiConfig
} = require('../services/ai/chatOrchestrator')
const { getModelConfig } = require('../config/ai')
const { getProvider } = require('../services/ai/providerRegistry')
const { BASE_URL_FIELDS } = require('../services/ai/providerBaseUrls')

const PROVIDER_KEY_FIELDS = {
    openai: 'openaiKey',
    xai: 'xaiKey',
    claude: 'claudeKey',
    gemini: 'geminiKey'
}

const TEST_MODELS = {
    openai: 'gpt-5.4',
    xai: 'grok-api',
    claude: 'claude-3-5-sonnet',
    gemini: 'gemini-pro'
}

async function renderChat(req, res) {
    const aiModels = await getUserModelOptions(req.user._id)
    const preferredDefault = aiModels.find((model) => model.enabled)
        || aiModels[0]

    res.render('chat', {
        aiModels,
        defaultAiModel: preferredDefault ? preferredDefault.id : aiConfig.defaultModel,
        bodyClass: 'ai-chat-shell',
        mainClass: 'ai-chat-main',
        hideFooter: true
    })
}

async function sendMessage(req, res) {
    const userId = req.user._id
    const rawMessage = req.body && req.body.message
    const message = typeof rawMessage === 'string' ? rawMessage.trim() : ''
    const model = normalizeAiModel(req.body && req.body.model)
    let chat = null

    try {
        if (!message) {
            return res.status(400).json({ error: 'Message is required' })
        }

        if (message.length > 10000) {
            return res.status(400).json({ error: 'Message too long (max 10000 characters)' })
        }

        chat = await findOrCreateChat({
            userId,
            chatId: req.body && req.body.chatId,
            titleSeed: message,
            model
        })

        chat.defaultModel = model
        chat.messages.push({
            role: 'user',
            content: message,
            model,
            status: 'ok'
        })

        const reply = await generateChatReply({ userId, model, messages: chat.messages })

        chat.messages.push({
            role: 'assistant',
            content: reply,
            model,
            status: 'ok'
        })

        await chat.save()
        await awardAiTutor(userId)

        return res.json({
            success: true,
            reply,
            model,
            chatId: chat._id,
            title: chat.title
        })
    } catch (err) {
        console.error('AI Chat Error:', err.message)

        if (err.statusCode && !err.publicMessage) {
            return res.status(err.statusCode).json({ error: err.message })
        }

        if (err.name === 'ValidationError') {
            return res.status(400).json({ error: 'Invalid data' })
        }

        const aiError = getAiErrorResponse(err, model)

        if (chat) {
            chat.messages.push({
                role: 'assistant',
                content: aiError.message,
                model,
                status: 'error',
                error: {
                    code: aiError.code,
                    message: err && err.message ? err.message : aiError.message
                }
            })
            await chat.save().catch((saveError) => {
                console.error('AI Chat Error Save Failed:', saveError.message)
            })
        }

        return res.status(aiError.statusCode).json({
            success: false,
            error: aiError.message,
            reply: aiError.message,
            code: aiError.code,
            model,
            chatId: chat && chat._id,
            title: chat && chat.title
        })
    }
}

async function streamMessage(req, res) {
    const userId = req.user._id
    const rawMessage = req.body && req.body.message
    const message = typeof rawMessage === 'string' ? rawMessage.trim() : ''
    const model = normalizeAiModel(req.body && req.body.model)
    let chat = null
    let aborted = false
    const abortController = new AbortController()

    if (!message) {
        return res.status(400).json({ error: 'Message is required' })
    }

    if (message.length > 10000) {
        return res.status(400).json({ error: 'Message too long (max 10000 characters)' })
    }

    prepareStream(res)

    req.on('aborted', () => {
        aborted = true
        abortController.abort()
    })
    res.on('close', () => {
        if (!res.writableEnded) {
            aborted = true
            abortController.abort()
        }
    })

    try {
        chat = await findOrCreateChat({
            userId,
            chatId: req.body && req.body.chatId,
            titleSeed: message,
            model
        })

        chat.defaultModel = model
        chat.messages.push({
            role: 'user',
            content: message,
            model,
            status: 'ok'
        })

        writeStreamEvent(res, 'meta', {
            chatId: chat._id,
            title: chat.title,
            model,
            mode: model === 'grok' ? 'simulated' : 'stream'
        })

        const reply = await generateChatReplyStream({
            userId,
            model,
            messages: chat.messages,
            signal: abortController.signal,
            onToken: (token) => {
                if (!aborted) writeStreamEvent(res, 'chunk', { token })
            },
            onEvent: (event) => {
                if (!aborted) writeStreamEvent(res, 'ai', event)
            }
        })

        if (aborted) return

        chat.messages.push({
            role: 'assistant',
            content: reply,
            model,
            status: 'ok'
        })

        await chat.save()
        await awardAiTutor(userId)

        writeStreamEvent(res, 'done', {
            success: true,
            reply,
            model,
            chatId: chat._id,
            title: chat.title
        })
        res.end()
    } catch (err) {
        console.error('AI Chat Stream Error:', err.message)
        if (aborted) return

        const aiError = getAiErrorResponse(err, model)
        if (chat) {
            chat.messages.push({
                role: 'assistant',
                content: aiError.message,
                model,
                status: 'error',
                error: {
                    code: aiError.code,
                    message: err && err.message ? err.message : aiError.message
                }
            })
            await chat.save().catch((saveError) => {
                console.error('AI Chat Stream Error Save Failed:', saveError.message)
            })
        }

        writeStreamEvent(res, 'error', {
            success: false,
            error: aiError.message,
            code: aiError.code,
            model,
            chatId: chat && chat._id,
            title: chat && chat.title
        })
        res.end()
    }
}

async function regenerateLast(req, res) {
    const model = normalizeAiModel(req.body && req.body.model)

    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ error: 'Invalid chat ID' })
    }

    try {
        const chat = await Chat.findOne({
            _id: req.params.id,
            userId: req.user._id
        })

        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' })
        }

        const lastMessage = chat.messages[chat.messages.length - 1]
        if (lastMessage && lastMessage.role === 'assistant') {
            chat.messages.pop()
        }

        const lastUser = [...chat.messages].reverse().find((msg) => msg.role === 'user')
        if (!lastUser) {
            return res.status(400).json({ error: 'No user message to regenerate' })
        }

        chat.defaultModel = model
        const reply = await generateChatReply({ userId: req.user._id, model, messages: chat.messages })
        chat.messages.push({
            role: 'assistant',
            content: reply,
            model,
            status: 'ok'
        })

        await chat.save()

        return res.json({
            success: true,
            reply,
            model,
            chatId: chat._id,
            title: chat.title
        })
    } catch (err) {
        console.error('AI Regenerate Error:', err.message)
        const aiError = getAiErrorResponse(err, model)
        return res.status(aiError.statusCode).json({
            success: false,
            error: aiError.message,
            code: aiError.code,
            model
        })
    }
}

async function streamRegenerateLast(req, res) {
    const model = normalizeAiModel(req.body && req.body.model)
    let aborted = false
    const abortController = new AbortController()

    if (!mongoose.isValidObjectId(req.params.id)) {
        prepareStream(res)
        writeStreamEvent(res, 'error', { error: 'Invalid chat ID', code: 'INVALID_CHAT_ID' })
        return res.end()
    }

    prepareStream(res)

    req.on('aborted', () => {
        aborted = true
        abortController.abort()
    })
    res.on('close', () => {
        if (!res.writableEnded) {
            aborted = true
            abortController.abort()
        }
    })

    try {
        const chat = await Chat.findOne({
            _id: req.params.id,
            userId: req.user._id
        })

        if (!chat) {
            writeStreamEvent(res, 'error', { error: 'Chat not found', code: 'CHAT_NOT_FOUND' })
            return res.end()
        }

        const lastMessage = chat.messages[chat.messages.length - 1]
        if (lastMessage && lastMessage.role === 'assistant') {
            chat.messages.pop()
        }

        const lastUser = [...chat.messages].reverse().find((msg) => msg.role === 'user')
        if (!lastUser) {
            writeStreamEvent(res, 'error', { error: 'No user message to regenerate', code: 'NO_USER_MESSAGE' })
            return res.end()
        }

        chat.defaultModel = model
        writeStreamEvent(res, 'meta', {
            chatId: chat._id,
            title: chat.title,
            model,
            mode: model === 'grok' ? 'simulated' : 'stream'
        })

        const reply = await generateChatReplyStream({
            userId: req.user._id,
            model,
            messages: chat.messages,
            signal: abortController.signal,
            onToken: (token) => {
                if (!aborted) writeStreamEvent(res, 'chunk', { token })
            },
            onEvent: (event) => {
                if (!aborted) writeStreamEvent(res, 'ai', event)
            }
        })

        if (aborted) return

        chat.messages.push({
            role: 'assistant',
            content: reply,
            model,
            status: 'ok'
        })

        await chat.save()

        writeStreamEvent(res, 'done', {
            success: true,
            reply,
            model,
            chatId: chat._id,
            title: chat.title
        })
        res.end()
    } catch (err) {
        console.error('AI Regenerate Stream Error:', err.message)
        if (aborted) return
        const aiError = getAiErrorResponse(err, model)
        writeStreamEvent(res, 'error', {
            success: false,
            error: aiError.message,
            code: aiError.code,
            model
        })
        res.end()
    }
}

async function listChats(req, res) {
    try {
        const chats = await Chat.find({ userId: req.user._id })
            .select('title defaultModel createdAt updatedAt messages')
            .sort({ updatedAt: -1 })

        const formattedChats = chats.map((chat) => ({
            _id: chat._id,
            title: chat.title,
            defaultModel: normalizeAiModel(chat.defaultModel),
            lastModel: getLastMessageModel(chat) || normalizeAiModel(chat.defaultModel),
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            messageCount: chat.messages.length
        }))

        res.json(formattedChats)
    } catch (err) {
        console.error('List Chats Error:', err.message)
        res.status(500).json({ error: 'Failed to fetch chats' })
    }
}

async function listModels(req, res) {
    res.json(await getUserModelOptions(req.user._id))
}

async function getSettings(req, res) {
    const snapshot = await getUserSettingsSnapshot(req.user._id)
    res.json({ ...snapshot, models: await getUserModelOptions(req.user._id) })
}

async function saveSettings(req, res) {
    const payload = req.body || {}
    const update = {}
    const changedProviders = []

    for (const [provider, field] of Object.entries(PROVIDER_KEY_FIELDS)) {
        if (Object.prototype.hasOwnProperty.call(payload, field)) {
            const value = String(payload[field] || '').trim()
            if (!value) continue

            const validation = validateApiKey(provider, value)
            if (!validation.ok) {
                return res.status(400).json({ error: validation.error })
            }

            update[field] = encryptKey(validation.value)
            changedProviders.push({
                provider,
                masked: validation.masked
            })
        }
    }

    for (const [provider, field] of Object.entries(BASE_URL_FIELDS)) {
        if (Object.prototype.hasOwnProperty.call(payload, field)) {
            const value = String(payload[field] || '').trim()
            if (!value) continue

            let normalized
            try {
                normalized = normalizeBaseUrl(value, provider)
            } catch (error) {
                return res.status(400).json({ error: error.message || 'Invalid base URL.' })
            }

            update[field] = normalized || ''
            changedProviders.push({
                provider,
                baseUrlConfigured: Boolean(normalized),
                baseUrlHost: getSafeBaseUrlHost(normalized)
            })
        }
    }

    if (!Object.keys(update).length) {
        const snapshot = await getUserSettingsSnapshot(req.user._id)
        return res.json({
            success: true,
            ...snapshot,
            models: await getUserModelOptions(req.user._id)
        })
    }

    await UserAISettings.findOneAndUpdate(
        { user: req.user._id },
        { $set: update, $setOnInsert: { user: req.user._id } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    await logAuditEvent({
        req,
        action: 'ai_settings_saved',
        targetType: 'ai-settings',
        targetId: String(req.user._id),
        metadata: {
            providers: changedProviders
        }
    })

    const snapshot = await getUserSettingsSnapshot(req.user._id)
    res.json({ success: true, ...snapshot, models: await getUserModelOptions(req.user._id) })
}

async function clearSetting(req, res) {
    const provider = String(req.params.provider || '').toLowerCase()
    const field = PROVIDER_KEY_FIELDS[provider]
    if (!field) {
        return res.status(400).json({ error: 'Unknown provider' })
    }

    await UserAISettings.findOneAndUpdate(
        { user: req.user._id },
        { $set: { [field]: '' }, $setOnInsert: { user: req.user._id } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    await logAuditEvent({
        req,
        action: 'ai_key_removed',
        targetType: 'ai-settings',
        targetId: String(req.user._id),
        metadata: {
            provider
        }
    })

    const snapshot = await getUserSettingsSnapshot(req.user._id)
    res.json({ success: true, ...snapshot, models: await getUserModelOptions(req.user._id) })
}

async function resetBaseUrl(req, res) {
    const provider = String(req.params.provider || '').toLowerCase()
    const field = BASE_URL_FIELDS[provider]
    if (!field) {
        return res.status(400).json({ error: 'Unknown provider' })
    }

    await UserAISettings.findOneAndUpdate(
        { user: req.user._id },
        { $set: { [field]: '' }, $setOnInsert: { user: req.user._id } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    await logAuditEvent({
        req,
        action: 'ai_base_url_reset',
        targetType: 'ai-settings',
        targetId: String(req.user._id),
        metadata: {
            provider
        }
    })

    const snapshot = await getUserSettingsSnapshot(req.user._id)
    res.json({ success: true, ...snapshot, models: await getUserModelOptions(req.user._id) })
}

async function testProviderConnection(req, res) {
    const provider = String(req.params.provider || '').toLowerCase()
    const keyField = PROVIDER_KEY_FIELDS[provider]
    const baseField = BASE_URL_FIELDS[provider]
    const providerService = getProvider(provider)

    if (!keyField || !baseField || !providerService || typeof providerService.generate !== 'function') {
        return res.status(400).json({ error: 'Unknown provider' })
    }

    const settings = await UserAISettings.findOne({ user: req.user._id }).lean()
    const apiKey = decryptKey(settings && settings[keyField])
    const baseUrl = getStoredBaseUrl(provider, settings && settings[baseField])
    const status = buildProviderStatus(provider, apiKey, baseUrl)

    if (!apiKey) {
        return res.status(400).json({
            success: false,
            ...status,
            code: 'API_KEY_MISSING',
            error: 'Save an API key before testing this provider.'
        })
    }

    const testModel = getModelConfig(TEST_MODELS[provider])

    try {
        await providerService.generate({
            apiKey,
            baseUrl: baseUrl || undefined,
            baseUrlConfigured: Boolean(baseUrl),
            model: testModel.apiModel,
            prompt: 'Reply with "ok".',
            messages: [{ role: 'user', content: 'Reply with "ok".' }],
            maxTokens: 16,
            timeoutMs: Math.min(aiConfig.providers[provider].timeoutMs, 15000)
        })

        await logAuditEvent({
            req,
            action: 'ai_provider_tested',
            targetType: 'ai-settings',
            targetId: String(req.user._id),
            metadata: {
                provider,
                success: true,
                baseUrlConfigured: status.baseUrlConfigured,
                baseUrlHost: status.baseUrlHost
            }
        })

        return res.json({
            success: true,
            ...status,
            message: 'Connection successful.'
        })
    } catch (error) {
        const failure = mapProviderTestFailure(provider, status, error)

        await logAuditEvent({
            req,
            action: 'ai_provider_tested',
            targetType: 'ai-settings',
            targetId: String(req.user._id),
            metadata: {
                provider,
                success: false,
                code: failure.body.code,
                baseUrlConfigured: status.baseUrlConfigured,
                baseUrlHost: status.baseUrlHost
            }
        })

        return res.status(failure.statusCode).json(failure.body)
    }
}

async function getChat(req, res) {
    try {
        const chat = await Chat.findOne({
            _id: req.params.id,
            userId: req.user._id
        })

        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' })
        }

        const formattedChat = {
            _id: chat._id,
            title: chat.title,
            defaultModel: normalizeAiModel(chat.defaultModel || getLastMessageModel(chat)),
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            messages: chat.messages.map((msg) => ({
                _id: msg._id,
                role: msg.role,
                content: msg.content,
                model: normalizeAiModel(msg.model),
                status: msg.status || 'ok',
                error: msg.error || null,
                createdAt: msg.createdAt
            }))
        }

        res.json(formattedChat)
    } catch (err) {
        console.error('Get Chat Error:', err.message)

        if (err.name === 'CastError') {
            return res.status(400).json({ error: 'Invalid chat ID' })
        }

        res.status(500).json({ error: 'Failed to fetch chat' })
    }
}

async function deleteChat(req, res) {
    try {
        const chat = await Chat.findOneAndDelete({
            _id: req.params.id,
            userId: req.user._id
        })

        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' })
        }

        res.json({ success: true, message: 'Chat deleted successfully' })
    } catch (err) {
        console.error('Delete Chat Error:', err.message)

        if (err.name === 'CastError') {
            return res.status(400).json({ error: 'Invalid chat ID' })
        }

        res.status(500).json({ error: 'Failed to delete chat' })
    }
}

async function findOrCreateChat({ userId, chatId, titleSeed, model }) {
    if (chatId) {
        if (!mongoose.isValidObjectId(chatId)) {
            const error = new Error('Invalid chat ID')
            error.statusCode = 400
            throw error
        }

        const chat = await Chat.findOne({ _id: chatId, userId })
        if (!chat) {
            const error = new Error('Chat not found')
            error.statusCode = 404
            throw error
        }
        return chat
    }

    return Chat.create({
        userId,
        title: titleSeed.slice(0, 50).trim() + (titleSeed.length > 50 ? '...' : ''),
        defaultModel: model,
        messages: []
    })
}

async function awardAiTutor(userId) {
    const gamificationUser = await User.findById(userId)
    if (gamificationUser) {
        await awardGamification(gamificationUser, { action: 'aiTutor' })
    }
}

function getLastMessageModel(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    const lastAssistant = [...messages].reverse().find((msg) => msg.role === 'assistant' && msg.model)
    return lastAssistant ? normalizeAiModel(lastAssistant.model) : ''
}

async function getUserKeyStatus(userId) {
    const snapshot = await getUserSettingsSnapshot(userId)
    return snapshot.status
}

async function getUserSettingsSnapshot(userId) {
    const settings = await UserAISettings.findOne({ user: userId }).lean()
    return buildSettingsSnapshot(settings)
}

function buildSettingsSnapshot(settings) {
    return {
        status: {
            openai: buildProviderStatus('openai', decryptKey(settings && settings.openaiKey), settings && settings.openaiBaseUrl),
            xai: buildProviderStatus('xai', decryptKey(settings && settings.xaiKey), settings && settings.xaiBaseUrl),
            claude: buildProviderStatus('claude', decryptKey(settings && settings.claudeKey), settings && settings.claudeBaseUrl),
            gemini: buildProviderStatus('gemini', decryptKey(settings && settings.geminiKey), settings && settings.geminiBaseUrl)
        },
        baseUrls: {
            openai: getStoredBaseUrl('openai', settings && settings.openaiBaseUrl),
            xai: getStoredBaseUrl('xai', settings && settings.xaiBaseUrl),
            claude: getStoredBaseUrl('claude', settings && settings.claudeBaseUrl),
            gemini: getStoredBaseUrl('gemini', settings && settings.geminiBaseUrl)
        }
    }
}

function buildProviderStatus(provider, apiKey, baseUrl) {
    const keyStatus = buildKeyStatus(apiKey)
    const normalizedBaseUrl = getStoredBaseUrl(provider, baseUrl)
    return {
        provider,
        connected: keyStatus.connected,
        masked: keyStatus.masked,
        baseUrlConfigured: Boolean(normalizedBaseUrl),
        baseUrlHost: getSafeBaseUrlHost(normalizedBaseUrl)
    }
}

function mapProviderTestFailure(provider, status, error) {
    const code = String(error && error.code || 'AI_PROVIDER_ERROR')
    const payload = {
        success: false,
        ...status,
        code,
        error: 'Connection test failed.'
    }

    if (code === 'AI_AUTH_FAILED') {
        payload.error = 'Invalid API key.'
        return { statusCode: 401, body: payload }
    }

    if (code === 'AI_RATE_LIMITED') {
        payload.error = 'Rate limited.'
        return { statusCode: 429, body: payload }
    }

    if (code === 'AI_MODEL_NOT_AVAILABLE') {
        payload.error = 'Model unavailable for this provider.'
        return { statusCode: 404, body: payload }
    }

    if (code === 'AI_TIMEOUT' || code === 'AI_ENDPOINT_UNREACHABLE') {
        payload.error = 'The configured endpoint could not be reached.'
        return { statusCode: code === 'AI_TIMEOUT' ? 504 : 502, body: payload }
    }

    if (code === 'API_KEY_MISSING') {
        payload.error = 'Save an API key before testing this provider.'
        return { statusCode: 400, body: payload }
    }

    if (status.baseUrlConfigured) {
        payload.error = 'The custom API endpoint could not complete the request. Check your Base URL, API key, and model name.'
    } else {
        payload.error = 'The provider could not complete the request.'
    }

    return {
        statusCode: error && error.statusCode ? error.statusCode : 503,
        body: payload
    }
}

function getStoredBaseUrl(provider, value) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    try {
        return normalizeBaseUrl(raw, provider) || ''
    } catch {
        return ''
    }
}

async function getUserModelOptions(userId) {
    const keyStatus = await getUserKeyStatus(userId)
    return getModelOptions().map((model) => {
        const config = getModelConfig(model.id)
        const enabled = config.requiresKey
            ? Boolean(keyStatus[config.providerKey] && keyStatus[config.providerKey].connected)
            : model.enabled

        const disabledReason = enabled
            ? ''
            : config.requiresKey
                ? 'Requires API key'
                : 'Disabled'

        return {
            ...model,
            enabled,
            disabledReason
        }
    })
}

function prepareStream(res) {
    res.status(200)
    res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    })
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders()
    }
}

function writeStreamEvent(res, event, data) {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data || {})}\n\n`)
    if (typeof res.flush === 'function') {
        res.flush()
    }
}

module.exports = {
    renderChat,
    sendMessage,
    streamMessage,
    regenerateLast,
    streamRegenerateLast,
    listChats,
    listModels,
    getSettings,
    saveSettings,
    clearSetting,
    resetBaseUrl,
    testProviderConnection,
    getChat,
    deleteChat
}
