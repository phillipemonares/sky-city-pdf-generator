import { ActivityStatementRow, QuarterlyData } from '@/types/player-data';
import {
  formatCurrency,
  sanitizeNumber,
  sanitizeText,
  getQuarterEndDate,
  getQuarterStartDate,
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
    color: #008000;
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

const buildMonthlyRows = (activity: ActivityStatementRow): MonthlyRow[] => ([
  {
    name: activity.month1Name,
    totalBet: activity.month1TotalAmountBet,
    days: activity.month1NoDaysGambled,
    net: activity.month1NetAmountWonOrLost,
    hours: activity.month1TimeSpentHour,
    minutes: activity.month1TimeSpentMinute,
  },
  {
    name: activity.month2Name,
    totalBet: activity.month2TotalAmountBet,
    days: activity.month2NoDaysGambled,
    net: activity.month2NetAmountWonOrLost,
    hours: activity.month2TimeSpentHour,
    minutes: activity.month2TimeSpentMinute,
  },
  {
    name: activity.month3Name,
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
  const memberName = [activity.title, activity.firstName, activity.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const fallbackSalutation = activity.firstName || memberName || 'Member';
  const salutationName = salutationOverride || fallbackSalutation;
  const quarterStart = getQuarterStartDate(quarterlyData.quarter, quarterlyData.year);
  const quarterEnd = getQuarterEndDate(quarterlyData.quarter, quarterlyData.year);
  const monthRows = buildMonthlyRows(activity);
  const addressLines = buildAddressLines(activity);
  const totalHours = sanitizeNumber(activity.totalTimeSpentHour);
  const totalMinutes = sanitizeNumber(activity.totalTimeSpentMinute);
  const currencyCell = (value: unknown) => wrapNegativeValue(formatCurrency(value));
  const numericCell = (value: unknown) => wrapNegativeValue(sanitizeNumber(value));

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
      If you or someone you know needs help, please get in touch with our specially trained staff by calling (08) 8212 2811 and ask to be put through to the Host Responsibility team. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.
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
          <td class="value">${numericCell(totalHours)} hour(s) ${numericCell(totalMinutes)} minute(s)</td>
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

    </div>
  `;
}


