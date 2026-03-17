const express = require("express")
const router = express.Router()
const axios = require("axios")
const Chat = require("../models/Chat")

// open chat page
router.get("/", (req, res) => {
    res.render("chat")
})

// send message
router.post("/chat", async (req, res) => {

    try {

        const userId = req.user._id
        const { message, chatId } = req.body

        let chat

        if (chatId) {

            chat = await Chat.findById(chatId)

        } else {

            chat = await Chat.create({
                userId,
                title: message.slice(0, 40),
                messages: []
            })

        }

        chat.messages.push({
            role: "user",
            content: message
        })

        const ai = await axios.post(
            "http://localhost:11434/api/generate",
            {
                model: "llama3.2",
                prompt: message,
                stream: false
            }
        )

        const reply = ai.data.response

        chat.messages.push({
            role: "assistant",
            content: reply
        })

        await chat.save()

        res.json({
            reply,
            chatId: chat._id
        })

    } catch (err) {

        console.log(err)

        res.status(500).send("AI error")

    }

})


// list chats of current user
router.get("/list", async (req, res) => {

    const chats = await Chat.find({
        userId: req.user._id
    }).sort({ createdAt: -1 })

    res.json(chats)

})


// get messages in a chat
router.get("/messages/:id", async (req, res) => {

    const chat = await Chat.findById(req.params.id)

    res.json(chat.messages)

})

module.exports = router