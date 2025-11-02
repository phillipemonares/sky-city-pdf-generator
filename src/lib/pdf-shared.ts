export const COMMON_STYLES = `
  @media print {
    * {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
    }
    .page {
      margin: 0 !important;
    }
    @supports (-webkit-touch-callout: none) {
      @page { margin: 0; }
    }
  }

  @page {
    size: A4 portrait;
    margin: 0;
  }

  * {
    box-sizing: border-box;
  }

  body {
    font-family: 'Montserrat', Arial, sans-serif;
    font-size: 12px;
    line-height: 1.4;
    color: #000;
    background: white;
    margin: 0;
  }

  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: white;
    padding: 40px;
    position: relative;
  }

  .page-break {
    page-break-before: always;
  }

  .logo {
    margin-bottom: 20px;
  }

  .logo img {
    height: 60px;
    width: auto;
  }

  .text-logo {
    font-size: 24px;
    font-weight: 700;
    color: #000;
  }

  .member-info {
    text-align: right;
    margin-bottom: 20px;
  }

  .member-number {
    color: #008000;
    font-weight: 600;
  }
`;

export const normalizeAccount = (value?: string | null): string =>
  (value ?? '').toString().trim();

export const formatAccounting = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  const raw = String(value).trim();
  if (raw === '') return '-';
  const cleaned = raw.replace(/,/g, '').replace(/\$/g, '');
  const num = Number(cleaned);
  if (Number.isNaN(num)) return '-';
  const abs = Math.abs(num);
  const absStr = new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(abs);
  return num < 0 ? `-(${absStr})` : absStr;
};

export const formatCurrency = (value: unknown): string => {
  const formatted = formatAccounting(value);
  return formatted === '-' ? '-' : `$${formatted}`;
};

export const sanitizeNumber = (value: unknown): string => {
  const raw = (value ?? '').toString().trim();
  return raw !== '' ? raw : '-';
};

export const sanitizeText = (value: unknown): string => {
  const raw = (value ?? '').toString().trim();
  return raw;
};

export const wrapNegativeValue = (value: string): string => {
  if (!value) {
    return value;
  }

  if (/<span[^>]*negative-value/.test(value)) {
    return value;
  }

  const plain = value.replace(/<[^>]*>/g, '').trim();
  if (!plain || plain === '-' || plain === '–') {
    return value;
  }

  const normalized = plain.replace(/[,$\s]/g, '');
  const isNegative = plain.includes('-(') || normalized.startsWith('-');

  return isNegative ? `<span class="negative-value">${value}</span>` : value;
};

export const formatUnitValue = (value: unknown, unit: string): string | null => {
  const raw = sanitizeText(value);
  if (!raw) {
    return null;
  }
  const numeric = Number(raw.replace(/,/g, ''));
  if (!Number.isNaN(numeric)) {
    if (numeric === 0) {
      return null;
    }
    return `${numeric} ${unit}`;
  }
  return raw;
};

export const formatExcelTime = (value: unknown): string | null => {
  const raw = sanitizeText(value);
  if (!raw) {
    return null;
  }
  if (/^\d{1,2}:\d{2}(\s*[AP]M)?$/i.test(raw)) {
    return raw;
  }
  const numeric = Number(raw.replace(/,/g, ''));
  if (Number.isNaN(numeric)) {
    return raw;
  }
  let fraction = numeric % 1;
  if (fraction < 0) {
    fraction = (fraction + 1) % 1;
  }
  const totalMinutes = Math.round(fraction * 24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
};

export const getQuarterStartDate = (quarter: number, year: number): string => {
  const startMonths = [1, 4, 7, 10];
  const month = startMonths[Math.max(0, Math.min(startMonths.length - 1, quarter - 1))] ?? 1;
  return `01/${month.toString().padStart(2, '0')}/${year}`;
};

export const getQuarterEndDate = (quarter: number, year: number): string => {
  const endMonths = [3, 6, 9, 12];
  const month = endMonths[Math.max(0, Math.min(endMonths.length - 1, quarter - 1))] ?? 3;
  const daysInMonth = new Date(year, month, 0).getDate();
  return `${daysInMonth.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
};

export const getQuarterMonths = (quarter: number, year: number): { name: string; month: number }[] => {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const startMonths = [1, 4, 7, 10];
  const startMonth = startMonths[Math.max(0, Math.min(startMonths.length - 1, quarter - 1))] ?? 1;

  return [
    { name: monthNames[startMonth - 1], month: startMonth },
    { name: monthNames[startMonth], month: startMonth + 1 },
    { name: monthNames[startMonth + 1], month: startMonth + 2 }
  ];
};

