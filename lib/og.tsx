import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Shared renderer for every route's share image (1200×630 — the size LinkedIn,
// X, Slack, and WhatsApp all expect). Rendered once at build time and cached.

export const ogSize = { width: 1200, height: 630 }
export const ogContentType = 'image/png'

type OgProps = {
  eyebrow: string
  title: string
  subtitle: string
}

async function font(file: string) {
  return readFile(join(process.cwd(), 'assets/fonts', file))
}

export async function renderOgImage({ eyebrow, title, subtitle }: OgProps) {
  const [serif, sans, sansMedium] = await Promise.all([
    font('InstrumentSerif-Regular.woff'),
    font('DMSans-Regular.woff'),
    font('DMSans-Medium.woff'),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          backgroundColor: '#030712',
          backgroundImage:
            'radial-gradient(ellipse 70% 80% at 10% 90%, rgba(59,130,246,0.22) 0%, rgba(3,7,18,0) 70%)',
          fontFamily: 'DM Sans',
          color: '#ffffff',
        }}
      >
        {/* Top row: eyebrow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#10b981' }} />
          <div style={{ fontSize: 26, color: '#9ca3af', fontWeight: 500 }}>{eyebrow}</div>
        </div>

        {/* Title + subtitle */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontFamily: 'Instrument Serif',
              fontSize: title.length > 28 ? 76 : 96,
              lineHeight: 1.05,
              letterSpacing: '-0.01em',
              marginBottom: 28,
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 30, lineHeight: 1.45, color: '#9ca3af', maxWidth: 940 }}>
            {subtitle}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(255,255,255,0.12)',
            paddingTop: 28,
            fontSize: 24,
          }}
        >
          <div style={{ color: '#e5e7eb', fontWeight: 500 }}>Gary De la Cruz</div>
          <div style={{ color: '#60a5fa' }}>garydelacruz.dev</div>
        </div>
      </div>
    ),
    {
      ...ogSize,
      fonts: [
        { name: 'Instrument Serif', data: serif, style: 'normal', weight: 400 },
        { name: 'DM Sans', data: sans, style: 'normal', weight: 400 },
        { name: 'DM Sans', data: sansMedium, style: 'normal', weight: 500 },
      ],
    }
  )
}
