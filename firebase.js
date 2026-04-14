const mockDB = {
  collection: (_name) => ({
    orderBy: (_field, _direction) => ({
      get: async () => ({
        docs: []
      })
    }),
    doc: (_id) => ({
      delete: async () => {},
      get: async () => ({
        exists: true,
        data: () => ({ targetName: '', scannedAt: null })
      }),
      update: async (_data) => {}
    })
  })
};

module.exports = mockDB;
