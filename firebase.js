const mockDB = {
  collection: (name) => ({
    orderBy: (field, direction) => ({
      get: async () => ({
        docs: []
      })
    }),
    doc: (id) => ({
      delete: async () => {},
      get: async () => ({
        exists: true,
        data: () => ({ targetName: '', scannedAt: null })
      }),
      update: async (data) => {}
    })
  })
};

module.exports = mockDB;