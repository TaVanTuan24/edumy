const userAiClient = require('./userAiClient')

async function generate({ userId, prompt, messages, options = {} }) {
    const result = await userAiClient.generate({ userId, prompt, messages, options })
    return result.content
}

async function generateNormalized({ userId, prompt, messages, options = {} }) {
    return userAiClient.generate({ userId, prompt, messages, options })
}

async function generateStream({ userId, prompt, messages, options = {}, onToken, onEvent }) {
    const result = await generateStreamNormalized({ userId, prompt, messages, options, onToken, onEvent })
    return result.content
}

async function generateStreamNormalized({ userId, prompt, messages, options = {}, onToken, onEvent }) {
    return userAiClient.stream({
        userId,
        prompt,
        messages,
        options,
        onEvent: (event) => {
            if (event.type === 'delta' && event.delta && onToken) onToken(event.delta)
            if (onEvent) onEvent(event)
        }
    })
}

async function simulateStream(text, onToken) {
    const tokens = String(text || '').match(/\S+\s*|\n+/g) || []
    for (const token of tokens) {
        if (onToken) onToken(token)
        await new Promise((resolve) => setTimeout(resolve, 18))
    }
}

module.exports = {
    generate,
    generateNormalized,
    generateStream,
    generateStreamNormalized,
    simulateStream
}
