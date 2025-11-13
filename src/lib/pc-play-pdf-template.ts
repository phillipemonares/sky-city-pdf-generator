import { PreCommitmentPlayer, QuarterlyData } from '@/types/player-data';
import {
  formatCurrency,
  formatExcelDate,
  formatExcelTime,
  formatUnitValue,
  getQuarterEndDate,
  getQuarterStartDate,
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
    margin-top: 20px;
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

const buildPreCommitmentRules = (player: PreCommitmentPlayer): string[] => {
  const rules: string[] = [];
  const addRule = (text: string | null | undefined) => {
    const sanitized = sanitizeText(text);
    if (sanitized) {
      rules.push(sanitized);
    }
  };

  const addCurrencyRule = (label: string, value: unknown) => {
    const formatted = formatCurrency(value);
    if (formatted !== '-') {
      rules.push(`${label}: ${wrapNegativeValue(formatted)}`);
    }
  };

  const addUnitRule = (label: string, value: unknown, unit: string) => {
    const formatted = formatUnitValue(value, unit);
    if (formatted) {
      rules.push(`${label}: ${wrapNegativeValue(formatted)}`);
    }
  };

  addRule(player.enrollmentStatus ? `Enrollment status: ${player.enrollmentStatus}` : null);
  addRule(player.noPlayStatus ? `Play status: ${player.noPlayStatus}` : null);
  addCurrencyRule('Daily budget limit', player.dailyBudget);
  addCurrencyRule('Weekly budget limit', player.weeklyBudget);
  addCurrencyRule('Monthly budget limit', player.monthlyBudget);
  addUnitRule('Daily time limit', player.dailyTime, 'minutes');
  addUnitRule('Weekly time limit', player.weeklyTime, 'minutes');
  addUnitRule('Monthly time limit', player.monthlyTime, 'minutes');

  const breakParts: string[] = [];
  const breakMins = formatUnitValue(player.mins, 'minutes');
  if (breakMins) {
    breakParts.push(`Break duration ${wrapNegativeValue(breakMins)}`);
  }
  const breakEvery = sanitizeText(player.every);
  if (breakEvery) {
    breakParts.push(`Every ${breakEvery}`);
  }
  const breakHour = formatUnitValue(player.hour, 'hours');
  if (breakHour) {
    breakParts.push(`Over ${wrapNegativeValue(breakHour)}`);
  }
  if (breakParts.length) {
    rules.push(`Break in play reminders: ${breakParts.join(', ')}`);
  }

  const scheduleEntries: string[] = [];
  const addSchedule = (day: string, start: unknown, end: unknown) => {
    const formattedStart = formatExcelTime(start);
    const formattedEnd = formatExcelTime(end);
    if (formattedStart && formattedEnd) {
      scheduleEntries.push(`${day} ${formattedStart}-${formattedEnd}`);
    }
  };

  addSchedule('Monday', player.monStart, player.monEnd);
  addSchedule('Tuesday', player.tueStart, player.tueEnd);
  addSchedule('Wednesday', player.wedStart, player.wedEnd);
  addSchedule('Thursday', player.thuStart, player.thuEnd);
  addSchedule('Friday', player.friStart, player.friEnd);
  addSchedule('Saturday', player.satStart, player.satEnd);
  addSchedule('Sunday', player.sunStart, player.sunEnd);

  if (scheduleEntries.length) {
    rules.push(`No play periods: ${scheduleEntries.join('; ')}`);
  }

  const consecutive = formatUnitValue(player.consecutiveDays, 'days');
  if (consecutive) {
    rules.push(`Consecutive days: ${wrapNegativeValue(consecutive)}`);
  }

  return rules;
};

export function renderPreCommitmentPage(
  preCommitment: PreCommitmentPlayer,
  quarterlyData: QuarterlyData,
  salutationOverride?: string,
  playHeaderDataUrl?: string
): string {
  const { playerInfo } = preCommitment;
  const quarterStart = getQuarterStartDate(quarterlyData.quarter, quarterlyData.year);
  const quarterEnd = getQuarterEndDate(quarterlyData.quarter, quarterlyData.year);
  const fallbackDisplayName = [playerInfo.firstName, playerInfo.lastName]
    .filter(Boolean)
    .join(' ')
    .trim() || 'Member';
  const displayName = salutationOverride || fallbackDisplayName;
  const rules = buildPreCommitmentRules(preCommitment);
  const ruleItems = rules.length
    ? rules.map((rule, index) => `<li><strong>Rule ${index + 1}:</strong> ${rule}</li>`).join('')
    : '<li>No active pre-commitment rules recorded.</li>';
  const breaches = wrapNegativeValue(sanitizeNumber(preCommitment.breaches));
  const sessionSummaries = preCommitment.sessionSummaries ?? [];
  
  // Split session rows: first 9 rows on first page, rest on next page
  const firstPageRows = sessionSummaries.slice(0, 8).map((summary, index) => {
    const date = formatExcelDate(summary.session);
    const amount = wrapNegativeValue(formatCurrency(summary.sessionNett));
    return `
      <tr>
        <td>${date}</td>
        <td class="amount">${amount}</td>
      </tr>
    `;
  }).join('');
  
  const nextPageRows = sessionSummaries.slice(8).map((summary, index) => {
    const date = formatExcelDate(summary.session);
    const amount = wrapNegativeValue(formatCurrency(summary.sessionNett));
    return `
      <tr>
        <td>${date}</td>
        <td class="amount">${amount}</td>
      </tr>
    `;
  }).join('');
  
  const hasNextPageRows = sessionSummaries.length > 8;
  
  const sessionRows = sessionSummaries.length
    ? firstPageRows
    : '<tr><td colspan="2">No daily activity recorded for this period.</td></tr>';

  return `
  <div class="page">
    ${playHeaderDataUrl ? `<img src="${playHeaderDataUrl}" alt="SkyCity Adelaide" class="play-header" />` : '<div class="text-logo">SKYCITY ADELAIDE</div>'}
    <div class="member-info">
      <div class="member-number">Member Number: ${playerInfo.playerAccount || '-'}</div>
    </div>

    <p class="precommitment-intro">Dear ${displayName},</p>

    <p>Please find below your Pre-commitment information for the period ${quarterStart} to ${quarterEnd}.</p>
    <p>Please see our friendly staff at either the Rewards desk or Host desks to vary or confirm your limits. Your delivery preference can also be updated at these locations. We can send statements via post, email or onsite collection.</p>
    <p class="precommitment-contact">If you would like to have your pre-commitment statement produced in another language please contact SkyCity Adelaide’s Rewards department either at the Rewards desks onsite or by emailing <a href="mailto:customercompliance@skycity.com.au">customercompliance@skycity.com.au</a>.</p>

    <div class="precommitment-section">
      <h4>Your Active Pre-Commitment Rule/s as at ${quarterEnd}</h4>
      <ul>
        ${ruleItems}
      </ul>
    </div>

    <p><strong>Number of Breaches:</strong> ${breaches}</p>

    <div class="precommitment-section">
      <h4>Daily Amounts Won/Lost During the Period:</h4>
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

