import { expect, test } from 'claude-code/testing'
import { toChunks } from '../hooks/register'

test('strips code, links and markdown, keeps the words', () => {
  const out = toChunks('# Title\n\nSee [the docs](http://x.io) now.\n\n```ts\nconst a = 1\n```\n\n- **Bold** point.')
  expect(out.join(' ')).toBe('Title See the docs now. Bold point.')
})

test('long replies split into chunks under the limit', () => {
  const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
  const out = toChunks(long)
  expect(out.length).toBeGreaterThan(1)
  expect(out.every(c => c.length < 300)).toBe(true)
})
