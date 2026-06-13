/**
 * Province-level codes from ProvinciaMunicipioType (Tabla III, Formato eCF v1.0).
 * These are the XX0000 codes — one per province/Distrito Nacional.
 *
 * Used to validate: <Provincia>, <ProvinciaComprador>
 * PDF fields 26 and 45. Rule: "Validar con código de la Tabla III".
 *
 * Structure: first 2 digits = province number, last 4 digits always 0000.
 * The Dominican Republic has 31 provinces + the Distrito Nacional = 32 entries.
 *
 * Municipality and district codes live in municipio-codes.ts.
 */
export const PROVINCIA_CODES = new Set<string>([
  '010000', // DISTRITO NACIONAL
  '020000', // AZUA
  '030000', // BAHORUCO
  '040000', // BARAHONA
  '050000', // DAJABÓN
  '060000', // DUARTE
  '070000', // ELÍAS PIÑA
  '080000', // EL SEIBO
  '090000', // ESPAILLAT
  '100000', // INDEPENDENCIA
  '110000', // LA ALTAGRACIA
  '120000', // LA ROMANA
  '130000', // LA VEGA
  '140000', // MARÍA TRINIDAD SÁNCHEZ
  '150000', // MONTE CRISTI
  '160000', // PEDERNALES
  '170000', // PERAVIA
  '180000', // PUERTO PLATA
  '190000', // HERMANAS MIRABAL
  '200000', // SAMANÁ
  '210000', // SAN CRISTÓBAL
  '220000', // SAN JUAN
  '230000', // SAN PEDRO DE MACORÍS
  '240000', // SÁNCHEZ RAMÍREZ
  '250000', // SANTIAGO
  '260000', // SANTIAGO RODRÍGUEZ
  '270000', // VALVERDE
  '280000', // MONSEÑOR NOUEL
  '290000', // MONTE PLATA
  '300000', // HATO MAYOR
  '310000', // SAN JOSÉ DE OCOA
  '320000', // SANTO DOMINGO
])