import { ActivityStatementRow, QuarterlyData } from '@/types/player-data';
import {
  formatCurrency,
  sanitizeNumber,
  sanitizeText,
  getQuarterEndDate,
  getQuarterStartDate,
  getQuarterMonths,
  wrapNegativeValue,
} from './pdf-shared';

export const AS_STYLES = `
  .address-block {
    margin-bottom: 30px;
  }

  .address-line {
    display: block;
  }

  .salutation {
    margin-bottom: 15px;
  }

  .statement-intro {
    margin-bottom: 20px;
  }

  .bullet-list {
    margin: 15px 0;
    padding-left: 20px;
  }

  .bullet-list li {
    margin-bottom: 8px;
  }

  .myplay-section,
  .contact-info {
    margin: 20px 0;
  }

  .closing {
    margin-top: 30px;
  }

  .activity-title {
    font-size: 16px;
    text-align: center;
    margin-bottom: 20px;
    text-transform: uppercase;
  }

  .statement-period {
    margin-bottom: 20px;
  }

  .summary-section {
    margin-bottom: 25px;
  }

  .summary-section table {
    width: 100%;
    border-collapse: collapse;
  }

  .summary-section td {
    padding: 6px 0;
    font-weight: 700;
  }

  .summary-section td.value {
    text-align: right;
  }

  .monthly-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }

  .monthly-table th,
  .monthly-table td {
    border: 1px solid #000;
    padding: 8px;
    text-align: center;
  }

  .monthly-table th:first-child,
  .monthly-table td:first-child {
    text-align: left;
  }

  .notes-section {
    margin-top: 30px;
  }

  .notes-section h4 {
    margin-bottom: 10px;
  }

  .notes-section ol {
    padding-left: 18px;
  }

  .notes-section li {
    margin-bottom: 8px;
  }

  .activity-footer {
    margin-top: 30px;
    text-align: center;
    font-size: 10px;
    line-height: 1.5;
    padding-top: 20px;
  }

  .activity-footer p {
    margin-bottom: 8px;
  }

  .channel-tag {
    margin-top: 20px;
    padding: 12px;
    border-left: 4px solid #2b6cb0;
    background: #ebf4ff;
    color: #2c5282;
    font-weight: 600;
  }

  .negative-value {
    color: #c53030;
  }
`;

type MonthlyRow = {
  name: string;
  totalBet: string;
  days: string;
  net: string;
  hours: string;
  minutes: string;
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

// Extract months from statement period dates (DD/MM/YYYY format)
const getStatementPeriodMonths = (quarterlyData: QuarterlyData): { name: string; month: number }[] => {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const statementPeriod = getStatementPeriod(quarterlyData);
  
  // Parse start and end dates (DD/MM/YYYY format)
  const parseDate = (dateStr: string): { month: number; year: number } | null => {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return { month, year };
      }
    }
    return null;
  };

  const startDate = parseDate(statementPeriod.start);
  const endDate = parseDate(statementPeriod.end);

  if (!startDate || !endDate) {
    // Fallback to quarter months if parsing fails
    return getQuarterMonths(quarterlyData.quarter, quarterlyData.year);
  }

  // Get all months between start and end dates
  const months: { name: string; month: number }[] = [];
  let currentMonth = startDate.month;
  let currentYear = startDate.year;
  const endMonth = endDate.month;
  const endYear = endDate.year;

  while (
    currentYear < endYear ||
    (currentYear === endYear && currentMonth <= endMonth)
  ) {
    months.push({
      name: monthNames[currentMonth - 1],
      month: currentMonth
    });

    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }

    // Safety limit to prevent infinite loops
    if (months.length > 12) break;
  }

  // Return up to 3 months (for quarterly statements)
  return months.slice(0, 3);
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
  
  // Use statement period months instead of quarter months
  const statementMonths = getStatementPeriodMonths(quarterlyData);
  const targetMonth = statementMonths[monthIndex - 1];
  
  return targetMonth ? targetMonth.name : '';
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

const buildMonthlyRows = (activity: ActivityStatementRow, quarterlyData: QuarterlyData): MonthlyRow[] => ([
  {
    name: formatMonthName(activity.month1Name, quarterlyData, 1),
    totalBet: activity.month1TotalAmountBet,
    days: activity.month1NoDaysGambled,
    net: activity.month1NetAmountWonOrLost,
    hours: activity.month1TimeSpentHour,
    minutes: activity.month1TimeSpentMinute,
  },
  {
    name: formatMonthName(activity.month2Name, quarterlyData, 2),
    totalBet: activity.month2TotalAmountBet,
    days: activity.month2NoDaysGambled,
    net: activity.month2NetAmountWonOrLost,
    hours: activity.month2TimeSpentHour,
    minutes: activity.month2TimeSpentMinute,
  },
  {
    name: formatMonthName(activity.month3Name, quarterlyData, 3),
    totalBet: activity.month3TotalAmountBet,
    days: activity.month3NoDaysGambled,
    net: activity.month3NetAmountWonOrLost,
    hours: activity.month3TimeSpentHour,
    minutes: activity.month3TimeSpentMinute,
  },
]).filter(row => row.name && row.name.trim() !== '');

const buildAddressLines = (activity: ActivityStatementRow): string[] => {
  const lines: string[] = [];
  const normalizedAddress = sanitizeText(activity.address).replace(/\r\n|\r|\n/g, '\n');
  if (normalizedAddress) {
    lines.push(
      ...normalizedAddress
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    );
  }
  if (activity.suburb) {
    lines.push(activity.suburb);
  }
  const stateLine = [activity.state, activity.postCode].filter(Boolean).join(' ').trim();
  if (stateLine) {
    lines.push(stateLine);
  }
  if (activity.country) {
    lines.push(activity.country);
  }
  return lines;
};

export function renderActivityPages(
  activity: ActivityStatementRow,
  quarterlyData: QuarterlyData,
  logoDataUrl?: string,
  salutationOverride?: string
): string {
  // Build member name, removing trailing period and spaces from title if followed by a name
  const nameParts = [activity.title, activity.firstName, activity.lastName]
    .map(part => part ? String(part).trim() : '')
    .filter(Boolean);
  if (nameParts.length > 1 && nameParts[0]) {
    nameParts[0] = nameParts[0].replace(/\.\s*$/, '').trim();
  }
  const memberName = nameParts.join(' ').trim();
  const fallbackSalutation = activity.firstName || memberName || 'Member';
  const salutationName = salutationOverride || fallbackSalutation;
  const statementPeriod = getStatementPeriod(quarterlyData);
  const quarterStart = statementPeriod.start;
  const quarterEnd = statementPeriod.end;
  const monthRows = buildMonthlyRows(activity, quarterlyData);
  const addressLines = buildAddressLines(activity);
  const currencyCell = (value: unknown) => wrapNegativeValue(formatCurrency(value));
  const numericCell = (value: unknown) => wrapNegativeValue(sanitizeNumber(value));
  
  // Format time display: show "-" if both hours and minutes are empty/dash
  const formatTimeDisplay = (hoursRaw: unknown, minutesRaw: unknown): string => {
    const hoursStr = String(hoursRaw ?? '').trim();
    const minutesStr = String(minutesRaw ?? '').trim();
    const hoursEmpty = !hoursStr || hoursStr === '-';
    const minutesEmpty = !minutesStr || minutesStr === '-';
    
    if (hoursEmpty && minutesEmpty) {
      return '-';
    }
    
    const hours = sanitizeNumber(hoursRaw);
    const minutes = sanitizeNumber(minutesRaw);
    return `${hours} hour(s) ${minutes} minute(s)`;
  };

  const monthlyRowsMarkup = monthRows.length
    ? monthRows
        .map(row => {
          const totalBet = currencyCell(row.totalBet);
          const daysPlayed = numericCell(row.days);
          const net = currencyCell(row.net);
          const hours = numericCell(row.hours);
          const minutes = numericCell(row.minutes);
          return `
          <tr>
            <td>${row.name}</td>
            <td>${totalBet}</td>
            <td>${daysPlayed}</td>
            <td>${net}</td>
            <td>${hours}</td>
            <td>${minutes}</td>
          </tr>
        `;
        })
        .join('')
    : `
          <tr>
            <td colspan="6">No monthly breakdown available.</td>
          </tr>
        `;

  return `
  <div class="page">
    <div class="logo">
      ${
        logoDataUrl
          ? `<img src="${logoDataUrl}" alt="SkyCity Adelaide" />`
          : '<div class="text-logo">SKYCITY ADELAIDE</div>'
      }
    </div>

    <div class="address-block">
      <div class="address-line">${memberName || 'Member'}</div>
      ${addressLines.map(line => `<div class="address-line">${line}</div>`).join('')}
    </div>

    <div class="member-info">
      <div class="member-number">Member Number: ${activity.acct || '-'}</div>
    </div>

    <div class="salutation">Dear ${salutationName},</div>

    <div class="statement-intro">
      Your quarterly statement for the period ${quarterStart} to ${quarterEnd} is now available for viewing and is attached.
    </div>

    <div>
      The statement includes the following information (where applicable):
      <ul class="bullet-list">
        <li>Your quarterly activity statement – detailing your recorded gambling activity conducted whilst using your membership card at SkyCity Adelaide during the relevant period;</li>
        <li>Your cashless statement – detailing, amongst other things, cashless gaming activity conducted during the relevant period;</li>
        <li>Your MyPlay statement – detailing, amongst other things, your recorded gambling activity and how they correlate with your MyPlay limits during the relevant period.</li>
      </ul>
    </div>

    <div class="myplay-section">
      SkyCity Adelaide has a pre-commitment program (known as MyPlay) that allows customers to set individual limits to help them control their gaming on electronic gaming machines and electronic table games. Customers may limit the amount of time &/or money they wish to spend, the number of visits they wish to make and break in play/no play periods. The Host Responsibility team is available to assist customers with setting up or changing personal pre-commitment limits. Visit https://skycityadelaide.com.au/about-us/host-responsibility/my-play/ for more information regarding MyPlay or ask venue staff for details.
    </div>

    <div class="contact-info">
      If you or someone you know needs help, please get in touch with our specially trained staff by calling (08) 8218 4141 and ask to be put through to the Host Responsibility team. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.
      <br><br>
      Please feel free to contact SkyCity Rewards or a VIP Host if you have any questions regarding statements.
    </div>

    <div class="closing">
      Kind regards,<br>
      SkyCity Adelaide
    </div>
  </div>

  <div class="page-break"></div>
  <div class="page">
    <div class="logo">
      ${
        logoDataUrl
          ? `<img src="${logoDataUrl}" alt="SkyCity Adelaide" />`
          : '<div class="text-logo">SKYCITY ADELAIDE</div>'
      }
    </div>

    <div class="activity-title">PLAYER ACTIVITY STATEMENT</div>

    <div class="statement-period">
      <div>Member Number: ${activity.acct || '-'}</div>
      <div>Statement Period: ${quarterStart} – ${quarterEnd}</div>
    </div>

    <div class="summary-section">
      <table>
        <tr>
          <td>Total Amount Bet:</td>
          <td class="value">${currencyCell(activity.totalTurnover)}</td>
        </tr>
        <tr>
          <td>Total Amount Won:</td>
          <td class="value">${currencyCell(activity.totalAmountWon)}</td>
        </tr>
        <tr>
          <td>Overall Net Win (+) / Loss (-):</td>
          <td class="value">${currencyCell(activity.playerWin)}</td>
        </tr>
        <tr>
          <td>Total Number of Days Played:</td>
          <td class="value">${numericCell(activity.gamingDays)}</td>
        </tr>
        <tr>
          <td>The total amount of time your loyalty card was used during the period:</td>
          <td class="value">${formatTimeDisplay(activity.totalTimeSpentHour, activity.totalTimeSpentMinute)}</td>
        </tr>
      </table>
    </div>

    <table class="monthly-table">
      <thead>
        <tr>
          <th>Month</th>
          <th>Total Amount Bet</th>
          <th>No. of Days Played</th>
          <th>Net Amount Won (+)/Lost (-)</th>
          <th>Total Time Spent (Hours)</th>
          <th>Total Time Spent (Minutes)</th>
        </tr>
      </thead>
      <tbody>
        ${monthlyRowsMarkup}
      </tbody>
    </table>

    <div class="notes-section">
      <h4>Notes:</h4>
      <ol>
        <li>In this statement, a day starts at 6:00am and ends at 5:59am on the following day.</li>
        <li>This activity statement is a summary of your gaming activity for the period shown.</li>
        <li>This activity statement only shows occasions where you used your membership card whilst playing an electronic gaming machine or electronic table game during the relevant period. The accuracy of the information contained within this statement is dependent upon you using your SkyCity Rewards membership card in a manner as instructed by SkyCity Adelaide.</li>
        <li>The total amount of time your loyalty card was used during the activity period represents the total aggregate time difference between the start and end time of each of your gaming ratings from card-in to card-out. Please note that these figures are estimates and only the minute part will be considered on each individual rating and not the seconds (for example, if time played in relation to a rating is 1 minute and 20 seconds then only 1 minute will be displayed for that rating). If the rating does not have any play (ie, zero bets) then the rating will not be processed and the time will not form part of your statement.</li>
      </ol>
    </div>

    <div class="activity-footer">
      <p>SkyCity Adelaide extracts carded data from its approved gaming systems. Whilst reasonable efforts are made to ensure the accuracy of such data, there may be instances where our systems encounter faults or errors. Accordingly, SkyCity Adelaide does not represent or warrant that the figures included in this statement are error-free or completely accurate.</p>
    </div>

    </div>
  `;
}


