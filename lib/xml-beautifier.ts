/**
 * Formats a compact XML string into a human-readable, indented representation.
 *
 * Strategy:
 *   1. Extract the <?xml ...?> declaration if present.
 *   2. Parse the body through DOMParser for accuracy.
 *   3. Serialize back with consistent 4-space indentation.
 *   4. Fall back to a simpler tokenizer if the DOM parse fails.
 *
 * This runs client-side only — DOMParser is a browser API.
 */

const INDENT = '    ' // 4 spaces

export function beautifyXml(xmlString: string): string {
  const input = xmlString.trim()

  // Pull out the XML declaration so DOMParser doesn't choke on it
  const declMatch = input.match(/^<\?xml[^?]*\?>\s*/i)
  const declaration = declMatch ? declMatch[0].trimEnd() : null
  const body = declaration ? input.slice(declMatch![0].length).trim() : input

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(body, 'application/xml')

    // DOMParser signals errors via a <parseerror> element
    if (doc.querySelector('parseerror')) {
      return fallbackBeautify(input)
    }

    const lines: string[] = []
    if (declaration) lines.push(declaration)
    serializeElement(doc.documentElement, 0, lines)
    return lines.join('\n')
  } catch {
    return fallbackBeautify(input)
  }
}

// ── DOM serializer ─────────────────────────────────────────────────────────────

function serializeElement(el: Element, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth)
  const tag = el.tagName

  // Attributes
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}="${a.value}"`)
    .join(' ')
  const attrStr = attrs ? ` ${attrs}` : ''

  const childElements = Array.from(el.childNodes).filter(
    (n) => n.nodeType === Node.ELEMENT_NODE,
  ) as Element[]

  const textNodes = Array.from(el.childNodes).filter(
    (n) => n.nodeType === Node.TEXT_NODE,
  )
  const textContent = textNodes
    .map((n) => (n.textContent ?? '').trim())
    .filter(Boolean)
    .join('')

  // Empty element → self-closing
  if (el.childNodes.length === 0) {
    out.push(`${pad}<${tag}${attrStr}/>`)
    return
  }

  // Text-only → single line
  if (childElements.length === 0 && textContent) {
    out.push(`${pad}<${tag}${attrStr}>${textContent}</${tag}>`)
    return
  }

  // Mixed or element children → block format
  out.push(`${pad}<${tag}${attrStr}>`)
  childElements.forEach((child) => serializeElement(child, depth + 1, out))
  out.push(`${pad}</${tag}>`)
}

// ── String-based fallback ──────────────────────────────────────────────────────
// Used when DOMParser can't produce a valid tree (e.g. genuinely malformed XML).
// Output is best-effort; the validator will still flag the parse error.

function fallbackBeautify(xml: string): string {
  const lines: string[] = []
  let depth = 0

  // Separate the stream into text and tag tokens
  const tokens = xml.split(/(<[^>]+>)/g)

  for (const token of tokens) {
    const t = token.trim()
    if (!t) continue

    if (t.startsWith('</')) {
      depth = Math.max(0, depth - 1)
      lines.push(INDENT.repeat(depth) + t)
    } else if (t.startsWith('<?') || t.startsWith('<!')) {
      lines.push(t)
    } else if (t.endsWith('/>')) {
      lines.push(INDENT.repeat(depth) + t)
    } else if (t.startsWith('<') && t.includes('</')) {
      // Self-contained inline element: <Tag>value</Tag>
      lines.push(INDENT.repeat(depth) + t)
    } else if (t.startsWith('<')) {
      lines.push(INDENT.repeat(depth) + t)
      depth++
    } else {
      // Text content — append to the previous line rather than creating a new one
      if (lines.length > 0) {
        lines[lines.length - 1] += t
      }
    }
  }

  return lines.join('\n')
}