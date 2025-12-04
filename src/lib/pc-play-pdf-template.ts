import { ActivityStatementRow, PreCommitmentPlayer, QuarterlyData } from '@/types/player-data';
import {
  formatCurrency,
  formatExcelDate,
  formatExcelTime,
  formatUnitValue,
  getQuarterEndDate,
  getQuarterStartDate,
  getQuarterMonths,
  sanitizeNumber,
  sanitizeText,
  wrapNegativeValue,
} from './pdf-shared';

export const PC_PLAY_STYLES = `
  .play-header {
    width: 100%;
  }

  .precommitment-intro {
    margin-bottom: 15px;
  }

  .precommitment-contact {
    margin-top: 15px;
  }

  .precommitment-section {
    margin-top: 10px;
  }

  .precommitment-section h4 {
    margin-bottom: 10px;
    font-size: 13px;
  }

  .precommitment-section ul {
    padding-left: 20px;
    margin-top: 5px;
  }

  .precommitment-section li {
    margin-bottom: 6px;
  }

  .statement-details {
    padding-left: 20px;
  }

  .statement-details > p:first-child {
    margin-top: 0;
  }

  .statement-details ul li {
    margin-left: 20px;
  }

  .precommitment-table {
    width: 40%;
    border-collapse: collapse;
    margin-top: 15px;
  }

  .precommitment-table th,
  .precommitment-table td {
    border: 1px solid #000;
    padding: 6px;
    font-size: 11px;
  }

  .precommitment-table th {
    text-align: left;
    font-weight: 600;
  }

  .precommitment-table td.amount {
    text-align: right;
  }

  .precommitment-footer {
    margin-top: auto;
    text-align: center;
    font-size: 10px;
    line-height: 1.5;
    padding-top: 20px;
  }

  .page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .page-break {
    page-break-before: always;
  }

  .session-page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: white;
    padding: 40px;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .session-title {
    font-size: 16px;
    font-weight: 600;
    margin: 10px 0 20px 0;
    text-align: center;
    text-transform: uppercase;
  }

  .negative-value {
    color: #c53030;
  }
`;

// Check if a value is zero or empty
const isZeroOrEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  const raw = String(value).trim();
  if (raw === '') return true;
  const cleaned = raw.replace(/,/g, '').replace(/\$/g, '');
  const num = Number(cleaned);
  if (Number.isNaN(num)) return true;
  return num === 0;
};

const formatWithUnit = (value: unknown, unit: string): string => {
  const formatted = formatUnitValue(value, unit);
  return formatted || '–';
};

const renderList = (items: string[]): string => {
  return items.length ? items.map(i => `<li>${i}</li>`).join('') : '<li>Nil</li>';
};

const getMonthNumber = (monthName: string): number | null => {
  if (!monthName) return null;
  
  // Handle formats like "apr-25", "may-25", "jun-25" by extracting just the month part
  const normalized = monthName.trim().toLowerCase();
  // Remove year suffix if present (e.g., "apr-25" -> "apr")
  const monthPart = normalized.split(/[-_\/\s]/)[0];
  
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  
  const monthAbbreviations = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
  ];
  
  // Try full month name match first
  let index = monthNames.findIndex(name => name === monthPart || name.startsWith(monthPart));
  
  // If no match, try abbreviation
  if (index < 0) {
    index = monthAbbreviations.findIndex(abbr => abbr === monthPart || monthPart.startsWith(abbr));
  }
  
  return index >= 0 ? index + 1 : null;
};

const formatMonthName = (monthName: string, quarterlyData: QuarterlyData, monthIndex: number): string => {
  if (!monthName || monthName.trim() === '') {
    return '';
  }
  
  // If it's already a proper month name (not a reference number), return as is
  // This handles formats like "apr-25", "may-25", "jun-25" or full names like "April", "May", "June"
  if (isNaN(Number(monthName.trim()))) {
    // If it contains a month abbreviation, convert to full name for display
    const normalized = monthName.trim().toLowerCase();
    const monthPart = normalized.split(/[-_\/\s]/)[0];
    
    const monthAbbreviations: Record<string, string> = {
      'jan': 'January', 'feb': 'February', 'mar': 'March', 'apr': 'April',
      'may': 'May', 'jun': 'June', 'jul': 'July', 'aug': 'August',
      'sep': 'September', 'oct': 'October', 'nov': 'November', 'dec': 'December'
    };
    
    // If it's an abbreviation, convert to full name
    if (monthAbbreviations[monthPart]) {
      return monthAbbreviations[monthPart];
    }
    
    // If it's already a full month name, capitalize it properly
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const monthIdx = monthNames.findIndex(name => name === monthPart || name.startsWith(monthPart));
    if (monthIdx >= 0) {
      return monthNames[monthIdx].charAt(0).toUpperCase() + monthNames[monthIdx].slice(1);
    }
    
    // Return as-is if we can't parse it
    return monthName;
  }
  
  // Use the existing getQuarterMonths function to get proper month names
  const quarterMonths = getQuarterMonths(quarterlyData.quarter, quarterlyData.year);
  const targetMonth = quarterMonths[monthIndex - 1];
  
  return targetMonth ? targetMonth.name : '';
};

// Format date to DD/MM/YYYY format
const formatDateToDDMMYYYY = (dateStr: string): string => {
  if (!dateStr) return dateStr;
  
  // If already in DD/MM/YYYY format, return as-is
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr.trim())) {
    return dateStr.trim();
  }
  
  // Try to parse the date string
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    // If parsing fails, try formatExcelDate as fallback
    const formatted = formatExcelDate(dateStr);
    return formatted !== '-' ? formatted : dateStr;
  }
  
  // Format as DD/MM/YYYY
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const getStatementPeriod = (quarterlyData: QuarterlyData): { start: string; end: string } => {
  // Use explicit statement period if provided
  if (quarterlyData.statementPeriod?.startDate && quarterlyData.statementPeriod?.endDate) {
    return {
      start: quarterlyData.statementPeriod.startDate,
      end: quarterlyData.statementPeriod.endDate,
    };
  }

  // Fallback to quarter-based dates
  return {
    start: getQuarterStartDate(quarterlyData.quarter, quarterlyData.year),
    end: getQuarterEndDate(quarterlyData.quarter, quarterlyData.year),
  };
};

export function renderPreCommitmentPage(
  preCommitment: PreCommitmentPlayer,
  quarterlyData: QuarterlyData,
  salutationOverride?: string,
  playHeaderDataUrl?: string,
  activity?: ActivityStatementRow
): string {
  const { playerInfo } = preCommitment;
  const statementPeriod = getStatementPeriod(quarterlyData);
  const quarterStart = statementPeriod.start;
  const quarterEnd = statementPeriod.end;
  const fallbackDisplayName = [playerInfo.firstName, playerInfo.lastName]
    .filter(Boolean)
    .join(' ')
    .trim() || 'Member';
  const displayName = salutationOverride || fallbackDisplayName;
  const firstName = playerInfo.firstName?.trim() || 'Member';
  const breachesRaw = wrapNegativeValue(sanitizeNumber(preCommitment.breaches));
  // Show "Nil" if breaches is "-", "0.00", "0", or empty (strip HTML tags for comparison)
  const breachesPlain = breachesRaw.replace(/<[^>]*>/g, '').trim();
  const breaches = (breachesPlain === '-' || breachesPlain === '0.00' || breachesPlain === '0' || breachesPlain === '') 
    ? 'Nil' 
    : breachesRaw;
  
  // Build sections for the Pre-Commitment rules format
  const expenditureItems: string[] = [];
  const dailyBudgetF = formatCurrency(preCommitment.dailyBudget);
  const weeklyBudgetF = formatCurrency(preCommitment.weeklyBudget);
  const monthlyBudgetF = formatCurrency(preCommitment.monthlyBudget);
  const hasDailyBudget = dailyBudgetF !== '-' && !isZeroOrEmpty(preCommitment.dailyBudget);
  const hasWeeklyBudget = weeklyBudgetF !== '-' && !isZeroOrEmpty(preCommitment.weeklyBudget);
  const hasMonthlyBudget = monthlyBudgetF !== '-' && !isZeroOrEmpty(preCommitment.monthlyBudget);
  
  if (hasDailyBudget) {
    expenditureItems.push(`${wrapNegativeValue(dailyBudgetF)} per day`);
  }
  if (hasWeeklyBudget) {
    expenditureItems.push(`${wrapNegativeValue(weeklyBudgetF)} per week`);
  }
  if (hasMonthlyBudget) {
    expenditureItems.push(`${wrapNegativeValue(monthlyBudgetF)} per month`);
  }

  const timeLimitItems: string[] = [];
  const hasDailyTime = !isZeroOrEmpty(preCommitment.dailyTime);
  const hasWeeklyTime = !isZeroOrEmpty(preCommitment.weeklyTime);
  const hasMonthlyTime = !isZeroOrEmpty(preCommitment.monthlyTime);
  if (hasDailyTime) {
    const dailyTimeF = formatWithUnit(preCommitment.dailyTime, 'minutes');
    if (dailyTimeF !== '–') timeLimitItems.push(`${wrapNegativeValue(dailyTimeF)} per day`);
  }
  if (hasWeeklyTime) {
    const weeklyTimeF = formatWithUnit(preCommitment.weeklyTime, 'minutes');
    if (weeklyTimeF !== '–') timeLimitItems.push(`${wrapNegativeValue(weeklyTimeF)} per week`);
  }
  if (hasMonthlyTime) {
    const monthlyTimeF = formatWithUnit(preCommitment.monthlyTime, 'minutes');
    if (monthlyTimeF !== '–') timeLimitItems.push(`${wrapNegativeValue(monthlyTimeF)} per month`);
  }

  const breakItems: string[] = [];
  // Extract numeric value from mins
  const minsValue = preCommitment.mins ? String(preCommitment.mins).trim().replace(/,/g, '') : '';
  const minsNum = minsValue ? Number(minsValue) : NaN;
  const hasMins = !Number.isNaN(minsNum) && minsNum > 0;
  
  // Build single line format: "10 minutes every hour"
  if (hasMins) {
    breakItems.push(`${minsNum} minutes every hour`);
  }

  const scheduleItems: string[] = [];
  const addPeriod = (day: string, start: unknown, end: unknown) => {
    const s = formatExcelTime(start);
    const e = formatExcelTime(end);
    if (s && e) scheduleItems.push(`${day} ${s}-${e}`);
  };
  addPeriod('Monday', preCommitment.monStart, preCommitment.monEnd);
  addPeriod('Tuesday', preCommitment.tueStart, preCommitment.tueEnd);
  addPeriod('Wednesday', preCommitment.wedStart, preCommitment.wedEnd);
  addPeriod('Thursday', preCommitment.thuStart, preCommitment.thuEnd);
  addPeriod('Friday', preCommitment.friStart, preCommitment.friEnd);
  addPeriod('Saturday', preCommitment.satStart, preCommitment.satEnd);
  addPeriod('Sunday', preCommitment.sunStart, preCommitment.sunEnd);

  const consecutiveDaysF = formatWithUnit(preCommitment.consecutiveDays, 'days');
  const hasConsecutiveDays = !isZeroOrEmpty(preCommitment.consecutiveDays) && consecutiveDaysF !== '–';
  const sessionSummaries = preCommitment.sessionSummaries ?? [];
  
  // Split session rows: first 9 rows on first page, rest on next page
  const firstPageRows = sessionSummaries.slice(0, 5).map((summary, index) => {
    const date = formatExcelDate(summary.session);
    const amount = wrapNegativeValue(formatCurrency(summary.sessionNett));
    return `
      <tr>
        <td>${date}</td>
        <td class="amount">${amount}</td>
      </tr>
    `;
  }).join('');
  
  const nextPageRows = sessionSummaries.slice(5).map((summary, index) => {
    const date = formatExcelDate(summary.session);
    const amount = wrapNegativeValue(formatCurrency(summary.sessionNett));
    return `
      <tr>
        <td>${date}</td>
        <td class="amount">${amount}</td>
      </tr>
    `;
  }).join('');
  
  const hasNextPageRows = sessionSummaries.length > 5;
  
  const sessionRows = sessionSummaries.length
    ? firstPageRows
    : '<tr><td colspan="2">No daily activity recorded for this period.</td></tr>';

  // Get Total Amount Bet and Net/Win Loss from preCommitment or fallback to activity data
  const totalAmountBet = preCommitment.totalAmountBet?.trim() || activity?.totalTurnover?.trim() || '';
  const netWinLoss = preCommitment.netWinLoss?.trim() || activity?.playerWin?.trim() || '';

  return `
  <div class="page">
    ${playHeaderDataUrl ? `<img src="${playHeaderDataUrl}" alt="SkyCity Adelaide" class="play-header" />` : '<div class="text-logo">SKYCITY ADELAIDE</div>'}
    <div class="member-info">
      <div class="member-number">Member Number: ${playerInfo.playerAccount || '-'}</div>
    </div>

    <p class="precommitment-intro">Dear ${displayName},</p>

    <p style="margin-top: -5px;">Please find below your Pre-commitment information for the period ${quarterStart} to ${quarterEnd}.</p>
    <p style="margin-top: -5px;">Please see our friendly staff at either the Rewards desk or Host desks to vary or confirm your limits. Your delivery preference can also be updated at these locations. We can send statements via post, email or onsite collection.</p>
    <p style="margin-top: -5px;">If you would like to have your pre-commitment statement produced in another language please contact SkyCity Adelaide's Rewards department either at the Rewards desks onsite or by emailing <a href="mailto:customercompliance@skycity.com.au">customercompliance@skycity.com.au</a>.</p>

    <div>
      ${totalAmountBet ? `<p style="margin-top: 10px;"><strong>Total Amount Bet:</strong> ${wrapNegativeValue(formatCurrency(totalAmountBet))}</p>` : ''}
      ${netWinLoss ? `<p style="margin-top: -5px;"><strong>Net/Win Loss:</strong> ${wrapNegativeValue(formatCurrency(netWinLoss))}</p>` : ''}
      <p style="margin-top: 10px;"><strong>Your Active Pre-Commitment Rule/s as at ${formatDateToDDMMYYYY(quarterEnd)}</strong></p>
      <div class="statement-details">
        <p style="margin-top: 0;"><strong>Expenditure Limits:</strong></p>
        <ul>
          ${renderList(expenditureItems)}
        </ul>
        <p><strong>Time Limits:</strong></p>
        <ul>
          ${renderList(timeLimitItems)}
        </ul>
        <p><strong>Break in Play Periods</strong></p>
        <ul>
          ${renderList(breakItems)}
        </ul>
        <p><strong>No Play Periods</strong></p>
        <ul>
          ${renderList(scheduleItems)}
        </ul>
        <p><strong>Consecutive Days:</strong></p>
        <ul>
          ${renderList(hasConsecutiveDays ? [consecutiveDaysF] : [])}
        </ul>
      </div>
    </div>
    <p style="margin-top: -5px;"><strong>Number of Breaches:</strong> ${breaches}</p>
    <div>
      <p style="margin-top: -5px;"><strong>Statement Period:</strong> ${quarterStart} to ${quarterEnd}</p>
      <p style="margin-top: -5px;"><strong>Daily Amounts Won/Lost During the Period:</strong></p>
      <table class="precommitment-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Amount Won/Lost</th>
          </tr>
        </thead>
        <tbody>
          ${sessionRows}
        </tbody>
      </table>
    </div>
    ${!hasNextPageRows && sessionSummaries.length > 0 ? `
    <p class="precommitment-footer">This information is accurate as at ${quarterEnd} and will not reflect any changes you have made in MyPlay after this time.</p>
    ` : ''}
  </div>
  ${hasNextPageRows && nextPageRows ? `
  <div class="page-break"></div>
  <div class="session-page">
    <div style="flex: 1;">
      <table class="precommitment-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Amount Won/Lost</th>
          </tr>
        </thead>
        <tbody>
          ${nextPageRows}
        </tbody>
      </table>
    </div>
    <p class="precommitment-footer">This information is accurate as at ${quarterEnd} and will not reflect any changes you have made in MyPlay after this time.</p>
  </div>
  ` : ''}
  `;
}

/**
 * Generate complete HTML for Play pre-commitment PDF
 * This is a wrapper that creates a minimal QuarterlyData from the player's statementPeriod
 */
export function generatePlayPreCommitmentPDFHTML(
  player: PreCommitmentPlayer,
  playHeaderDataUrl?: string,
  memberData?: any
): string {
  // Parse statement period to create minimal QuarterlyData
  // Format: "DD Month YYYY - DD Month YYYY" or "Current Period"
  let quarterStart = '';
  let quarterEnd = '';
  
  if (player.statementPeriod && player.statementPeriod !== 'Current Period') {
    // Try to parse the statement period
    const parts = player.statementPeriod.split(' - ');
    if (parts.length === 2) {
      quarterStart = parts[0].trim();
      quarterEnd = parts[1].trim();
    }
  }
  
  // If we couldn't parse, use statementDate or current date
  if (!quarterEnd && player.statementDate) {
    quarterEnd = player.statementDate;
  }
  if (!quarterStart) {
    quarterStart = quarterEnd || new Date().toLocaleDateString();
  }
  
  // Create minimal QuarterlyData
  const quarterlyData: QuarterlyData = {
    quarter: 1, // Default, not used when statementPeriod is provided
    year: new Date().getFullYear(),
    players: [],
    monthlyBreakdown: [],
    statementPeriod: {
      startDate: quarterStart,
      endDate: quarterEnd,
    },
  };
  
  const innerHTML = renderPreCommitmentPage(
    player,
    quarterlyData,
    undefined, // salutationOverride
    playHeaderDataUrl,
    undefined // activity
  );
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkyCity Adelaide - Play Pre-Commitment Statement</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
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
          padding: 0 40px 40px 40px !important;
        }
        .play-header {
          position: relative !important;
          top: auto !important;
          left: auto !important;
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
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: 'Montserrat', Arial, sans-serif;
        font-size: 12px;
        line-height: 1.4;
        color: #000;
        background: white;
      }

      .page {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        background: white;
        padding: 40px;
        position: relative;
        display: flex;
        flex-direction: column;
      }

      .play-header {
        width: 100%;
      }

      .member-info {
        margin-bottom: 20px;
      }

      .member-number {
        text-align: right;
        font-size: 12px;
        font-weight: 600;
      }

      .text-logo {
        font-size: 24px;
        font-weight: 700;
        text-align: center;
        margin-bottom: 20px;
      }

      .precommitment-intro {
        margin-bottom: 15px;
      }

      .precommitment-contact {
        margin-top: 15px;
      }

      .precommitment-section {
        margin-top: 10px;
      }

      .precommitment-section h4 {
        margin-bottom: 10px;
        font-size: 13px;
      }

      .precommitment-section ul {
        padding-left: 20px;
        margin-top: 5px;
      }

      .precommitment-section li {
        margin-bottom: 6px;
      }

      .statement-details {
        padding-left: 20px;
      }

      .statement-details > p:first-child {
        margin-top: 0;
      }

      .statement-details ul li {
        margin-left: 50px;
      }

      .precommitment-table {
        width: 40%;
        border-collapse: collapse;
        margin-top: 15px;
      }

      .precommitment-table th,
      .precommitment-table td {
        border: 1px solid #000;
        padding: 6px;
        font-size: 11px;
      }

      .precommitment-table th {
        text-align: left;
        font-weight: 600;
      }

      .precommitment-table td.amount {
        text-align: right;
      }

      .precommitment-footer {
        margin-top: auto;
        text-align: center;
        font-size: 10px;
        line-height: 1.5;
        padding-top: 20px;
      }

      .page-break {
        page-break-before: always;
      }

      .session-page {
        width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        background: white;
        padding: 40px;
        position: relative;
        display: flex;
        flex-direction: column;
      }

      .session-title {
        font-size: 16px;
        font-weight: 600;
        margin: 10px 0 20px 0;
        text-align: center;
        text-transform: uppercase;
      }

      .negative-value {
        color: #c53030;
      }

      h4 {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 10px;
      }

      p {
        margin-bottom: 10px;
      }

      ul {
        list-style-type: disc;
      }

      li {
        margin-bottom: 6px;
      }

      a {
        color: #0066cc;
        text-decoration: underline;
      }
    </style>
</head>
<body>
  ${innerHTML}
</body>
</html>
  `;
}

