const DEFAULT_MODEL = ''
const MODEL_CATALOG = []

function getCatalogModels() {
    return []
}

function getCatalogModel(model) {
    const value = String(model || '').trim().slice(0, 200)
    return {
        id: value,
        label: value,
        apiModel: value,
        providerKey: 'user-defined',
        requiresKey: 'apiKeyEncrypted',
        enabled: true
    }
}

module.exports = {
    DEFAULT_MODEL,
    MODEL_CATALOG,
    getCatalogModels,
    getCatalogModel
}
