const fs = require('fs/promises')
const path = require('path')
const { spawn } = require('child_process')
const { aiConfig, setGrokEnabled } = require('../../config/ai')

const setupState = {
    status: 'idle',
    phase: 'idle',
    message: '',
    error: '',
    startedAt: null,
    finishedAt: null,
    child: null,
    installChild: null,
    logs: []
}

async function getStatus() {
    const paths = getPaths()
    const [
        scraperPathExists,
        scriptsPathExists,
        packageJsonExists,
        dependenciesInstalled,
        loginScriptExists,
        sessionAvailable
    ] = await Promise.all([
        pathExists(paths.scraperRoot),
        pathExists(paths.scriptsDir),
        pathExists(paths.packageJson),
        pathExists(paths.playwrightDir),
        pathExists(paths.loginScript),
        hasSession(paths.sessionDir)
    ])

    return {
        enabled: aiConfig.grok.enabled,
        envEnabled: String(process.env.GROK_ENABLED || '').toLowerCase() === 'true',
        scraperPath: paths.scraperRoot,
        scraperPathExists,
        scriptsPathExists,
        packageJsonExists,
        dependenciesInstalled,
        loginScriptExists,
        sessionAvailable,
        interactiveAvailable: isInteractiveEnvironment(),
        ready: aiConfig.grok.enabled && scraperPathExists && dependenciesInstalled && sessionAvailable,
        setup: serializeSetupState()
    }
}

async function startSetup() {
    const current = await getStatus()

    if (!current.interactiveAvailable) {
        throw publicError('Grok login requires a local interactive desktop browser session. This server looks headless or non-interactive.')
    }

    if (!current.scraperPathExists || !current.scriptsPathExists || !current.packageJsonExists || !current.loginScriptExists) {
        throw publicError('Grok scraper files are missing. Check GROK_SCRAPER_PATH and make sure grok-scraper/scripts/login.js exists.')
    }

    if (setupState.child || setupState.installChild) {
        return serializeSetupState()
    }

    resetSetup('starting', 'Preparing Grok setup...')

    runSetupPipeline().catch((error) => {
        setupState.status = 'error'
        setupState.phase = 'error'
        setupState.error = error.publicMessage || error.message || 'Grok setup failed.'
        setupState.message = setupState.error
        setupState.finishedAt = new Date().toISOString()
        setupState.child = null
        setupState.installChild = null
        appendLog(setupState.error)
    })

    return serializeSetupState()
}

async function completeLogin() {
    if (!setupState.child) {
        throw publicError('No Grok login browser is currently waiting for completion.')
    }

    setupState.message = 'Saving browser session...'
    setupState.phase = 'saving-session'
    setupState.child.stdin.write('\n')
    return serializeSetupState()
}

async function setEnabled(enabled) {
    const status = await getStatus()
    if (enabled && (!status.scraperPathExists || !status.dependenciesInstalled || !status.sessionAvailable)) {
        throw publicError('Grok is not ready yet. Complete setup before enabling it.')
    }

    setGrokEnabled(Boolean(enabled))
    await updateEnvValue('GROK_ENABLED', enabled ? 'true' : 'false')
    return getStatus()
}

async function runSetupPipeline() {
    const paths = getPaths()
    const status = await getStatus()

    if (!status.dependenciesInstalled) {
        setupState.status = 'running'
        setupState.phase = 'installing'
        setupState.message = 'Installing Grok scraper dependencies...'
        await runInstall(paths.scriptsDir)
    }

    setupState.status = 'waiting-for-login'
    setupState.phase = 'login-browser'
    setupState.message = 'Browser launched. Sign in to x.com, then click "I finished signing in".'
    await runLogin(paths.loginScript, paths.scriptsDir)

    const sessionAvailable = await hasSession(paths.sessionDir)
    if (!sessionAvailable) {
        throw publicError('Grok login finished, but no browser session was found. Try setup again and complete sign-in before saving.')
    }

    setGrokEnabled(true)
    await updateEnvValue('GROK_ENABLED', 'true')

    setupState.status = 'ready'
    setupState.phase = 'ready'
    setupState.message = 'Grok is ready and enabled.'
    setupState.finishedAt = new Date().toISOString()
}

function runInstall(cwd) {
    return new Promise((resolve, reject) => {
        const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
        const child = spawn(command, ['install'], {
            cwd,
            windowsHide: false,
            shell: false
        })

        setupState.installChild = child
        attachProcessLogs(child)

        child.on('error', reject)
        child.on('close', (code) => {
            setupState.installChild = null
            if (code === 0) {
                resolve()
            } else {
                reject(publicError(`Dependency installation failed with exit code ${code}.`))
            }
        })
    })
}

function runLogin(loginScript, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [loginScript], {
            cwd,
            windowsHide: false,
            stdio: ['pipe', 'pipe', 'pipe']
        })

        setupState.child = child
        attachProcessLogs(child)

        child.on('error', reject)
        child.on('close', (code) => {
            setupState.child = null
            if (code === 0) {
                resolve()
            } else {
                reject(publicError(`Grok login exited with code ${code}.`))
            }
        })
    })
}

function attachProcessLogs(child) {
    child.stdout.on('data', (chunk) => appendLog(chunk))
    child.stderr.on('data', (chunk) => appendLog(chunk))
}

function appendLog(chunk) {
    const text = String(chunk || '').trim()
    if (!text) return
    setupState.logs.push(text)
    if (setupState.logs.length > 30) {
        setupState.logs.splice(0, setupState.logs.length - 30)
    }
}

function getPaths() {
    const scraperRoot = aiConfig.grok.scraperPath
    const scriptsDir = path.join(scraperRoot, 'scripts')
    return {
        scraperRoot,
        scriptsDir,
        packageJson: path.join(scriptsDir, 'package.json'),
        playwrightDir: path.join(scriptsDir, 'node_modules', 'playwright'),
        loginScript: path.join(scriptsDir, 'login.js'),
        sessionDir: path.join(scraperRoot, 'session')
    }
}

async function hasSession(sessionDir) {
    try {
        const entries = await fs.readdir(sessionDir, { withFileTypes: true })
        if (!entries.length) return false
        return entries.some((entry) => entry.name === 'Default' || entry.name === 'Local State' || entry.isDirectory())
    } catch {
        return false
    }
}

async function pathExists(target) {
    try {
        await fs.access(target)
        return true
    } catch {
        return false
    }
}

function isInteractiveEnvironment() {
    if (process.env.CI === 'true') return false
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false
    return true
}

function resetSetup(status, message) {
    setupState.status = status
    setupState.phase = status
    setupState.message = message
    setupState.error = ''
    setupState.startedAt = new Date().toISOString()
    setupState.finishedAt = null
    setupState.logs = []
}

function serializeSetupState() {
    return {
        status: setupState.status,
        phase: setupState.phase,
        message: setupState.message,
        error: setupState.error,
        startedAt: setupState.startedAt,
        finishedAt: setupState.finishedAt,
        running: Boolean(setupState.child || setupState.installChild),
        waitingForLogin: Boolean(setupState.child),
        logs: setupState.logs.slice(-8)
    }
}

async function updateEnvValue(key, value) {
    const envPath = path.join(__dirname, '..', '..', '.env')
    let content = ''

    try {
        content = await fs.readFile(envPath, 'utf8')
    } catch {
        content = ''
    }

    const line = `${key}=${value}`
    const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
    const next = pattern.test(content)
        ? content.replace(pattern, line)
        : `${content.trimEnd()}${content.trim() ? '\n' : ''}${line}\n`

    await fs.writeFile(envPath, next)
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function publicError(message) {
    const error = new Error(message)
    error.publicMessage = message
    return error
}

module.exports = {
    getStatus,
    startSetup,
    completeLogin,
    setEnabled
}
