const PROVIDER_CONFIG = {
  openai: {
    label: 'OpenAI-compatible',
    minLength: 16,
    prefixes: []
  },
  xai: {
    label: 'xAI',
    minLength: 20,
    prefixes: []
  },
  claude: {
    label: 'Claude',
    minLength: 20,
    prefixes: ['sk-ant-']
  },
  gemini: {
    label: 'Gemini',
    minLength: 30,
    prefixes: ['AIza']
  }
};

function normalizeApiKey(value) {
  return String(value || '').trim();
}

function maskApiKey(value) {
  const normalized = normalizeApiKey(value);
  if (!normalized) return '';

  const suffix = normalized.slice(-4);
  return `****${suffix}`;
}

function validateApiKey(provider, value) {
  const normalized = normalizeApiKey(value);
  const config = PROVIDER_CONFIG[provider];

  if (!config) {
    return {
      ok: false,
      error: 'Unknown AI provider.'
    };
  }

  if (!normalized) {
    return {
      ok: false,
      error: `${config.label} API key is required.`
    };
  }

  if (/\s/.test(normalized)) {
    return {
      ok: false,
      error: `${config.label} API key cannot contain spaces.`
    };
  }

  if (normalized.length < config.minLength) {
    return {
      ok: false,
      error: `${config.label} API key looks too short.`
    };
  }

  if (/(your[_-\s]?key|placeholder|changeme|example)/i.test(normalized)) {
    return {
      ok: false,
      error: `${config.label} API key is not valid.`
    };
  }

  if (config.prefixes.length && !config.prefixes.some((prefix) => normalized.startsWith(prefix))) {
    return {
      ok: false,
      error: `${config.label} API key format is invalid.`
    };
  }

  return {
    ok: true,
    value: normalized,
    masked: maskApiKey(normalized)
  };
}

function buildKeyStatus(value) {
  const normalized = normalizeApiKey(value);
  return {
    connected: Boolean(normalized),
    masked: normalized ? maskApiKey(normalized) : ''
  };
}

module.exports = {
  validateApiKey,
  maskApiKey,
  buildKeyStatus
};
