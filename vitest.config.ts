import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Project root (this config file's directory). Mirrors the tsconfig "@/*" -> "./*" alias
// so tests import modules exactly the way the app does (e.g. "@/lib/validators/validator").
const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: { '@': rootDir },
  },
  test: {
    // The validators (item-checks, sequence-checks, xml-beautifier) use the browser
    // DOMParser/XMLSerializer. jsdom provides those globals under Node.
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
})
