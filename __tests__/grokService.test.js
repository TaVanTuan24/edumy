const { cleanGrokReply } = require('../services/ai/grokService')

describe('cleanGrokReply', () => {
  test('removes Grok search progress lines while preserving answer markdown', () => {
    const raw = [
      'Searching the web',
      '',
      '25 results',
      '',
      'Searching on X',
      '',
      '4 results',
      '',
      '## Final answer',
      '',
      '- Keep this bullet',
      '- Keep **markdown**'
    ].join('\n')

    expect(cleanGrokReply(raw)).toBe([
      '## Final answer',
      '',
      '- Keep this bullet',
      '- Keep **markdown**'
    ].join('\n'))
  })

  test('does not remove ordinary content containing result wording', () => {
    const raw = [
      'The search results suggest a few tradeoffs.',
      '',
      'There are 25 results in the benchmark table.'
    ].join('\n')

    expect(cleanGrokReply(raw)).toBe(raw)
  })
})
