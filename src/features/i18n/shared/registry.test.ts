import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALE_CODES,
  LOCALE_META,
  LOCALE_OPTIONS,
  type Locale,
} from './registry'

describe('registry', () => {
  describe('LOCALE_CODES', () => {
    it('should contain exactly en and ja', () => {
      expect(LOCALE_CODES).toHaveLength(2)
      expect(LOCALE_CODES).toContain('en')
      expect(LOCALE_CODES).toContain('ja')
    })

    it('should have no duplicate codes', () => {
      const uniqueCodes = new Set(LOCALE_CODES)
      expect(uniqueCodes.size).toBe(LOCALE_CODES.length)
    })

  })

  describe('DEFAULT_LOCALE', () => {
    it('should be en', () => {
      expect(DEFAULT_LOCALE).toBe('en')
    })

    it('should be a member of LOCALE_CODES', () => {
      expect((LOCALE_CODES as readonly string[]).includes(DEFAULT_LOCALE)).toBe(
        true,
      )
    })
  })

  describe('LOCALE_META', () => {
    it('should have entries for every code in LOCALE_CODES', () => {
      for (const code of LOCALE_CODES) {
        expect(LOCALE_META).toHaveProperty(code)
        expect(LOCALE_META[code]).toBeDefined()
      }
    })

    it('should have no entries not in LOCALE_CODES', () => {
      const metaKeys = Object.keys(LOCALE_META) as Locale[]
      for (const key of metaKeys) {
        expect((LOCALE_CODES as readonly string[]).includes(key)).toBe(true)
      }
      expect(metaKeys).toHaveLength(LOCALE_CODES.length)
    })

    describe('for each locale meta entry', () => {
      for (const code of LOCALE_CODES) {
        describe(`LOCALE_META.${code}`, () => {
          const meta = LOCALE_META[code]

          it('should have code matching the key', () => {
            expect(meta.code).toBe(code)
          })

          it('should have non-empty label', () => {
            expect(typeof meta.label).toBe('string')
            expect(meta.label.length).toBeGreaterThan(0)
          })

          it('should have non-empty nativeLabel', () => {
            expect(typeof meta.nativeLabel).toBe('string')
            expect(meta.nativeLabel.length).toBeGreaterThan(0)
          })

          it('should have valid text direction (ltr or rtl)', () => {
            expect(['ltr', 'rtl']).toContain(meta.dir)
          })

          it('should have intlTag accepted by Intl.DateTimeFormat', () => {
            expect(() => {
              new Intl.DateTimeFormat(meta.intlTag)
            }).not.toThrow()
          })

          it('should have intlTag accepted by Intl.getCanonicalLocales', () => {
            expect(() => {
              Intl.getCanonicalLocales(meta.intlTag)
            }).not.toThrow()
          })
        })
      }
    })

    describe('locale-specific checks', () => {
      it('ja.nativeLabel should be in Japanese (日本語)', () => {
        expect(LOCALE_META.ja.nativeLabel).toBe('日本語')
      })
    })
  })

  describe('LOCALE_OPTIONS', () => {
    it('should have the same length as LOCALE_CODES', () => {
      expect(LOCALE_OPTIONS).toHaveLength(LOCALE_CODES.length)
    })

    it('should be in the same order as LOCALE_CODES', () => {
      for (let i = 0; i < LOCALE_CODES.length; i++) {
        expect(LOCALE_OPTIONS[i].code).toBe(LOCALE_CODES[i])
      }
    })

    it('should contain the same metadata objects as LOCALE_META', () => {
      for (const code of LOCALE_CODES) {
        const optionEntry = LOCALE_OPTIONS.find((opt) => opt.code === code)
        expect(optionEntry).toBeDefined()
        expect(optionEntry).toBe(LOCALE_META[code])
      }
    })

  })
})
