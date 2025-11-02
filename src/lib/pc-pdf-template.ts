import { PreCommitmentPlayer } from '@/types/player-data';

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
    }

    .statement-details {
      padding: 20px;
    }

    .statement-details ul li {
      margin-left: 40px;
    }

    .footer-info {
      margin-top: 10px;
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
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }

    .session-table th,
    .session-table td {
      border: 1px solid #000;
      padding: 8px;
      text-align: center;
    }

    .session-table th:first-child,
    .session-table td:first-child {
      text-align: left;
    }

    .session-note {
      margin-top: 20px;
      font-size: 10px;
      color: #333;
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

export function renderPreCommitmentPages(player: PreCommitmentPlayer, logoDataUrl?: string): string {
  const { playerInfo, statementPeriod, statementDate } = player;
  const displayName = [playerInfo.firstName, playerInfo.lastName].filter(Boolean).join(' ').trim() || 'Member';
  const sessionSummaries = player.sessionSummaries ?? [];
  const sessionTableRows = sessionSummaries.map((summary, index) => {
    const label = (summary.session ?? '').toString().trim() || `Session ${index + 1}`;
    return `
            <tr>
              <td>${label}</td>
              <td>${formatCurrency(summary.sessionWin)}</td>
              <td>${formatCurrency(summary.sessionLoss)}</td>
              <td>${formatCurrency(summary.sessionNett)}</td>
            </tr>
    `;
  }).join('');
  const hasSessionSummaries = sessionSummaries.length > 0;
  
  // Build lists for the No Play letter format
  const expenditureItems: string[] = [];
  const dailyBudgetF = formatCurrency(player.dailyBudget);
  if (dailyBudgetF !== '–') expenditureItems.push(`${dailyBudgetF} per day`);
  const weeklyBudgetF = formatCurrency(player.weeklyBudget);
  if (weeklyBudgetF !== '–') expenditureItems.push(`${weeklyBudgetF} per week`);

  const timeLimitItems: string[] = [];
  const dailyTimeF = formatWithUnit(player.dailyTime, 'minutes');
  if (dailyTimeF !== '–') timeLimitItems.push(`${dailyTimeF} per day`);

  const breakItems: string[] = [];
  const minsF = formatWithUnit(player.mins, 'minutes');
  const everyF = (player.every || '').toString().trim();
  const hourF = formatWithUnit(player.hour, 'hours');
  if (minsF !== '–') breakItems.push(`Mins: ${minsF}`);
  if (everyF) breakItems.push(`Every: ${everyF}`);
  if (hourF !== '–') breakItems.push(`Hour: ${hourF}`);

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
  const renderList = (items: string[]) => items.length ? items.map(i => `<li>- ${i}</li>`).join('') : '<li>- Nil</li>';
  
  return `
${PRECOMMITMENT_STYLES}
    <div class="page">
        <img src="/no-play-header.png" alt="SkyCity Adelaide" class="header" />
        <table class="letterhead">
          <tr>
            <td colspan="2">Member Account: ${playerInfo.playerAccount}</td>
          </tr>
          <tr>
            <td colspan="2">Streets: </td>
          </tr>
          <tr>
            <td colspan="2">Suburb: </td>
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
        <p>Your Active Pre-Commitment Rule/s as at ${statementDate} are:</p>
            
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
            ${renderList(consecutiveDaysF === '–' ? [] : [consecutiveDaysF])}
          </ul>
        </div>
        <p>SkyCity Adelaide is able to send statements by post or email. You are also able to access your statements via on-site kiosks.</p>
        <br>  
        <p>If you would like to have your MyPlay statement produced in another language please contact SkyCity Adelaide’s Rewards department either at the desks onsite, or by emailing marketing@skycityadelaide.com.au to see if that language is available.</p>
        <br><br><br>
        <p>Kind regards,</p>
        <p><strong>SkyCity Adelaide</strong></p>
        </div>
        <div class="footer-info">
            <p>This information is accurate as of and will not reflect any changes you make in MyPlay after this time.</p>
        </div>
    </div>
    ${hasSessionSummaries ? `
    <div class="page-break"></div>
    <div class="session-page">
        <div class="logo">
          ${logoDataUrl ? `<img src="${logoDataUrl}" alt="SkyCity Adelaide" />` : '<div class="text-logo">SKYCITY ADELAIDE</div>'}
        </div>
        <div class="member-info">
          <div>Member Account: ${playerInfo.playerAccount}</div>
          <div>Member Name: ${displayName}</div>
        </div>
        <h2 class="session-title">Session Performance Summary</h2>
        <table class="session-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Session Win</th>
              <th>Session Loss</th>
              <th>Session Nett</th>
            </tr>
          </thead>
          <tbody>
            ${sessionTableRows}
          </tbody>
        </table>
        <p class="session-note">
          Session information is shown exactly as provided in the uploaded template; review it with the member for accuracy.
        </p>
    </div>
    ` : ''}
  `;
}

export function generatePreCommitmentPDFHTML(player: PreCommitmentPlayer, logoDataUrl?: string): string {
  const inner = renderPreCommitmentPages(player, logoDataUrl);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkyCity Adelaide - No Play Pre-commitment Statement</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
</head>
<body>
  ${inner}
</body>
</html>
  `;
}
