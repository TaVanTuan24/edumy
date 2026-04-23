const ollama = require('../../config/ollama')
const { aiConfig } = require('../../config/ai')

async function generate(prompt, options = {}) {
    const response = await ollama.post(
        '/api/generate',
        {
            model: options.model || aiConfig.ollama.model,
            prompt,
            stream: false,
            options: {
                temperature: options.temperature === undefined ? 0.7 : options.temperature,
                top_p: options.topP === undefined ? 0.9 : options.topP,
                max_tokens: options.maxTokens || 2048
            }
        },
        {
            timeout: options.timeoutMs || aiConfig.ollama.timeoutMs
        }
    )

    return response.data && response.data.response ? String(response.data.response).trim() : ''
}

async function generateStream(prompt, options = {}, onToken) {
    const response = await ollama.post(
        '/api/generate',
        {
            model: options.model || aiConfig.ollama.model,
            prompt,
            stream: true,
            options: {
                temperature: options.temperature === undefined ? 0.7 : options.temperature,
                top_p: options.topP === undefined ? 0.9 : options.topP,
                max_tokens: options.maxTokens || 2048
            }
        },
        {
            responseType: 'stream',
            timeout: options.timeoutMs || aiConfig.ollama.timeoutMs
        }
    )

    let buffer = ''
    let reply = ''

    await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
            buffer += chunk.toString('utf8')
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            lines.forEach((line) => {
                const trimmed = line.trim()
                if (!trimmed) return

                try {
                    const payload = JSON.parse(trimmed)
                    const token = payload.response ? String(payload.response) : ''
                    if (token) {
                        reply += token
                        if (onToken) onToken(token)
                    }
                } catch (error) {
                    reject(error)
                }
            })
        })

        response.data.on('end', () => {
            if (buffer.trim()) {
                try {
                    const payload = JSON.parse(buffer.trim())
                    const token = payload.response ? String(payload.response) : ''
                    if (token) {
                        reply += token
                        if (onToken) onToken(token)
                    }
                } catch (error) {
                    reject(error)
                    return
                }
            }
            resolve()
        })

        response.data.on('error', reject)
    })

    return reply.trim()
}

module.exports = {
    generate,
    generateStream
}
