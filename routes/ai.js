const express = require("express")
const router = express.Router()
const axios = require("axios")
const Chat = require("../models/chat")

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized. Please login." })
    }
    next()
}

// Apply authentication middleware to all routes
router.use(isAuthenticated)

// Open chat page
router.get("/", (req, res) => {
    res.render("chat")
})

// Send message - creates new chat or appends to existing
router.post("/chat", async (req, res) => {
    try {
        const userId = req.user._id
        const { message, chatId } = req.body

        // Input validation
        if (!message || typeof message !== "string" || message.trim().length === 0) {
            return res.status(400).json({ error: "Message is required" })
        }

        if (message.length > 10000) {
            return res.status(400).json({ error: "Message too long (max 10000 characters)" })
        }

        let chat

        // If chatId provided, find existing chat and append messages
        if (chatId) {
            chat = await Chat.findOne({ _id: chatId, userId })
            
            if (!chat) {
                return res.status(404).json({ error: "Chat not found" })
            }
        } else {
            // Create new chat
            chat = await Chat.create({
                userId,
                title: message.slice(0, 50).trim() + (message.length > 50 ? "..." : ""),
                messages: []
            })
        }

        // Add user message to chat
        chat.messages.push({
            role: "user",
            content: message.trim()
        })

        // Build conversation context for Ollama
        const conversationHistory = chat.messages
            .slice(-10) // Keep last 10 messages for context
            .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
            .join("\n\n")

        const prompt = conversationHistory + `\n\nUser: ${message.trim()}\n\nAssistant:`

        // Call Ollama API
        const ai = await axios.post(
            "http://localhost:11434/api/generate",
            {
                model: "llama3.2",
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.7,
                    top_p: 0.9,
                    max_tokens: 2048
                }
            },
            {
                timeout: 120000 // 2 minute timeout
            }
        )

        const reply = ai.data.response

        // Add AI response to chat
        chat.messages.push({
            role: "assistant",
            content: reply
        })

        // Save chat with new messages
        await chat.save()

        res.json({
            success: true,
            reply,
            chatId: chat._id,
            title: chat.title
        })

    } catch (err) {
        console.error("AI Chat Error:", err.message)

        // Handle specific error types
        if (err.code === "ECONNREFUSED") {
            return res.status(503).json({ error: "AI service unavailable. Is Ollama running?" })
        }

        if (err.response) {
            return res.status(err.response.status).json({ 
                error: err.response.data?.error || "AI service error" 
            })
        }

        if (err.name === "ValidationError") {
            return res.status(400).json({ error: "Invalid data" })
        }

        res.status(500).json({ error: "Failed to process your request. Please try again." })
    }
})

// List all chats for current user
router.get("/list", async (req, res) => {
    try {
        const chats = await Chat.find({ userId: req.user._id })
            .select("title createdAt updatedAt messages") // Only return necessary fields
            .sort({ updatedAt: -1 }) // Sort by most recent

        // Format response
        const formattedChats = chats.map(chat => ({
            _id: chat._id,
            title: chat.title,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            messageCount: chat.messages.length
        }))

        res.json(formattedChats)
    } catch (err) {
        console.error("List Chats Error:", err.message)
        res.status(500).json({ error: "Failed to fetch chats" })
    }
})

// Get a specific chat with all messages
router.get("/:id", async (req, res) => {
    try {
        const chat = await Chat.findOne({ 
            _id: req.params.id, 
            userId: req.user._id 
        })

        if (!chat) {
            return res.status(404).json({ error: "Chat not found" })
        }

        // Format response
        const formattedChat = {
            _id: chat._id,
            title: chat.title,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
            messages: chat.messages.map(msg => ({
                role: msg.role,
                content: msg.content,
                createdAt: msg.createdAt
            }))
        }

        res.json(formattedChat)
    } catch (err) {
        console.error("Get Chat Error:", err.message)
        
        if (err.name === "CastError") {
            return res.status(400).json({ error: "Invalid chat ID" })
        }
        
        res.status(500).json({ error: "Failed to fetch chat" })
    }
})

// Delete a chat
router.delete("/:id", async (req, res) => {
    try {
        const chat = await Chat.findOneAndDelete({ 
            _id: req.params.id, 
            userId: req.user._id 
        })

        if (!chat) {
            return res.status(404).json({ error: "Chat not found" })
        }

        res.json({ success: true, message: "Chat deleted successfully" })
    } catch (err) {
        console.error("Delete Chat Error:", err.message)
        
        if (err.name === "CastError") {
            return res.status(400).json({ error: "Invalid chat ID" })
        }
        
        res.status(500).json({ error: "Failed to delete chat" })
    }
})

module.exports = router