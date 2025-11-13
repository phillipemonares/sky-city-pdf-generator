import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {
  PreCommitmentPlayer,
  PreCommitmentCSVRow,
  PlayerInfo,
  PreCommitmentSessionSummary,
} from '@/types/player-data';

interface TransformOptions {
  filterNoPlay?: boolean;
}

const DEFAULT_OPTIONS: TransformOptions = {
  filterNoPlay: true,
};

const normalizeHeaderName = (value: unknown): string =>
  (value ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

const normalizeAccountId = (value: unknown): string =>
  (value ?? '').toString().trim();

const sanitizeCell = (row: unknown[], index: number): string => {
  if (!Array.isArray(row)) return '';
  if (index < 0 || index >= row.length) return '';
  const value = row[index];
  return value === null || value === undefined ? '' : String(value).trim();
};

const hasData = (row: unknown[]): boolean =>
  Array.isArray(row) && row.some(cell => (cell ?? '').toString().trim() !== '');

function findMainHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const normalized = row.map(normalizeHeaderName);
    if (normalized[0] === 'acct' && (normalized.includes('is play') || normalized.includes('status'))) {
      return i;
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const normalized = row.map(normalizeHeaderName);
    if (normalized.some(cell => cell === 'is play')) {
      return i;
    }
  }

  return -1;
}

function findSessionHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const normalized = row.map(normalizeHeaderName);
    const hasSessionColumns =
      normalized.includes('session') &&
      (normalized.includes('session win') ||
        normalized.includes('session loss') ||
        normalized.includes('session nett'));

    if (normalized[0] === 'acct' && hasSessionColumns) {
      return i;
    }
  }

  return -1;
}

function buildSessionMap(
  headerRow: string[] | null,
  dataRows: string[][]
): Map<string, PreCommitmentSessionSummary[]> {
  const sessionMap = new Map<string, PreCommitmentSessionSummary[]>();
  if (!headerRow) return sessionMap;

  const normalizedHeaders = headerRow.map(normalizeHeaderName);
  const acctIdx = normalizedHeaders.indexOf('acct');
  if (acctIdx === -1) return sessionMap;

  const sessionIdx = normalizedHeaders.indexOf('session');
  const winIdx = normalizedHeaders.indexOf('session win');
  const lossIdx = normalizedHeaders.indexOf('session loss');
  const nettIdx = normalizedHeaders.indexOf('session nett');

  dataRows.forEach(row => {
    const acct = normalizeAccountId(row[acctIdx]);
    if (!acct) return;

    const summary: PreCommitmentSessionSummary = {
      session: sanitizeCell(row, sessionIdx),
      sessionWin: sanitizeCell(row, winIdx),
      sessionLoss: sanitizeCell(row, lossIdx),
      sessionNett: sanitizeCell(row, nettIdx),
    };

    if (!summary.session && !summary.sessionWin && !summary.sessionLoss && !summary.sessionNett) {
      return;
    }

    const list = sessionMap.get(acct) ?? [];
    list.push(summary);
    sessionMap.set(acct, list);
  });

  return sessionMap;
}

export interface MemberContactData {
  accountNumber: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  isEmail: number; // 0 or 1
  isPostal: number; // 0 or 1
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

function buildMemberContactMap(
  headerRow: string[] | null,
  dataRows: string[][]
): Map<string, string> {
  const emailMap = new Map<string, string>();
  if (!headerRow) return emailMap;

  const normalizedHeaders = headerRow.map(normalizeHeaderName);
  const acctIdx = normalizedHeaders.indexOf('acct');
  const emailIdx = normalizedHeaders.indexOf('email address');
  
  if (acctIdx === -1 || emailIdx === -1) return emailMap;

  dataRows.forEach(row => {
    const acct = normalizeAccountId(row[acctIdx]);
    if (!acct) return;

    const email = sanitizeCell(row, emailIdx);
    if (email) {
      emailMap.set(acct, email);
    }
  });

  return emailMap;
}

function buildMemberContactData(
  headerRow: string[] | null,
  dataRows: string[][]
): MemberContactData[] {
  const memberContacts: MemberContactData[] = [];
  if (!headerRow) return memberContacts;

  const normalizedHeaders = headerRow.map(normalizeHeaderName);
  const acctIdx = normalizedHeaders.indexOf('acct');
  const firstNameIdx = normalizedHeaders.indexOf('firstname');
  const lastNameIdx = normalizedHeaders.indexOf('last name');
  const preferredNameIdx = normalizedHeaders.indexOf('preferred name');
  const isEmailIdx = normalizedHeaders.indexOf('is email');
  const isPostalIdx = normalizedHeaders.indexOf('is postal');
  const emailIdx = normalizedHeaders.indexOf('email address');
  const address1Idx = normalizedHeaders.indexOf('address1');
  const address2Idx = normalizedHeaders.indexOf('address2');
  const cityIdx = normalizedHeaders.indexOf('city');
  const stateIdx = normalizedHeaders.indexOf('state name');
  const postalCodeIdx = normalizedHeaders.indexOf('postal code');
  const countryIdx = normalizedHeaders.indexOf('country');
  
  if (acctIdx === -1) return memberContacts;

  dataRows.forEach(row => {
    const acct = normalizeAccountId(row[acctIdx]);
    if (!acct) return;

    // Parse is_email and is_postal as 0 or 1
    const isEmailValue = sanitizeCell(row, isEmailIdx);
    const isEmail = isEmailValue === '1' || isEmailValue.toLowerCase() === 'true' || isEmailValue.toLowerCase() === 'yes' ? 1 : 0;
    
    const isPostalValue = sanitizeCell(row, isPostalIdx);
    const isPostal = isPostalValue === '1' || isPostalValue.toLowerCase() === 'true' || isPostalValue.toLowerCase() === 'yes' ? 1 : 0;

    memberContacts.push({
      accountNumber: acct,
      firstName: sanitizeCell(row, firstNameIdx),
      lastName: sanitizeCell(row, lastNameIdx),
      preferredName: sanitizeCell(row, preferredNameIdx),
      isEmail,
      isPostal,
      email: sanitizeCell(row, emailIdx),
      address1: sanitizeCell(row, address1Idx),
      address2: sanitizeCell(row, address2Idx),
      city: sanitizeCell(row, cityIdx),
      state: sanitizeCell(row, stateIdx),
      postalCode: sanitizeCell(row, postalCodeIdx),
      country: sanitizeCell(row, countryIdx),
    });
  });

  return memberContacts;
}

function findMemberContactHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const normalized = row.map(normalizeHeaderName);
    if (normalized[0] === 'acct' && normalized.includes('email address')) {
      return i;
    }
  }
  return -1;
}

export interface ParseExcelResult {
  players: PreCommitmentPlayer[];
  memberContacts: MemberContactData[];
}

export function parseExcelFile(
  file: File,
  options: TransformOptions = DEFAULT_OPTIONS
): Promise<PreCommitmentPlayer[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        let primaryRows: string[][] | null = null;
        let headerRow: string[] | null = null;
        let sessionHeader: string[] | null = null;
        let sessionRows: string[][] = [];
        let memberContactHeader: string[] | null = null;
        let memberContactRows: string[][] = [];

        for (const name of workbook.SheetNames) {
          const sheet = workbook.Sheets[name];
          if (!sheet['!ref']) {
            continue;
          }

          const allRows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: ''
          }) as unknown[][];

          // Check if this is the Member Contact sheet
          if (name.toLowerCase().includes('member contact') || name.toLowerCase().includes('contact')) {
            const contactHeaderIndex = findMemberContactHeaderRow(allRows);
            if (contactHeaderIndex !== -1) {
              memberContactHeader = (allRows[contactHeaderIndex] as string[]).map(cell => String(cell));
              memberContactRows = (allRows.slice(contactHeaderIndex + 1) as string[][]).filter(hasData);
            }
            continue;
          }

          if (!primaryRows) {
            const headerIndex = findMainHeaderRow(allRows);
            if (headerIndex !== -1) {
              headerRow = (allRows[headerIndex] as string[]).map(cell => String(cell));
              primaryRows = (allRows.slice(headerIndex) as string[][]).filter(hasData);
            }
          }

          if (!sessionHeader) {
            const sessionHeaderIndex = findSessionHeaderRow(allRows);
            if (sessionHeaderIndex !== -1) {
              sessionHeader = (allRows[sessionHeaderIndex] as string[]).map(cell => String(cell));
              sessionRows = (allRows.slice(sessionHeaderIndex + 1) as string[][]).filter(hasData);
            }
          }
        }

        if (!primaryRows || !headerRow) {
          throw new Error('Could not find header row with "Acct" or "Is Play" column');
        }

        const headers = headerRow.map(h => String(h).trim());
        const rows = primaryRows.slice(1) as string[][];
        const sessionMap = buildSessionMap(sessionHeader, sessionRows);
        const emailMap = buildMemberContactMap(memberContactHeader, memberContactRows);

        const csvRows: PreCommitmentCSVRow[] = rows.map(row => {
          const csvRow: Record<string, string> = {};
          headers.forEach((header, index) => {
            csvRow[header] = row[index] ?? '';
          });
          return csvRow as PreCommitmentCSVRow;
        });

        const players = transformToPreCommitmentPlayers(csvRows, sessionMap, options, emailMap);
        resolve(players);
      } catch (error) {
        console.error('Error parsing Excel file:', error);
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsBinaryString(file);
  });
}

export function parseExcelFileWithMemberContacts(
  file: File,
  options: TransformOptions = DEFAULT_OPTIONS
): Promise<ParseExcelResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });

        let primaryRows: string[][] | null = null;
        let headerRow: string[] | null = null;
        let sessionHeader: string[] | null = null;
        let sessionRows: string[][] = [];
        let memberContactHeader: string[] | null = null;
        let memberContactRows: string[][] = [];

        for (const name of workbook.SheetNames) {
          const sheet = workbook.Sheets[name];
          if (!sheet['!ref']) {
            continue;
          }

          const allRows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: ''
          }) as unknown[][];

          // Check if this is the Member Contact sheet
          if (name.toLowerCase().includes('member contact') || name.toLowerCase().includes('contact')) {
            const contactHeaderIndex = findMemberContactHeaderRow(allRows);
            if (contactHeaderIndex !== -1) {
              memberContactHeader = (allRows[contactHeaderIndex] as string[]).map(cell => String(cell));
              memberContactRows = (allRows.slice(contactHeaderIndex + 1) as string[][]).filter(hasData);
            }
            continue;
          }

          if (!primaryRows) {
            const headerIndex = findMainHeaderRow(allRows);
            if (headerIndex !== -1) {
              headerRow = (allRows[headerIndex] as string[]).map(cell => String(cell));
              primaryRows = (allRows.slice(headerIndex) as string[][]).filter(hasData);
            }
          }

          if (!sessionHeader) {
            const sessionHeaderIndex = findSessionHeaderRow(allRows);
            if (sessionHeaderIndex !== -1) {
              sessionHeader = (allRows[sessionHeaderIndex] as string[]).map(cell => String(cell));
              sessionRows = (allRows.slice(sessionHeaderIndex + 1) as string[][]).filter(hasData);
            }
          }
        }

        if (!primaryRows || !headerRow) {
          throw new Error('Could not find header row with "Acct" or "Is Play" column');
        }

        const headers = headerRow.map(h => String(h).trim());
        const rows = primaryRows.slice(1) as string[][];
        const sessionMap = buildSessionMap(sessionHeader, sessionRows);
        const emailMap = buildMemberContactMap(memberContactHeader, memberContactRows);
        const memberContacts = buildMemberContactData(memberContactHeader, memberContactRows);

        const csvRows: PreCommitmentCSVRow[] = rows.map(row => {
          const csvRow: Record<string, string> = {};
          headers.forEach((header, index) => {
            csvRow[header] = row[index] ?? '';
          });
          return csvRow as PreCommitmentCSVRow;
        });

        const players = transformToPreCommitmentPlayers(csvRows, sessionMap, options, emailMap);
        resolve({ players, memberContacts });
      } catch (error) {
        console.error('Error parsing Excel file:', error);
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsBinaryString(file);
  });
}

export function validatePreCommitmentFile(file: File): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!file) {
    errors.push('No file provided');
    return { isValid: false, errors };
  }

  const validExtensions = ['.xlsx', '.csv'];
  const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

  if (!validExtensions.includes(fileExtension)) {
    errors.push('File must be .xlsx or .csv format');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

export function parseCSVFile(
  file: File,
  options: TransformOptions = DEFAULT_OPTIONS
): Promise<PreCommitmentPlayer[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const result = Papa.parse<PreCommitmentCSVRow>(content, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
        });

        if (result.errors.length > 0) {
          console.warn('Pre-commitment CSV parsing errors:', result.errors);
        }

        const players = transformToPreCommitmentPlayers(
          result.data as unknown as PreCommitmentCSVRow[],
          new Map(),
          options,
          new Map() // CSV files don't have Member Contact sheet
        );
        resolve(players);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function transformToPreCommitmentPlayers(
  csvRows: PreCommitmentCSVRow[],
  sessionMap: Map<string, PreCommitmentSessionSummary[]> = new Map(),
  options: TransformOptions = DEFAULT_OPTIONS,
  emailMap: Map<string, string> = new Map()
): PreCommitmentPlayer[] {
  const effectiveOptions: TransformOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const normalizeRow = (row: any): Record<string, any> => {
    const normalized: Record<string, any> = {};
    Object.keys(row || {}).forEach((key) => {
      const normalizedKey = String(key)
        .replace(/^\ufeff/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      normalized[normalizedKey] = row[key];
    });
    return normalized;
  };

  const filteredRows = csvRows.filter(row => {
    const n = normalizeRow(row as any);
    const acct = normalizeAccountId(n['acct']);
    if (!acct) {
      return false;
    }

    if (effectiveOptions.filterNoPlay === false) {
      return true;
    }

    const rawIsPlay = (n['is play'] ?? n['play status'] ?? n['isplay'] ?? '').toString();
    const isPlayStatus = rawIsPlay.trim().toLowerCase();
    const isPlayNormalized = isPlayStatus.replace(/[^a-z]/g, '');

    const rawStatus = (n['status'] ?? '').toString().trim().toLowerCase();
    const rawBreaches = (n['breaches'] ?? '').toString().trim().toLowerCase();
    const anyCellMatches = Object.values(n)
      .some(v => (v ?? '').toString().trim().toLowerCase().replace(/[^a-z]/g, '') === 'noplay');

    const isNoPlay = (
      isPlayNormalized === 'noplay' ||
      rawStatus.replace(/[^a-z]/g, '') === 'noplay' ||
      rawBreaches.replace(/[^a-z]/g, '') === 'noplay' ||
      anyCellMatches
    );

    return isNoPlay;
  });

  return filteredRows.map(row => {
    const n = normalizeRow(row as any);
    const acct = normalizeAccountId(n['acct']);
    const rawIsPlay = (n['is play'] ?? n['play status'] ?? n['isplay'] ?? '').toString().trim();
    const rawStatus = (n['status'] ?? '').toString().trim();
    const rawBreaches = (n['breaches'] ?? '').toString().trim();
    let detectedPlayStatus = rawIsPlay || rawStatus || rawBreaches || 'No Play';
    const detectedNormalized = detectedPlayStatus.toLowerCase().replace(/[^a-z]/g, '');
    if (detectedNormalized !== 'noplay') {
      detectedPlayStatus = 'No Play';
    }

    // Extract member information from template columns
    const knownAs = (n['knownas'] ?? '').toString().trim();
    const lastName = (n['lastname'] ?? '').toString().trim();
    const add1 = (n['add1'] ?? '').toString().trim();
    const add2 = (n['add2'] ?? '').toString().trim();
    const suburbName = (n['suburbname'] ?? '').toString().trim();
    const stateName = (n['statename'] ?? '').toString().trim();
    const pcode = (n['pcode'] ?? '').toString().trim();
    
    // Get email from Member Contact sheet if available
    const email = emailMap.get(acct) || '';

    const playerInfo: PlayerInfo = {
      playerAccount: acct,
      salutation: '',
      firstName: knownAs, // KnownAs maps to firstName
      lastName: lastName,
      email: email,
      address1: add1,
      address2: add2,
      suburb: suburbName,
      state: stateName,
      postCode: pcode,
      country: '',
      playerType: '',
      clubState: '',
    };

    const sessions = sessionMap.get(acct) ?? [];

    return {
      playerInfo,
      statementPeriod: 'Current Period',
      statementDate: new Date().toLocaleDateString(),
      noPlayStatus: detectedPlayStatus,
      enrollmentStatus: (n['status'] ?? '').toString(),
      startDay: (n['start day'] ?? '').toString(),
      consecutiveDays: (n['consecutive days'] ?? '').toString(),
      dailyBudget: (n['daily budget'] ?? '').toString(),
      dailyTime: (n['daily time'] ?? '').toString(),
      weeklyBudget: (n['weekly budget'] ?? '').toString(),
      weeklyTime: (n['weekly time'] ?? '').toString(),
      monthlyBudget: (n['monthly budget'] ?? '').toString(),
      monthlyTime: (n['monthly time'] ?? '').toString(),
      breaches: (n['breaches'] ?? '').toString(),
      monStart: (n['mon start'] ?? '').toString(),
      monEnd: (n['mon end'] ?? '').toString(),
      tueStart: (n['tue start'] ?? '').toString(),
      tueEnd: (n['tue end'] ?? '').toString(),
      wedStart: (n['wed start'] ?? '').toString(),
      wedEnd: (n['wed end'] ?? '').toString(),
      thuStart: (n['thu start'] ?? '').toString(),
      thuEnd: (n['thu end'] ?? '').toString(),
      friStart: (n['fri start'] ?? '').toString(),
      friEnd: (n['fri end'] ?? '').toString(),
      satStart: (n['sat start'] ?? '').toString(),
      satEnd: (n['sat end'] ?? '').toString(),
      sunStart: (n['sun start'] ?? '').toString(),
      sunEnd: (n['sun end'] ?? '').toString(),
      mins: (n['mins'] ?? '').toString(),
      every: (n['every hour'] ?? n['every'] ?? '').toString(), // Support both "Every Hour" and "Every"
      hour: (n['hour'] ?? '').toString(),
      sessionSummaries: sessions.length ? [...sessions] : undefined,
    } as PreCommitmentPlayer;
  });
}
