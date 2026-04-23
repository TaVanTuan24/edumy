const { AITimeoutError } = require('./errors')

function createRequestController({ signal, timeoutMs, provider }) {
    const controller = new AbortController()
    let timeout = null
    let didTimeout = false

    function abort() {
        if (!controller.signal.aborted) controller.abort()
    }

    if (signal) {
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
    }

    if (timeoutMs) {
        timeout = setTimeout(() => {
            didTimeout = true
            abort()
        }, timeoutMs)
    }

    return {
        signal: controller.signal,
        cleanup() {
            if (timeout) clearTimeout(timeout)
            if (signal) signal.removeEventListener('abort', abort)
        },
        throwIfTimedOut(error) {
            if (didTimeout && controller.signal.aborted) {
                throw new AITimeoutError(provider, error)
            }
        }
    }
}

async function readSseStream(stream, onSse) {
    let buffer = ''

    await new Promise((resolve, reject) => {
        stream.on('data', (chunk) => {
            buffer += chunk.toString('utf8')
            const blocks = buffer.split(/\r?\n\r?\n/)
            buffer = blocks.pop() || ''

            blocks.forEach((block) => {
                try {
                    const event = parseSseBlock(block)
                    if (event) onSse(event)
                } catch (error) {
                    reject(error)
                }
            })
        })

        stream.on('end', () => {
            if (buffer.trim()) {
                try {
                    const event = parseSseBlock(buffer)
                    if (event) onSse(event)
                } catch (error) {
                    reject(error)
                    return
                }
            }
            resolve()
        })

        stream.on('error', reject)
    })
}

function parseSseBlock(block) {
    const lines = String(block || '').split(/\r?\n/)
    let event = 'message'
    let data = ''

    lines.forEach((line) => {
        if (line.startsWith('event:')) {
            event = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
            data += line.slice(5).trim()
        }
    })

    if (!data) return null
    if (data === '[DONE]') return { event, done: true }

    return {
        event,
        data: JSON.parse(data)
    }
}

module.exports = {
    createRequestController,
    readSseStream,
    parseSseBlock
}
