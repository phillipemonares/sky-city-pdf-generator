import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { ActivityStatementRow } from '@/types/player-data';

const ACTIVITY_COLUMNS: Array<{ header: string; key: keyof ActivityStatementRow }> = [
  { header: 'Acct', key: 'acct' },
  { header: 'Title', key: 'title' },
  { header: 'FirstName', key: 'firstName' },
  { header: 'LastName', key: 'lastName' },
  { header: 'Email', key: 'email' },
  { header: 'Address', key: 'address' },
  { header: 'Suburb', key: 'suburb' },
  { header: 'State', key: 'state' },
  { header: 'PostCode', key: 'postCode' },
  { header: 'Country', key: 'country' },
  { header: 'PlayerType', key: 'playerType' },
  { header: 'EmailTick', key: 'emailTick' },
  { header: 'PostalTick', key: 'postalTick' },
  { header: 'KioskTick', key: 'kioskTick' },
  { header: 'Gaming Days', key: 'gamingDays' },
  { header: 'Total Turnover', key: 'totalTurnover' },
  { header: 'Player Win', key: 'playerWin' },
  { header: 'Total Amount Won', key: 'totalAmountWon' },
  { header: 'Total Time Spent - Hour', key: 'totalTimeSpentHour' },
  { header: 'Total Time Spent - Minute', key: 'totalTimeSpentMinute' },
  { header: 'Month 1 name', key: 'month1Name' },
  { header: 'Month 1 Total Amount Bet', key: 'month1TotalAmountBet' },
  { header: 'Month 1 No days gambled', key: 'month1NoDaysGambled' },
  { header: 'Month 1 Net Amount Won or (Lost)', key: 'month1NetAmountWonOrLost' },
  { header: 'Month 1 Time Spent - Hour', key: 'month1TimeSpentHour' },
  { header: 'Month 1 Time Spent - Minute', key: 'month1TimeSpentMinute' },
  { header: 'Month 2 name', key: 'month2Name' },
  { header: 'Month 2 Total Amount Bet', key: 'month2TotalAmountBet' },
  { header: 'Month 2 No days gambled', key: 'month2NoDaysGambled' },
  { header: 'Month 2 Net Amount Won or (Lost)', key: 'month2NetAmountWonOrLost' },
  { header: 'Month 2 Time Spent - Hour', key: 'month2TimeSpentHour' },
  { header: 'Month 2 Time Spent - Minute', key: 'month2TimeSpentMinute' },
  { header: 'Month 3 name', key: 'month3Name' },
  { header: 'Month 3 Total Amount Bet', key: 'month3TotalAmountBet' },
  { header: 'Month 3 No days gambled', key: 'month3NoDaysGambled' },
  { header: 'Month 3 Net Amount Won or (Lost)', key: 'month3NetAmountWonOrLost' },
  { header: 'Month 3 Time Spent - Hour', key: 'month3TimeSpentHour' },
  { header: 'Month 3 Time Spent - Minute', key: 'month3TimeSpentMinute' },
  { header: 'Channel_Tag', key: 'channelTag' },
];

const normalizeHeader = (value: unknown): string =>
  (value ?? '').toString().trim();

const hasRowData = (row: unknown[]): boolean =>
  Array.isArray(row) && row.some(cell => (cell ?? '').toString().trim() !== '');

function mapRowToActivity(row: string[], headers: string[]): ActivityStatementRow {
  // Debug: Log all headers to identify template columns
  if (headers.length > 30) { // Only log for the first row to avoid spam
    console.log('Available headers:', headers.filter(h => h && h.toLowerCase().includes('month')));
  }
  
  const record: ActivityStatementRow = {
    acct: '',
    title: '',
    firstName: '',
    lastName: '',
    email: '',
    address: '',
    suburb: '',
    state: '',
    postCode: '',
    country: '',
    playerType: '',
    emailTick: '',
    postalTick: '',
    kioskTick: '',
    gamingDays: '',
    totalTurnover: '',
    playerWin: '',
    totalAmountWon: '',
    totalTimeSpentHour: '',
    totalTimeSpentMinute: '',
    month1Name: '',
    month1TotalAmountBet: '',
    month1NoDaysGambled: '',
    month1NetAmountWonOrLost: '',
    month1TimeSpentHour: '',
    month1TimeSpentMinute: '',
    month2Name: '',
    month2TotalAmountBet: '',
    month2NoDaysGambled: '',
    month2NetAmountWonOrLost: '',
    month2TimeSpentHour: '',
    month2TimeSpentMinute: '',
    month3Name: '',
    month3TotalAmountBet: '',
    month3NoDaysGambled: '',
    month3NetAmountWonOrLost: '',
    month3TimeSpentHour: '',
    month3TimeSpentMinute: '',
    channelTag: '',
  };

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    const column = ACTIVITY_COLUMNS.find(col => col.header === normalized);
    if (!column) {
      return;
    }
    record[column.key] = row[index] ? String(row[index]).trim() : '';
  });

  // Look for template month name columns and prioritize them over regular month name columns
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    const cellValue = row[index] ? String(row[index]).trim() : '';
    const lowerHeader = normalized.toLowerCase();
    
    // Check for various template month name column patterns
    if (
      // Pattern: "Month 1 template name" or "Month 1 Template Name"
      (lowerHeader.includes('month 1') && lowerHeader.includes('template') && lowerHeader.includes('name')) ||
      // Pattern: "Template Month 1 Name" 
      (lowerHeader.includes('template') && lowerHeader.includes('month 1') && lowerHeader.includes('name')) ||
      // Pattern: "M1 Template Name" or similar abbreviations
      (lowerHeader.includes('m1') && lowerHeader.includes('template') && lowerHeader.includes('name')) ||
      // Pattern: Any column with "1" and "template" that contains actual month names like "January", "February", etc.
      (lowerHeader.includes('1') && lowerHeader.includes('template') && 
       (cellValue === 'January' || cellValue === 'February' || cellValue === 'March' || 
        cellValue === 'April' || cellValue === 'May' || cellValue === 'June' ||
        cellValue === 'July' || cellValue === 'August' || cellValue === 'September' ||
        cellValue === 'October' || cellValue === 'November' || cellValue === 'December'))
    ) {
      record.month1Name = cellValue;
      console.log(`Found Month 1 template: "${normalized}" = "${cellValue}"`);
    } else if (
      (lowerHeader.includes('month 2') && lowerHeader.includes('template') && lowerHeader.includes('name')) ||
      (lowerHeader.includes('template') && lowerHeader.includes('month 2') && lowerHeader.includes('name')) ||
      (lowerHeader.includes('m2') && lowerHeader.includes('template') && lowerHeader.includes('name')) ||
      (lowerHeader.includes('2') && lowerHeader.includes('template') && 
       (cellValue === 'January' || cellValue === 'February' || cellValue === 'March' || 
        cellValue === 'April' || cellValue === 'May' || cellValue === 'June' ||
        cellValue === 'July' || cellValue === 'August' || cellValue === 'September' ||
        cellValue === 'October' || cellValue === 'November' || cellValue === 'December'))
    ) {
      record.month2Name = cellValue;
      console.log(`Found Month 2 template: "${normalized}" = "${cellValue}"`);
    } else if (
      (lowerHeader.includes('month 3') && lowerHeader.includes('template') && lowerHeader.includes('name')) ||
      (lowerHeader.includes('template') && lowerHeader.includes('month 3') && lowerHeader.includes('name')) ||
      (lowerHeader.includes('m3') && lowerHeader.includes('template') && lowerHeader.includes('name')) ||
      (lowerHeader.includes('3') && lowerHeader.includes('template') && 
       (cellValue === 'January' || cellValue === 'February' || cellValue === 'March' || 
        cellValue === 'April' || cellValue === 'May' || cellValue === 'June' ||
        cellValue === 'July' || cellValue === 'August' || cellValue === 'September' ||
        cellValue === 'October' || cellValue === 'November' || cellValue === 'December'))
    ) {
      record.month3Name = cellValue;
      console.log(`Found Month 3 template: "${normalized}" = "${cellValue}"`);
    }
  });

  return record;
}

export function parseActivityExcel(file: File): Promise<ActivityStatementRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        let worksheet: XLSX.WorkSheet | null = null;

        for (const name of workbook.SheetNames) {
          const candidate = workbook.Sheets[name];
          if (candidate['!ref']) {
            worksheet = candidate;
            break;
          }
        }

        if (!worksheet) {
          throw new Error('No worksheet found in activity workbook');
        }

        const rawRows = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: ''
        }) as unknown[][];

        const headerRowIndex = rawRows.findIndex(row =>
          Array.isArray(row) && normalizeHeader(row[0]) === 'Acct'
        );

        if (headerRowIndex === -1) {
          throw new Error('Could not find activity header row (Acct column)');
        }

        const headers = (rawRows[headerRowIndex] as string[]).map(cell => String(cell));
        const dataRows = rawRows.slice(headerRowIndex + 1)
          .filter(hasRowData)
          .map(row => (row as string[]));

        const activities = dataRows
          .map(row => mapRowToActivity(row, headers))
          .filter(record => record.acct);

        resolve(activities);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read activity workbook'));
    reader.readAsBinaryString(file);
  });
}

export function parseActivityCSV(file: File): Promise<ActivityStatementRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const result = Papa.parse<Record<string, string>>(content, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
        });

        if (result.errors.length > 0) {
          console.warn('Activity CSV parsing errors:', result.errors);
        }

        const activities = (result.data ?? []).map((row) => {
          const headers = ACTIVITY_COLUMNS.map(col => col.header);
          const line = headers.map(header => row[header] ?? '');
          return mapRowToActivity(line, headers);
        }).filter(record => record.acct);

        resolve(activities);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read activity CSV file'));
    reader.readAsText(file);
  });
}

export function validateActivityFile(file: File): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!file) {
    errors.push('No file provided');
    return { isValid: false, errors };
  }

  const validExtensions = ['.xlsx', '.csv'];
  const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  if (!validExtensions.includes(extension)) {
    errors.push('Activity statement must be .xlsx or .csv format');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
