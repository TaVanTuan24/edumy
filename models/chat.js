const mongoose = require("mongoose")

const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ["user", "assistant"],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    model: {
        type: String,
        default: "llama3.2"
    },
    status: {
        type: String,
        enum: ["ok", "error"],
        default: "ok"
    },
    error: {
        code: {
            type: String,
            default: null
        },
        message: {
            type: String,
            default: null
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
})

const chatSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },

    messages: [messageSchema],

    defaultModel: {
        type: String,
        default: "llama3.2"
    },

    createdAt: {
        type: Date,
        default: Date.now
    },

    updatedAt: {
        type: Date,
        default: Date.now
    }
})

// Update timestamp on save
chatSchema.pre("save", function(next) {
    this.updatedAt = new Date()
    next()
})

// Index for sorting by creation date
chatSchema.index({ createdAt: -1 })

// Compound index for user-specific queries
chatSchema.index({ userId: 1, createdAt: -1 })

module.exports = mongoose.model("Chat", chatSchema)
