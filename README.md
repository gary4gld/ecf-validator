# DGII e-CF XML Validator

A client-side validator for **Dominican Republic DGII electronic invoice (e-CF) XML**. Paste or upload an e-CF and it checks the document against the official DGII **XSD schemas** and **Formato** rules, surfacing problems as human-readable, severity-ranked findings — before you ever submit to DGII.

**Live:** https://ecf-validator.garydelacruz.dev

Validation runs **entirely in the browser**. Submitted XML is never stored or sent anywhere, except an optional server-to-server RNC lookup (see below).

## What it checks

- **All DGII document types** — the 10 e-CF types (31, 32, 33, 34, 41, 43, 44, 45, 46, 47) plus RFCE, ACECF, ARECF and ANECF, each with its own schema and conditional rules.
- **Structure & required fields** — element order (XSD `xs:sequence`), required/forbidden fields per type, value tables and formats.
- **Math & totals** — per-line arithmetic (`Cantidad × Precio`), header totals, ITBIS/ISC, and foreign-currency (`OtraMoneda`) cross-rates.
- **Dates & signature** — GMT-4 handling for `FechaEmision`/`FechaHoraFirma`, and a *structural* digital-signature check (well-formed XMLDSig, non-empty values) — never a claim of cryptographic validity.
- **RNC** — checksum (9-digit mod-11 / 11-digit Luhn) plus a live DGII registry lookup (ACTIVO, Facturador Electrónico, padrón).
- **Business-context hints** — advisory notes derived from the emitter's registered economic activity.

Findings are ranked by severity — **error** (DGII rejection), **discrepancia** (math), **advertencia** (conditional), **nota** (informational) — plus a separate, non-blocking **Consideraciones** (advisory) lane. Click a finding to jump to its line; copy or export the full report as text or JSON.

## Tech

- **Next.js 16** (App Router) · **React 19** · **TypeScript**
- **Tailwind CSS v4**
- Deployed on **Vercel**
- Tests with **Vitest** + jsdom

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # run the test suite (62 tests)
npx tsc --noEmit   # type-check
```

The validators live in `lib/validators/`; each check is a small, independently testable function. The test suite exercises the real pipeline (beautify → detect type → validate).

## Author

Built by **Gary De la Cruz** — full-stack developer specializing in enterprise integrations and DGII e-CF compliance.
[garydelacruz.dev](https://www.garydelacruz.dev) · [LinkedIn](https://www.linkedin.com/in/gary-de-la-cruz-783895119/) · [GitHub](https://github.com/gary4gld)

## License

Free to use. A formal license is being finalized.
