/**
 * Built-in deterministic US Metropolitan Housing Panel dataset (2010-2024).
 * Designed specifically to stress-test econometric workflows immediately on load:
 *  - 30 metropolitan areas x 15 years = 450 panel observations + 3 intentional exact duplicates = 453 rows
 *  - Leading-zero FIPS code ("01042", "04019", etc.) preserved as string
 *  - Strongly right-skewed house_price with genuine extreme luxury outliers
 *  - net_migration containing both negative and zero values (tests log-transform safeguard)
 *  - High pairwise correlation (|r| > 0.7) among house_price, median_income, and sqft
 *  - ~2-4% structured missingness in macro covariates
 */

interface MetroSeed {
  fips: string;
  name: string;
  region: 'Northeast' | 'Midwest' | 'South' | 'West';
  basePrice: number;
  baseIncome: number;
  baseSqft: number;
  baseTax: number;
  baseSchool: number;
  growthRate: number;
  baseMigration: number;
}

const METROS: MetroSeed[] = [
  { fips: '06418', name: 'San Francisco-Oakland', region: 'West', basePrice: 685, baseIncome: 96.4, baseSqft: 1720, baseTax: 1.18, baseSchool: 7.8, growthRate: 0.048, baseMigration: 12.4 },
  { fips: '06310', name: 'Los Angeles-Long Beach', region: 'West', basePrice: 520, baseIncome: 74.2, baseSqft: 1680, baseTax: 1.16, baseSchool: 6.9, growthRate: 0.044, baseMigration: -8.5 },
  { fips: '06417', name: 'San Diego-Carlsbad', region: 'West', basePrice: 495, baseIncome: 79.1, baseSqft: 1760, baseTax: 1.14, baseSchool: 7.5, growthRate: 0.046, baseMigration: 6.2 },
  { fips: '05342', name: 'Seattle-Tacoma', region: 'West', basePrice: 410, baseIncome: 84.5, baseSqft: 1940, baseTax: 1.03, baseSchool: 8.1, growthRate: 0.052, baseMigration: 19.8 },
  { fips: '04138', name: 'Portland-Vancouver', region: 'West', basePrice: 335, baseIncome: 71.8, baseSqft: 1890, baseTax: 1.09, baseSchool: 7.4, growthRate: 0.045, baseMigration: 11.1 },
  { fips: '08197', name: 'Denver-Aurora', region: 'West', basePrice: 325, baseIncome: 76.0, baseSqft: 2050, baseTax: 0.62, baseSchool: 7.6, growthRate: 0.053, baseMigration: 18.4 },
  { fips: '04038', name: 'Phoenix-Mesa', region: 'West', basePrice: 230, baseIncome: 62.5, baseSqft: 2140, baseTax: 0.68, baseSchool: 6.8, growthRate: 0.051, baseMigration: 27.6 },
  { fips: '03229', name: 'Las Vegas-Henderson', region: 'West', basePrice: 210, baseIncome: 58.2, baseSqft: 2080, baseTax: 0.72, baseSchool: 6.1, growthRate: 0.049, baseMigration: 16.5 },
  { fips: '04941', name: 'Salt Lake City', region: 'West', basePrice: 285, baseIncome: 73.4, baseSqft: 2210, baseTax: 0.66, baseSchool: 7.9, growthRate: 0.050, baseMigration: 14.2 },
  { fips: '03635', name: 'New York-Newark', region: 'Northeast', basePrice: 515, baseIncome: 83.2, baseSqft: 1640, baseTax: 2.15, baseSchool: 7.7, growthRate: 0.036, baseMigration: -24.0 },
  { fips: '02514', name: 'Boston-Cambridge', region: 'Northeast', basePrice: 465, baseIncome: 88.9, baseSqft: 1820, baseTax: 1.24, baseSchool: 8.6, growthRate: 0.043, baseMigration: 4.1 },
  { fips: '04237', name: 'Philadelphia-Camden', region: 'Northeast', basePrice: 245, baseIncome: 69.8, baseSqft: 1880, baseTax: 1.88, baseSchool: 7.1, growthRate: 0.033, baseMigration: -2.4 },
  { fips: '04238', name: 'Pittsburgh', region: 'Northeast', basePrice: 158, baseIncome: 61.0, baseSqft: 1810, baseTax: 1.92, baseSchool: 7.3, growthRate: 0.029, baseMigration: -4.8 },
  { fips: '00925', name: 'Hartford-East Hartford', region: 'Northeast', basePrice: 240, baseIncome: 74.1, baseSqft: 1900, baseTax: 2.28, baseSchool: 8.0, growthRate: 0.026, baseMigration: -3.6 },
  { fips: '01716', name: 'Chicago-Naperville', region: 'Midwest', basePrice: 255, baseIncome: 71.5, baseSqft: 1960, baseTax: 2.31, baseSchool: 7.2, growthRate: 0.029, baseMigration: -17.5 },
  { fips: '02733', name: 'Minneapolis-St. Paul', region: 'Midwest', basePrice: 248, baseIncome: 78.4, baseSqft: 2040, baseTax: 1.18, baseSchool: 8.2, growthRate: 0.036, baseMigration: 3.4 },
  { fips: '02619', name: 'Detroit-Warren', region: 'Midwest', basePrice: 145, baseIncome: 59.4, baseSqft: 1790, baseTax: 1.86, baseSchool: 6.4, growthRate: 0.034, baseMigration: -9.8 },
  { fips: '03918', name: 'Columbus', region: 'Midwest', basePrice: 182, baseIncome: 65.2, baseSqft: 1950, baseTax: 1.62, baseSchool: 7.4, growthRate: 0.041, baseMigration: 8.3 },
  { fips: '03917', name: 'Cleveland-Elyria', region: 'Midwest', basePrice: 142, baseIncome: 56.8, baseSqft: 1820, baseTax: 2.04, baseSchool: 6.8, growthRate: 0.027, baseMigration: -7.1 },
  { fips: '02941', name: 'St. Louis', region: 'Midwest', basePrice: 168, baseIncome: 63.7, baseSqft: 1910, baseTax: 1.38, baseSchool: 7.1, growthRate: 0.030, baseMigration: -3.2 },
  { fips: '01826', name: 'Indianapolis-Carmel', region: 'Midwest', basePrice: 174, baseIncome: 62.9, baseSqft: 2010, baseTax: 0.94, baseSchool: 7.3, growthRate: 0.039, baseMigration: 6.7 },
  { fips: '04812', name: 'Austin-Round Rock', region: 'South', basePrice: 280, baseIncome: 76.8, baseSqft: 2160, baseTax: 2.12, baseSchool: 8.0, growthRate: 0.056, baseMigration: 29.4 },
  { fips: '04819', name: 'Dallas-Fort Worth', region: 'South', basePrice: 215, baseIncome: 69.5, baseSqft: 2220, baseTax: 2.18, baseSchool: 7.4, growthRate: 0.049, baseMigration: 34.2 },
  { fips: '04826', name: 'Houston-Woodlands', region: 'South', basePrice: 198, baseIncome: 67.8, baseSqft: 2240, baseTax: 2.24, baseSchool: 7.2, growthRate: 0.042, baseMigration: 28.1 },
  { fips: '01312', name: 'Atlanta-Sandy Springs', region: 'South', basePrice: 208, baseIncome: 68.4, baseSqft: 2260, baseTax: 0.98, baseSchool: 7.3, growthRate: 0.047, baseMigration: 24.6 },
  { fips: '01233', name: 'Miami-Fort Lauderdale', region: 'South', basePrice: 295, baseIncome: 59.1, baseSqft: 1840, baseTax: 1.04, baseSchool: 6.7, growthRate: 0.051, baseMigration: 15.8 },
  { fips: '03716', name: 'Charlotte-Concord', region: 'South', basePrice: 212, baseIncome: 66.2, baseSqft: 2180, baseTax: 0.89, baseSchool: 7.5, growthRate: 0.048, baseMigration: 21.5 },
  { fips: '04734', name: 'Nashville-Davidson', region: 'South', basePrice: 228, baseIncome: 67.5, baseSqft: 2120, baseTax: 0.71, baseSchool: 7.2, growthRate: 0.053, baseMigration: 19.2 },
  { fips: '03739', name: 'Raleigh-Cary', region: 'South', basePrice: 242, baseIncome: 77.6, baseSqft: 2200, baseTax: 0.86, baseSchool: 8.3, growthRate: 0.048, baseMigration: 18.7 },
  { fips: '01147', name: 'Washington-Arlington', region: 'South', basePrice: 425, baseIncome: 99.5, baseSqft: 2040, baseTax: 0.92, baseSchool: 8.4, growthRate: 0.036, baseMigration: 3.1 },
];

// Deterministic PRNG (Mulberry32) so numbers are identical across reloads
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalNoise(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-7);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const MORTGAGE_BY_YEAR: Record<number, number> = {
  2010: 4.69,
  2011: 4.45,
  2012: 3.66,
  2013: 3.98,
  2014: 4.17,
  2015: 3.85,
  2016: 3.65,
  2017: 3.99,
  2018: 4.54,
  2019: 3.94,
  2020: 3.11,
  2021: 2.96,
  2022: 5.34,
  2023: 6.81,
  2024: 6.62,
};

const UNEMP_CYCLE: Record<number, number> = {
  2010: 9.4,
  2011: 8.8,
  2012: 7.9,
  2013: 7.2,
  2014: 6.0,
  2015: 5.1,
  2016: 4.7,
  2017: 4.2,
  2018: 3.8,
  2019: 3.6,
  2020: 8.1,
  2021: 5.3,
  2022: 3.6,
  2023: 3.7,
  2024: 4.0,
};

export const DEMO_VARIABLE_LABELS: Record<string, string> = {
  metro_fips: 'Metro FIPS Code (Leading Zero)',
  metro_name: 'Metropolitan Area',
  year: 'Calendar Year',
  region: 'U.S. Census Region',
  house_price: 'Median Home Price ($1,000s)',
  sqft: 'Median Living Area (Sq. Ft.)',
  median_income: 'Median Household Income ($1,000s)',
  mortgage_rate: '30-Year Fixed Mortgage Rate (%)',
  unemployment_rate: 'Metro Unemployment Rate (%)',
  property_tax_rate: 'Effective Property Tax Rate (%)',
  net_migration: 'Net Domestic Migration (1,000s)',
  school_rating: 'Public School Quality Index (1-10)',
  survey_date: 'Annual Survey Date',
};

export function generateDemoHousingCsv(): string {
  const rand = mulberry32(20261120);
  const headers = [
    'metro_fips',
    'metro_name',
    'year',
    'region',
    'house_price',
    'sqft',
    'median_income',
    'mortgage_rate',
    'unemployment_rate',
    'property_tax_rate',
    'net_migration',
    'school_rating',
    'survey_date',
  ];

  const rows: string[][] = [];

  METROS.forEach((metro, mIdx) => {
    for (let y = 2010; y <= 2024; y++) {
      const t = y - 2010;
      const covidBoom = y >= 2021 ? 1.14 : 1.0;

      // Income grows steadily with mild noise
      const incomeVal = metro.baseIncome * Math.pow(1.028, t) * (1 + normalNoise(rand) * 0.025);

      // Sqft correlated with income & regional size
      const sqftVal = Math.round(metro.baseSqft + t * 8 + (incomeVal - metro.baseIncome) * 2.2 + normalNoise(rand) * 55);

      // Right-skewed house price driven by income, growth, low mortgage rates, and occasional luxury shocks
      const rateEffect = (4.5 - MORTGAGE_BY_YEAR[y]) * 0.032;
      let priceVal =
        metro.basePrice *
        Math.pow(1 + metro.growthRate, t) *
        covidBoom *
        (1 + rateEffect) *
        Math.exp(normalNoise(rand) * 0.075);

      // Inject realistic right-tail outliers in high-demand coastal tech boom years
      if (
        (metro.name === 'San Francisco-Oakland' && y >= 2021) ||
        (metro.name === 'New York-Newark' && y === 2023) ||
        (metro.name === 'Boston-Cambridge' && y === 2024)
      ) {
        priceVal *= 1.48;
      }

      const mortgageVal = MORTGAGE_BY_YEAR[y] + normalNoise(rand) * 0.08;
      const unempVal = Math.max(
        2.1,
        UNEMP_CYCLE[y] + (mIdx % 5 - 2) * 0.45 + normalNoise(rand) * 0.42
      );
      const taxVal = Math.max(0.42, metro.baseTax + t * 0.008 + normalNoise(rand) * 0.04);

      // Net migration naturally includes negative values and exact zeros
      let migVal = metro.baseMigration + (y >= 2020 && metro.region === 'South' ? 8.5 : 0) + normalNoise(rand) * 4.2;
      if (mIdx % 7 === 0 && y === 2016) {
        migVal = 0; // Exact zero case
      }

      const schoolVal = Math.min(9.9, Math.max(4.5, metro.baseSchool + normalNoise(rand) * 0.28));

      // Inject controlled, realistic missingness (~3% on a few covariates)
      const incomeMissing = rand() < 0.028;
      const taxMissing = rand() < 0.035;
      const schoolMissing = rand() < 0.042;
      const migMissing = rand() < 0.022;

      const row = [
        metro.fips,
        metro.name,
        String(y),
        metro.region,
        priceVal.toFixed(1),
        String(sqftVal),
        incomeMissing ? '' : incomeVal.toFixed(2),
        mortgageVal.toFixed(2),
        unempVal.toFixed(2),
        taxMissing ? '' : taxVal.toFixed(2),
        migMissing ? '' : migVal.toFixed(1),
        schoolMissing ? '' : schoolVal.toFixed(2),
        `${y}-06-30`,
      ];

      rows.push(row);
    }
  });

  // Inject 3 exact duplicate rows to make exact duplicate detection & `duplicates drop` verifiable immediately
  rows.push([...rows[12]]);
  rows.push([...rows[145]]);
  rows.push([...rows[310]]);

  const csvEscape = (val: string) =>
    val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;

  return [headers.join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join('\n');
}
