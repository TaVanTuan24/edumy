const mongoose = require('mongoose')

const userAISettingsSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    openaiKey: {
        type: String,
        default: ''
    },
    openaiBaseUrl: {
        type: String,
        default: ''
    },
    xaiKey: {
        type: String,
        default: ''
    },
    xaiBaseUrl: {
        type: String,
        default: ''
    },
    claudeKey: {
        type: String,
        default: ''
    },
    claudeBaseUrl: {
        type: String,
        default: ''
    },
    geminiKey: {
        type: String,
        default: ''
    },
    geminiBaseUrl: {
        type: String,
        default: ''
    },
    lastUsedModel: {
        type: String,
        default: ''
    }
}, { timestamps: true })

module.exports = mongoose.model('UserAISettings', userAISettingsSchema)
