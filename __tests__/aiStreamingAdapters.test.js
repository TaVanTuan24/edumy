const { parseSseBlock } = require('../services/ai/streamAdapters')
const { createStreamEvent, normalizeUsage } = require('../services/ai/normalize')

describe('AI streaming normalization', () => {
    test('parses provider SSE data blocks', () => {
        const event = parseSseBlock('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hello"}}')

        expect(event).toEqual({
            event: 'content_block_delta',
            data: {
                type: 'content_block_delta',
                delta: {
                    text: 'Hello'
                }
            }
        })
    })

    test('recognizes done-only SSE blocks', () => {
        expect(parseSseBlock('data: [DONE]')).toEqual({
            event: 'message',
            done: true
        })
    })

    test('normalizes provider token usage fields', () => {
        expect(normalizeUsage({
            prompt_tokens: 12,
            completion_tokens: 7,
            total_tokens: 19
        })).toEqual({
            inputTokens: 12,
            outputTokens: 7,
            totalTokens: 19
        })
    })

    test('creates frontend-safe normalized delta events', () => {
        expect(createStreamEvent('delta', {
            provider: 'openai',
            model: 'gpt-4o',
            delta: 'Hi'
        })).toMatchObject({
            type: 'delta',
            provider: 'openai',
            model: 'gpt-4o',
            delta: 'Hi'
        })
    })
})
