import { describe, it, expect } from 'vitest'
import { isLocale, normalizeLocale } from './detect'

describe('detect', () => {
  describe('normalizeLocale', () => {
    it.each<[unknown, string]>([
      // Supported locale codes (lowercase)
      ['en', 'en'],
      ['ja', 'ja'],
      // Case normalization
      ['JA', 'ja'],
      ['Ja', 'ja'],
      ['EN', 'en'],
      ['eN', 'en'],
      // Region subtags (should extract language part)
      ['ja-JP', 'ja'],
      ['ja_JP', 'ja'],
      ['en-US', 'en'],
      ['en-GB', 'en'],
      ['en_GB', 'en'],
      // Whitespace handling
      [' ja ', 'ja'],
      ['  en  ', 'en'],
      ['\tja\n', 'ja'],
      // Unsupported locales (fallback to DEFAULT_LOCALE = 'en')
      ['fr', 'en'],
      ['de', 'en'],
      ['zh-CN', 'en'],
      ['es-ES', 'en'],
      // Empty and whitespace-only strings
      ['', 'en'],
      ['   ', 'en'],
      ['\t', 'en'],
      // Non-string types
      [null, 'en'],
      [undefined, 'en'],
      [42, 'en'],
      [0, 'en'],
      [-1, 'en'],
      [3.14, 'en'],
      // Objects and arrays
      [{}, 'en'],
      [{ locale: 'ja' }, 'en'],
      [[], 'en'],
      [['ja'], 'en'],
      // Booleans
      [true, 'en'],
      [false, 'en'],
    ])('normalizeLocale(%j) should return %j', (input, expected) => {
      expect(normalizeLocale(input)).toBe(expected)
    })
  })

  describe('isLocale', () => {
    it.each<[unknown, boolean]>([
      // Valid locales (must match exactly)
      ['en', true],
      ['ja', true],
      // Case-sensitive (uppercase not accepted)
      ['EN', false],
      ['JA', false],
      ['Ja', false],
      ['En', false],
      // Region subtags not accepted as-is
      ['ja-JP', false],
      ['ja_JP', false],
      ['en-US', false],
      ['en-GB', false],
      // Unsupported locales
      ['fr', false],
      ['de', false],
      ['zh', false],
      // Empty and whitespace
      ['', false],
      ['   ', false],
      // Non-string types
      [null, false],
      [undefined, false],
      [0, false],
      [1, false],
      [42, false],
      [3.14, false],
      [{}, false],
      [{ locale: 'en' }, false],
      [[], false],
      [['en'], false],
      [true, false],
      [false, false],
    ])('isLocale(%j) should return %j', (input, expected) => {
      expect(isLocale(input)).toBe(expected)
    })

    // Type guard validation: check that isLocale narrows properly
    it('should act as a type guard', () => {
      const value: unknown = 'en'

      if (isLocale(value)) {
        // TypeScript should recognize value as Locale here
        const locale = value
        expect(locale).toBe('en')
      }
    })
  })
})
