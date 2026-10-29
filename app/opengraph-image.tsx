import { renderOgImage, ogSize, ogContentType } from '@/lib/og'

// Share card (1200×630) shown when ecf-validator.garydelacruz.dev is linked on
// LinkedIn, X, Slack, WhatsApp, etc. Rendered once at build time. Matches the
// portfolio's brand (same renderer + fonts).

export const alt = 'ECF XML Validator — free tool by Gary De la Cruz'
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return renderOgImage({
    eyebrow: 'Free to use · Live',
    title: 'ECF XML Validator',
    subtitle:
      'Checks Dominican e-CF invoice XML against DGII schemas and 60+ business rules — and explains every issue in plain language.',
  })
}
