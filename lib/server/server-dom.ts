/**
 * Server-side DOM shim.
 *
 * The validation pipeline relies on browser globals — the xml-beautifier uses
 * `DOMParser` and `Node`, and the sequence/item checks use `window.DOMParser` —
 * and deliberately skips (returns null/[]) when they're absent, so a naive run
 * on the Node runtime would silently drop those layers. To run the *full*
 * pipeline on the server exactly as the browser and the jsdom-based test suite
 * do, we install those globals from one jsdom window, once per process.
 *
 * Node runtime only (jsdom needs Node APIs). Idempotent and lazy — the jsdom
 * import only happens the first time an API route actually validates.
 */
let ready = false

export async function ensureServerDom(): Promise<void> {
  if (ready) return

  // A real browser or the jsdom test environment already provides these.
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { DOMParser?: unknown }).DOMParser
  ) {
    ready = true
    return
  }

  const { JSDOM } = await import('jsdom')
  const { window: w } = new JSDOM('<!doctype html><html><body></body></html>')

  const g = globalThis as unknown as Record<string, unknown>
  g.window = w // validators read window.DOMParser
  g.DOMParser = w.DOMParser // beautifier uses the bare global
  g.Node = w.Node // beautifier uses Node.ELEMENT_NODE / Node.TEXT_NODE

  ready = true
}
