const Chat = require('../models/chat')
const User = require('../models/user')
const { awardGamification } = require('../utils/gamification')
const {
    generateChatReply,
    generateChatReplyStream,
    getAiErrorResponse,
    getModelOptions,
    normalizeAiModel,
    aiConfig
} = require('../services/ai/chatOrchestrator')

function renderChat(req, res) {
    res.render('chat', {
        aiModels: getModelOptions(),
        defaultAiModel: aiConfig.defaultModel,
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

        const reply = await generateChatReply({ model, messages: chat.messages })

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

    if (!message) {
        return res.status(400).json({ error: 'Message is required' })
    }

    if (message.length > 10000) {
        return res.status(400).json({ error: 'Message too long (max 10000 characters)' })
    }

    prepareStream(res)

    req.on('aborted', () => {
        aborted = true
    })
    res.on('close', () => {
        if (!res.writableEnded) aborted = true
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
            model,
            messages: chat.messages,
            onToken: (token) => {
                if (!aborted) writeStreamEvent(res, 'chunk', { token })
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
        const reply = await generateChatReply({ model, messages: chat.messages })
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

    prepareStream(res)

    req.on('aborted', () => {
        aborted = true
    })
    res.on('close', () => {
        if (!res.writableEnded) aborted = true
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
            model,
            messages: chat.messages,
            onToken: (token) => {
                if (!aborted) writeStreamEvent(res, 'chunk', { token })
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
            defaultModel: chat.defaultModel || 'llama3.2',
            lastModel: getLastMessageModel(chat) || chat.defaultModel || 'llama3.2',
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
            defaultModel: chat.defaultModel || getLastMessageModel(chat) || 'llama3.2',
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            messages: chat.messages.map((msg) => ({
                _id: msg._id,
                role: msg.role,
                content: msg.content,
                model: msg.model || 'llama3.2',
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
    return lastAssistant && lastAssistant.model
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
    getChat,
    deleteChat
}
