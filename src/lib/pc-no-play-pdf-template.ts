import { PreCommitmentPlayer } from '@/types/player-data';
import { Member } from './db';
import { formatExcelDate, wrapNegativeValue } from './pdf-shared';

const PRECOMMITMENT_STYLES = `
  <style>
    @media print {
      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .footer-info {
        background-color: #50a6db !important;
        color: #fff !important;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
      }
      .page {
        margin: 0 !important;
        padding: 0 40px 40px 40px !important;
      }
      .header {
        position: relative !important;
        top: auto !important;
        left: auto !important;
      }
      .letterhead {
        margin-top: -55px !important;
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
      font-size: 10px;
      line-height: 1.4;
      color: #000;
      background: white;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: white;
      padding-top: 0;
      position: relative;
      display: flex;
      flex-direction: column;
    }

    .header {
      width: 100%;
    }

    .letterhead {
      margin-top: -70px;
      padding-left: 50px;
      width: 100%;
    }

    .member-number {
      text-align: right;
      padding-right: 50px;
    }

    .content {
      padding: 40px;
      flex: 1;
    }

    .statement-details {
      padding: 20px;
    }

    .statement-details ul li {
      margin-left: 40px;
    }

    .footer-info {
      margin-top: auto;
      text-align: center;
      background-color: #50a6db;
      color: white;
      font-size: 10px;
      padding: 20px;
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
    }

    .session-title {
      font-size: 16px;
      font-weight: 600;
      margin: 10px 0 20px 0;
      text-align: center;
      text-transform: uppercase;
    }

    .session-table {
      width: 40%;
      border-collapse: collapse;
      margin-top: 10px;
    }

    .session-table th,
    .session-table td {
      border: 1px solid #000;
      padding: 6px;
      font-size: 11px;
    }

    .session-table th {
      text-align: left;
      font-weight: 600;
    }

    .session-table td:first-child {
      text-align: left;
    }

    .session-table td:last-child {
      text-align: right;
    }

    .session-note {
      margin-top: 20px;
      font-size: 10px;
      color: #333;
    }

    .negative-value {
      color: #c53030;
    }
  </style>
`;

function formatAccounting(value: unknown): string {
  if (value === null || value === undefined) return '–';
  const raw = String(value).trim();
  if (raw === '') return '–';
  const cleaned = raw.replace(/,/g, '').replace(/\$/g, '');
  const num = Number(cleaned);
  if (Number.isNaN(num)) return '–';
  const abs = Math.abs(num);
  const absStr = new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(abs);
  return num < 0 ? `-(${absStr})` : absStr;
}

function formatCurrency(value: unknown): string {
  const n = formatAccounting(value);
  return n === '–' ? '–' : `$${n}`;
}

function formatWithUnit(value: unknown, unit: string): string {
  const n = formatAccounting(value);
  return n === '–' ? '–' : `${n} ${unit}`;
}

// Check if a value is zero or empty
function isZeroOrEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const raw = String(value).trim();
  if (raw === '') return true;
  const cleaned = raw.replace(/,/g, '').replace(/\$/g, '');
  const num = Number(cleaned);
  if (Number.isNaN(num)) return true;
  return num === 0;
}

function formatExcelTime(value: unknown): string {
  if (value === null || value === undefined) return '–';
  const raw = String(value).trim();
  if (raw === '') return '–';
  // If it's already a time-like string, return as-is
  if (/^\d{1,2}:\d{2}(\s*[AP]M)?$/i.test(raw)) return raw;
  const num = Number(raw.replace(/,/g, ''));
  if (Number.isNaN(num)) return raw; // leave literal text
  // Excel stores times as fraction of a day. Use only the fractional part
  let frac = num % 1;
  if (frac < 0) frac = (frac + 1) % 1;
  const totalMinutes = Math.round(frac * 24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Format date to DD/MM/YYYY format
function formatDateToDDMMYYYY(dateStr: string): string {
  if (!dateStr) return dateStr;
  
  const trimmed = dateStr.trim();
  
  // If already in DD/MM/YYYY or MM/DD/YYYY format, parse and normalize
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);
    const year = parts[2];
    
    let day: number;
    let month: number;
    
    // If first part > 12, it's likely already DD/MM/YYYY
    if (first > 12) {
      day = first;
      month = second;
    } else if (second > 12) {
      // If second part > 12, it's likely MM/DD/YYYY, so swap
      day = second;
      month = first;
    } else {
      // Ambiguous case - assume it's MM/DD/YYYY and swap to DD/MM/YYYY
      // This handles cases like "9/30/2025" -> "30/09/2025"
      day = second;
      month = first;
    }
    
    // Ensure zero-padding for day and month
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }
  
  // Try to parse as MM/DD/YYYY first (common US format)
  const mmddyyyyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyyMatch) {
    const [, month, day, year] = mmddyyyyMatch;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
  }
  
  // Try to parse the date string using Date constructor
  const date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    // Format as DD/MM/YYYY
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
  
  // If parsing fails, try formatExcelDate as fallback
  const formatted = formatExcelDate(trimmed);
  return formatted !== '–' && formatted !== '-' ? formatted : dateStr;
}

export function renderPreCommitmentPages(player: PreCommitmentPlayer, logoDataUrl?: string, memberData?: Member | null): string {
  const { playerInfo, statementPeriod, statementDate } = player;
  
  // Member data is now included in the template columns, use playerInfo directly
  const displayName = [playerInfo.firstName, playerInfo.lastName].filter(Boolean).join(' ').trim() || 'Member';
  const firstName = playerInfo.firstName?.trim() || 'Member';
  
  // Build address from playerInfo (Add1 and Add2 from template)
  const address = [playerInfo.address1, playerInfo.address2].filter(Boolean).join(', ').trim();
  const suburb = playerInfo.suburb || '';
  
  // Format statement date for footer (last day of the period)
  const formatFooterDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr; // Return original if invalid
      const day = date.getDate();
      const month = date.toLocaleDateString('en-US', { month: 'long' });
      const year = date.getFullYear();
      return `${day} ${month} ${year}`;
    } catch (error) {
      return dateStr;
    }
  };
  const formattedFooterDate = statementDate ? formatFooterDate(statementDate) : '';
  const sessionSummaries = player.sessionSummaries ?? [];
  const hasSessionSummaries = sessionSummaries.length > 0;
  
  // Split session rows: first 11 rows on first page, rest on next page
  const firstPageRows = sessionSummaries.slice(0, 11).map((summary, index) => {
    const sessionValue = summary.session ?? '';
    const label = sessionValue ? formatExcelDate(sessionValue) : `Session ${index + 1}`;
    const amount = wrapNegativeValue(formatCurrency(summary.sessionNett));
    return `
            <tr>
              <td>${label}</td>
              <td>${amount}</td>
            </tr>
    `;
  }).join('');
  
  const nextPageRows = sessionSummaries.slice(11).map((summary, index) => {
    const sessionValue = summary.session ?? '';
    const label = sessionValue ? formatExcelDate(sessionValue) : `Session ${index + 12}`;
    const amount = wrapNegativeValue(formatCurrency(summary.sessionNett));
    return `
            <tr>
              <td>${label}</td>
              <td>${amount}</td>
            </tr>
    `;
  }).join('');
  
  const hasNextPageRows = sessionSummaries.length > 11;
  
  // Build lists for the No Play letter format
  const expenditureItems: string[] = [];
  const dailyBudgetF = formatCurrency(player.dailyBudget);
  const weeklyBudgetF = formatCurrency(player.weeklyBudget);
  const hasDailyBudget = dailyBudgetF !== '–' && !isZeroOrEmpty(player.dailyBudget);
  const hasWeeklyBudget = weeklyBudgetF !== '–' && !isZeroOrEmpty(player.weeklyBudget);
  
  if (hasDailyBudget && hasWeeklyBudget) {
    expenditureItems.push(`${dailyBudgetF} per day`);
    expenditureItems.push(`${weeklyBudgetF} per week`);
  } else if (hasDailyBudget) {
    expenditureItems.push(`${dailyBudgetF} per day`);
  } else if (hasWeeklyBudget) {
    expenditureItems.push(`${weeklyBudgetF} per week`);
  }
  // If neither has value, expenditureItems stays empty and will show "Nil"

  const timeLimitItems: string[] = [];
  const hasDailyTime = !isZeroOrEmpty(player.dailyTime);
  if (hasDailyTime) {
    const dailyTimeF = formatWithUnit(player.dailyTime, 'minutes');
    if (dailyTimeF !== '–') timeLimitItems.push(`${dailyTimeF} per day`);
  }
  // If no time limit, timeLimitItems stays empty and will show "Nil"

  const breakItems: string[] = [];
  // Extract numeric value from mins
  const minsValue = player.mins ? String(player.mins).trim().replace(/,/g, '') : '';
  const minsNum = minsValue ? Number(minsValue) : NaN;
  const hasMins = !Number.isNaN(minsNum) && minsNum > 0;
  
  // Build single line format: "10 minutes every hour"
  if (hasMins) {
    breakItems.push(`${minsNum} minutes every hour`);
  }
  // If no break items, breakItems stays empty and will show "Nil"

  const scheduleItems: string[] = [];
  const addPeriod = (day: string, start: unknown, end: unknown) => {
    const s = formatExcelTime(start);
    const e = formatExcelTime(end);
    if (s !== '–' && e !== '–') scheduleItems.push(`${day} ${s}-${e}`);
  };
  addPeriod('Monday', player.monStart, player.monEnd);
  addPeriod('Tuesday', player.tueStart, player.tueEnd);
  addPeriod('Wednesday', player.wedStart, player.wedEnd);
  addPeriod('Thursday', player.thuStart, player.thuEnd);
  addPeriod('Friday', player.friStart, player.friEnd);
  addPeriod('Saturday', player.satStart, player.satEnd);
  addPeriod('Sunday', player.sunStart, player.sunEnd);

  const consecutiveDaysF = formatAccounting(player.consecutiveDays);
  const hasConsecutiveDays = !isZeroOrEmpty(player.consecutiveDays) && consecutiveDaysF !== '–';
  const renderList = (items: string[]) => items.length ? items.map(i => `<li>${i}</li>`).join('') : '<li>Nil</li>';
  
  return `
${PRECOMMITMENT_STYLES}
    <div class="page">
        <img src="/no-play-header.png" alt="SkyCity Adelaide" class="header" />
        <table class="letterhead">
          <tr>
            <td colspan="2">${displayName}</td>
          </tr>
          <tr>
            <td colspan="2">${address}</td>
          </tr>
          <tr>
            <td colspan="2">${suburb}</td>
          </tr>
          <tr>
            <td>South Australia XXXX</td>
            <td class="member-number">Member Number: ${playerInfo.playerAccount}</td>
          </tr>
        </table>
        <br>
        <div class="content">
        <p>Dear ${displayName},</p>
        <br>
        <p>
        <strong>We understand that you were enrolled in MyPlay during the period of ${statementPeriod}.</strong>
        </p>
        <br>
        <p>
            There has been no recorded activity during your enrolment for the period of ${statementPeriod}.
        </p>
        <br>
        <p>
            Please visit the Rewards Desk to confirm or vary your expenditure limit. If you wish to change the delivery method for your statements please see our friendly SkyCity Adelaide staff at either the Rewards Desk or your Host desk. An immediate change will be made to your account.
        </p>
        <br>
        <p>Your Active Pre-Commitment Rule/s as at ${formatDateToDDMMYYYY(statementDate)} are:</p>
            
        <div class="statement-details">
          <p><strong>Expenditure Limits:</strong></p>
          <ul>
            ${renderList(expenditureItems)}
          </ul>
          <br>
          <p><strong>Time Limits:</strong></p>
          <ul>
            ${renderList(timeLimitItems)}
          </ul>
          <br>
          <p><strong>Break in Play Periods</strong></p>
          <ul>
            ${renderList(breakItems)}
          </ul>
          <br>
          <p><strong>No Play Periods</strong></p>
          <ul>
            ${renderList(scheduleItems)}
          </ul>
          <br>
          <p><strong>Consecutive Days:</strong></p>
          <ul>
            ${renderList(hasConsecutiveDays ? [consecutiveDaysF] : [])}
          </ul>
        </div>
        ${hasSessionSummaries && firstPageRows ? `
        <div class="statement-details">
          <p><strong>Daily Amounts Won/Lost During the Period:</strong></p>
          <table class="session-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount Won/Lost</th>
              </tr>
            </thead>
            <tbody>
              ${firstPageRows}
            </tbody>
          </table>
        </div>
        ` : ''}
        <p>SkyCity Adelaide is able to send statements by post or email. You are also able to access your statements via on-site kiosks.</p>
        <br>  
        <p>If you would like to have your MyPlay statement produced in another language please contact SkyCity Adelaide's Rewards department either at the desks onsite, or by emailing marketing@skycityadelaide.com.au to see if that language is available.</p>
        <br><br><br>
        <p>Kind regards,</p>
        <p><strong>SkyCity Adelaide</strong></p>
        </div>
        <div class="footer-info">
            <p>This information is accurate as of ${formattedFooterDate} and will not reflect any changes you make in MyPlay after this time.</p>
        </div>
    </div>
    ${hasNextPageRows && nextPageRows ? `
    <div class="page-break"></div>
    <div class="session-page">
      <h3 class="session-title">Daily Amounts Won/Lost During the Period</h3>
      <table class="session-table">
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
      <div class="session-note">
        <p>This information is accurate as of ${formattedFooterDate} and will not reflect any changes you make in MyPlay after this time.</p>
      </div>
    </div>
    ` : ''}
  `;
}

export function generatePreCommitmentPDFHTML(player: PreCommitmentPlayer, logoDataUrl?: string, memberData?: Member | null): string {
  const inner = renderPreCommitmentPages(player, logoDataUrl, memberData);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkyCity Adelaide - Play & No-Play Pre-Commitment Statement</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
</head>
<body>
  ${inner}
</body>
</html>
  `;
}







