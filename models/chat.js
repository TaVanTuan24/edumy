const mongoose = require("mongoose")

const messageSchema = new mongoose.Schema({
    role: String,   // user | assistant
    content: String
})

const chatSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },

    title: String,

    messages: [messageSchema],

    createdAt: {
        type: Date,
        default: Date.now
    }
})

module.exports = mongoose.model("Chat", chatSchema)