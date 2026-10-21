import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500'],
})

export const metadata: Metadata = {
  title: 'ECF XML Validator',
  description:
    'Validate Dominican Republic e-CF invoice XML against official DGII XSD schemas. Highlights breaking errors, math discrepancies, and conditional warnings with human-readable messages.',
}

// Structured data (JSON-LD). Not visible to users; read by search engines.
// Describes the tool (WebApplication) and attributes it to Gary (Person), whose
// sameAs links tie this site to his LinkedIn/GitHub identity.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'ECF XML Validator',
      url: 'https://ecf-validator.garydelacruz.dev',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web',
      description:
        'Valida XML de comprobantes fiscales electrónicos (e-CF) de la DGII (República Dominicana) contra los esquemas XSD oficiales.',
      inLanguage: 'es',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@id': 'https://www.garydelacruz.dev/#person' },
      creator: { '@id': 'https://www.garydelacruz.dev/#person' },
    },
    {
      '@type': 'Person',
      '@id': 'https://www.garydelacruz.dev/#person',
      name: 'Gary De la Cruz',
      url: 'https://www.garydelacruz.dev',
      jobTitle: 'Full-Stack Software Developer',
      email: 'mailto:gary4gld@gmail.com',
      address: { '@type': 'PostalAddress', addressRegion: 'MA', addressCountry: 'US' },
      alumniOf: { '@type': 'CollegeOrUniversity', name: 'Westfield State University' },
      knowsAbout: [
        'C#', '.NET', 'TypeScript', 'Angular', 'Next.js', 'Python',
        'Azure Functions', 'Azure Logic Apps', 'ERPNext', 'Electronic invoicing (DGII e-CF)',
      ],
      knowsLanguage: ['English', 'Spanish'],
      sameAs: [
        'https://www.linkedin.com/in/gary-de-la-cruz-783895119/',
        'https://github.com/gary4gld',
      ],
    },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  )
}
