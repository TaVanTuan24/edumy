const Chat = require('../models/chat')
const User = require('../models/user')
const UserAISettings = require('../models/userAISettings')
const mongoose = require('mongoose')
const { awardGamification } = require('../utils/gamification')
const { encryptKey, decryptKey, maskApiKey } = require('../utils/apiKeyCrypto')
const { logAuditEvent } = require('../utils/auditLogger')
const logger = require('../utils/logger')
const { getSafeBaseUrlHost } = require('../utils/validateAiBaseUrl')
const { ANALYTICS_EVENTS, trackEventSafe } = require('../services/analyticsEventService')
const { normalizeUserAiBaseUrl, testConnection } = require('../services/ai/userAiClient')
const {
    generateChatReply,
    getAiErrorResponse,
    normalizeAiModel
} = require('../services/ai/chatOrchestrator')

async function renderChat(req, res) {
    const snapshot = await getUserSettingsSnapshot(req.user._id)
    const defaultAiModel = snapshot.settings && snapshot.settings.model
        ? snapshot.settings.model
        : ''

    res.render('chat', {
        aiModels: [],
        defaultAiModel,
        aiSettings: snapshot.settings,
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
    const startedAt = Date.now()
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
        trackEventSafe({
            req,
            eventType: ANALYTICS_EVENTS.AI_QUESTION_ASKED,
            metadata: {
                messageLength: message.length,
                chatId: String(chat._id),
                model,
                providerType: 'user_byok',
                success: true,
                latencyMs: Date.now() - startedAt
            }
        })

        return res.json({
            success: true,
            reply,
            model,
            chatId: chat._id,
            title: chat.title
        })
    } catch (err) {
        logger.error({ err }, 'AI Chat Error')
        trackEventSafe({
            req,
            eventType: ANALYTICS_EVENTS.AI_QUESTION_ASKED,
            metadata: {
                messageLength: message.length,
                chatId: chat && chat._id ? String(chat._id) : '',
                model,
                providerType: 'user_byok',
                success: false,
                latencyMs: Date.now() - startedAt
            }
        })

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
                logger.error({ err: saveError }, 'AI Chat Error Save Failed')
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
    res.status(410).json({
        success: false,
        code: 'AI_STREAM_DISABLED',
        error: 'AI streaming has been disabled for this deployment.'
    })
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
        logger.error({ err }, 'AI Regenerate Error')
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
    res.status(410).json({
        success: false,
        code: 'AI_STREAM_DISABLED',
        error: 'AI streaming has been disabled for this deployment.'
    })
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
        logger.error({ err }, 'List Chats Error')
        res.status(500).json({ error: 'Failed to fetch chats' })
    }
}

async function listModels(req, res) {
    res.json({
        success: true,
        models: [],
        customModelsOnly: true,
        message: 'Users can configure any OpenAI-compatible model in AI settings.'
    })
}

async function getSettings(req, res) {
    const snapshot = await getUserSettingsSnapshot(req.user._id)
    res.json({
        success: true,
        ...snapshot,
        models: [],
        customModelsOnly: true
    })
}

async function saveSettings(req, res) {
    const payload = req.body || {}
    const existing = await UserAISettings.findOne({ user: req.user._id }).lean()
    const normalizedBaseUrl = normalizeUserAiBaseUrl(payload.baseUrl)
    const model = String(payload.model || '').trim()
    const hasApiKeyInput = Object.prototype.hasOwnProperty.call(payload, 'apiKey')
    const apiKey = hasApiKeyInput ? String(payload.apiKey || '').trim() : ''

    if (!normalizedBaseUrl) {
        return res.status(400).json({ success: false, error: 'Base URL must be a valid http:// or https:// URL.' })
    }

    if (!model) {
        return res.status(400).json({ success: false, error: 'Model is required.' })
    }

    if (!existing && !hasApiKeyInput) {
        return res.status(400).json({ success: false, error: 'API key is required when creating AI settings. Use an empty value only if your provider supports it.' })
    }

    const update = {
        baseUrl: normalizedBaseUrl,
        model
    }

    if (hasApiKeyInput) {
        try {
            update.apiKeyEncrypted = apiKey ? encryptKey(apiKey) : ''
            update.apiKeyLast4 = apiKey ? apiKey.slice(-4) : ''
        } catch (_error) {
            return res.status(500).json({
                success: false,
                error: 'AI key encryption is not configured on this server.'
            })
        }
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
            baseUrlHost: getSafeBaseUrlHost(normalizedBaseUrl),
            model,
            apiKeyUpdated: hasApiKeyInput
        }
    })

    const snapshot = await getUserSettingsSnapshot(req.user._id)
    res.json({ success: true, ...snapshot, models: [], customModelsOnly: true })
}

async function deleteSettings(req, res) {
    await UserAISettings.findOneAndUpdate(
        { user: req.user._id },
        {
            $set: {
                baseUrl: '',
                model: '',
                apiKeyEncrypted: '',
                apiKeyLast4: ''
            },
            $setOnInsert: { user: req.user._id }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    await logAuditEvent({
        req,
        action: 'ai_settings_deleted',
        targetType: 'ai-settings',
        targetId: String(req.user._id),
        metadata: {
            customConfigOnly: true
        }
    })

    const snapshot = await getUserSettingsSnapshot(req.user._id)
    res.json({ success: true, ...snapshot, models: [], customModelsOnly: true })
}

async function testSettings(req, res) {
    const payload = req.body || {}
    const existing = await UserAISettings.findOne({ user: req.user._id }).lean()
    const hasDraftConfig = Boolean(payload.baseUrl || payload.model || Object.prototype.hasOwnProperty.call(payload, 'apiKey'))
    const baseUrl = normalizeUserAiBaseUrl(hasDraftConfig ? payload.baseUrl : existing && existing.baseUrl)
    const model = String((hasDraftConfig ? payload.model : existing && existing.model) || '').trim()
    const hasApiKeyInput = Object.prototype.hasOwnProperty.call(payload, 'apiKey')
    const apiKey = hasDraftConfig && hasApiKeyInput
        ? String(payload.apiKey || '').trim()
        : decryptKey(existing && existing.apiKeyEncrypted)

    if (!baseUrl || !model) {
        return res.status(400).json({
            success: false,
            code: 'AI_CONFIG_REQUIRED',
            message: 'Please configure your AI model, API key, and base URL before testing.'
        })
    }

    try {
        await testConnection({ baseUrl, model, apiKey })
        return res.json({
            success: true,
            message: 'Connection successful'
        })
    } catch (error) {
        const failure = mapUserAiTestFailure(error)
        return res.status(failure.statusCode).json(failure.body)
    }
}

async function clearSetting(req, res) {
    res.status(410).json({
        success: false,
        error: 'Provider-specific AI settings have been replaced by custom OpenAI-compatible AI settings.'
    })
}

async function resetBaseUrl(req, res) {
    res.status(410).json({
        success: false,
        error: 'Provider-specific AI settings have been replaced by custom OpenAI-compatible AI settings.'
    })
}

async function testProviderConnection(req, res) {
    res.status(410).json({
        success: false,
        error: 'Provider-specific AI settings have been replaced by custom OpenAI-compatible AI settings.'
    })
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
        logger.error({ err }, 'Get Chat Error')

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
        logger.error({ err }, 'Delete Chat Error')

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

async function getUserSettingsSnapshot(userId) {
    const settings = await UserAISettings.findOne({ user: userId }).lean()
    return buildSettingsSnapshot(settings)
}

function buildSettingsSnapshot(settings) {
    const rawApiKey = decryptKey(settings && settings.apiKeyEncrypted)
    const hasApiKey = Boolean(rawApiKey || settings && settings.apiKeyLast4)
    const baseUrl = normalizeUserAiBaseUrl(settings && settings.baseUrl)
    const model = String(settings && settings.model || '').trim()

    return {
        settings: {
            baseUrl,
            model,
            hasApiKey,
            apiKeyMasked: hasApiKey ? maskApiKey(rawApiKey, settings && settings.apiKeyLast4) : '',
            updatedAt: settings && settings.updatedAt ? settings.updatedAt : null
        },
        status: {
            connected: Boolean(baseUrl && model),
            hasApiKey,
            apiKeyMasked: hasApiKey ? maskApiKey(rawApiKey, settings && settings.apiKeyLast4) : '',
            baseUrlHost: getSafeBaseUrlHost(baseUrl)
        },
        baseUrls: {}
    }
}

function mapUserAiTestFailure(error) {
    const code = String(error && error.code || 'AI_PROVIDER_ERROR')
    const payload = {
        success: false,
        code,
        message: 'Could not connect to this AI provider. Please check base URL, API key, and model.'
    }

    if (code === 'AI_AUTH_FAILED') {
        payload.message = 'Invalid API key.'
        return { statusCode: 401, body: payload }
    }

    if (code === 'AI_RATE_LIMITED') {
        payload.message = 'Rate limited.'
        return { statusCode: 429, body: payload }
    }

    if (code === 'AI_MODEL_NOT_AVAILABLE') {
        payload.message = 'Model unavailable for this provider.'
        return { statusCode: 404, body: payload }
    }

    if (code === 'AI_TIMEOUT' || code === 'AI_ENDPOINT_UNREACHABLE') {
        payload.message = 'The configured endpoint could not be reached.'
        return { statusCode: code === 'AI_TIMEOUT' ? 504 : 502, body: payload }
    }

    if (code === 'AI_CONFIG_REQUIRED') {
        payload.message = 'Please configure your AI model, API key, and base URL before testing.'
        return { statusCode: 400, body: payload }
    }

    return {
        statusCode: error && error.statusCode ? error.statusCode : 503,
        body: payload
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
    deleteSettings,
    testSettings,
    clearSetting,
    resetBaseUrl,
    testProviderConnection,
    getChat,
    deleteChat
}
