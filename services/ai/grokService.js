const fs = require('fs/promises')
const path = require('path')
const { spawn } = require('child_process')
const { aiConfig } = require('../../config/ai')

let grokQueue = Promise.resolve()

class GrokServiceError extends Error {
    constructor(message, options = {}) {
        super(message)
        this.name = 'GrokServiceError'
        this.code = options.code || 'GROK_ERROR'
        this.statusCode = options.statusCode || 503
        this.publicMessage = options.publicMessage || message
        this.stderr = options.stderr || ''
        this.stdout = options.stdout || ''
        this.exitCode = options.exitCode
    }
}

async function generate(prompt) {
    const task = grokQueue.then(() => runGrok(prompt))
    grokQueue = task.catch(() => {})
    return task
}

async function runGrok(prompt) {
    if (!aiConfig.grok.enabled) {
        throw new GrokServiceError('Grok is disabled.', {
            code: 'GROK_DISABLED',
            statusCode: 503,
            publicMessage: 'Grok is not enabled on this server. Set GROK_ENABLED=true and configure GROK_SCRAPER_PATH.'
        })
    }

    const scraperRoot = aiConfig.grok.scraperPath
    const scriptsDir = path.join(scraperRoot, 'scripts')
    const scrapeScript = path.join(scriptsDir, 'scrape.js')
    const outputFile = path.join(scraperRoot, 'output', 'latest.md')

    await assertFile(scrapeScript, {
        code: 'GROK_SCRIPT_MISSING',
        publicMessage: 'Grok scraper was not found. Check GROK_SCRAPER_PATH and make sure grok-scraper/scripts/scrape.js exists.'
    })

    const firstAttempt = await runScrapeProcess(scrapeScript, scriptsDir, prompt)
    const result = firstAttempt.exitCode === 3
        ? await runScrapeProcess(scrapeScript, scriptsDir, prompt)
        : firstAttempt

    if (result.timedOut) {
        throw new GrokServiceError('Grok timed out.', {
            code: 'GROK_TIMEOUT',
            statusCode: 504,
            publicMessage: 'Grok took too long to respond. Please try again, or switch back to llama3.2.',
            stdout: result.stdout,
            stderr: result.stderr
        })
    }

    if (result.exitCode === 2) {
        throw new GrokServiceError('Grok login session expired.', {
            code: 'GROK_LOGIN_REQUIRED',
            statusCode: 424,
            publicMessage: 'Grok needs a valid x.com browser session. Run `cd grok-scraper/scripts && npm run login`, sign in, then try again.',
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode
        })
    }

    if (result.exitCode !== 0) {
        throw new GrokServiceError('Grok scraper failed.', {
            code: 'GROK_SCRAPER_FAILED',
            statusCode: 503,
            publicMessage: 'Grok could not generate a response right now. Check the grok-scraper output logs, then try again.',
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode
        })
    }

    const reply = await readLatestReply(outputFile)
    if (!reply) {
        throw new GrokServiceError('Grok returned an empty response.', {
            code: 'GROK_EMPTY_RESPONSE',
            statusCode: 502,
            publicMessage: 'Grok finished but no response text was found in output/latest.md.'
        })
    }

    return reply
}

function runScrapeProcess(scrapeScript, cwd, prompt) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [scrapeScript, prompt], {
            cwd,
            windowsHide: true,
            env: process.env
        })

        let stdout = ''
        let stderr = ''
        let settled = false
        let timedOut = false

        const timer = setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
        }, aiConfig.grok.timeoutMs)

        child.stdout.on('data', (chunk) => {
            stdout = appendLimited(stdout, chunk)
        })

        child.stderr.on('data', (chunk) => {
            stderr = appendLimited(stderr, chunk)
        })

        child.on('error', (error) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve({
                exitCode: 1,
                stdout,
                stderr: appendLimited(stderr, error.message),
                timedOut
            })
        })

        child.on('close', (exitCode) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve({
                exitCode,
                stdout,
                stderr,
                timedOut
            })
        })
    })
}

async function assertFile(filePath, errorOptions) {
    try {
        const stat = await fs.stat(filePath)
        if (!stat.isFile()) throw new Error('Not a file')
    } catch {
        throw new GrokServiceError('Grok scraper file is missing.', {
            statusCode: 503,
            ...errorOptions
        })
    }
}

async function readLatestReply(outputFile) {
    const raw = await fs.readFile(outputFile, 'utf8')
    const parts = raw.split(/\n---\n/)
    const reply = String(parts.length > 1 ? parts.slice(1).join('\n---\n') : raw)
        .replace(/^# Grok AI Report\s*/i, '')
        .replace(/^_Generated:[^\n]*_\s*/i, '')
        .trim()
    return cleanGrokReply(reply)
}

function cleanGrokReply(reply) {
    const lines = String(reply || '').split(/\r?\n/)
    const cleaned = []

    lines.forEach((line) => {
        const trimmed = line.trim()
        if (isGrokProgressLine(trimmed)) return
        cleaned.push(line)
    })

    return cleaned
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function isGrokProgressLine(line) {
    if (!line) return false
    if (/^searching(?:\s+(?:the\s+web|on\s+x|x|web))?\s*$/i.test(line)) return true
    if (/^\d+\s+results?\s*$/i.test(line)) return true
    return false
}

function appendLimited(existing, chunk) {
    const combined = existing + String(chunk || '')
    return combined.length > 20000 ? combined.slice(combined.length - 20000) : combined
}

module.exports = {
    generate,
    cleanGrokReply,
    GrokServiceError
}
