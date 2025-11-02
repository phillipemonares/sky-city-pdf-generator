import { DailyTransaction, PlayerData, QuarterlyData } from '@/types/player-data';
import { formatNumber } from './number-formatter';
import { getQuarterMonths, normalizeAccount, wrapNegativeValue } from './pdf-shared';

export const CS_STYLES = `
  .cashless-statement {
    margin-bottom: 30px;
  }

  .cashless-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
  }

  .cashless-title {
    font-size: 16px;
    font-weight: bold;
    text-align: left;
  }

  .account-info {
    margin-bottom: 10px;
    text-align: left;
  }

  .contact-enquiry {
    font-size: 10px;
    margin-bottom: 15px;
    text-align: center;
    width: 100%;
  }

  .green-text {
    color: #008000;
  }

  .salutation-section {
    margin-top: 30px;
  }

  .cashless-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
  }

  .cashless-table th,
  .cashless-table td {
    border: 1px solid #000;
    padding: 6px;
    text-align: right;
  }

  .cashless-table th {
    font-weight: bold;
    text-align: center;
  }

  .cashless-table th:first-child,
  .cashless-table td:first-child {
    text-align: left;
  }

  .total-row {
    font-weight: bold;
  }

  .cashless-footer {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 40px;
    width: calc(100% - 80px);
    font-size: 10px;
    line-height: 1.5;
  }

  .cashless-footer p {
    margin-bottom: 8px;
  }

  .negative-value {
    color: #c53030;
  }
`;

export function generateCashlessStatements(
  quarterlyData: QuarterlyData,
  playerData: PlayerData,
  logoDataUrl?: string,
  salutationOverride?: string,
  displayNameOverride?: string
): string {
  const { playerInfo } = playerData;
  const normalizedAccount = normalizeAccount(playerInfo.playerAccount);
  const quarterMonths = getQuarterMonths(quarterlyData.quarter, quarterlyData.year);
  const fallbackSalutation = [playerInfo.firstName, playerInfo.lastName]
    .map(name => (name ?? '').toString().trim())
    .filter(Boolean)
    .join(' ');
  const fallbackDisplayName = [playerInfo.firstName, playerInfo.lastName]
    .map(name => (name ?? '').toString().trim())
    .filter(Boolean)
    .join(' ');
  const greetingName = salutationOverride || fallbackSalutation || 'Member';
  const displayName = displayNameOverride || fallbackDisplayName || greetingName;

  return quarterMonths
    .map(({ name: monthName, month }) => {
      const monthData = quarterlyData.monthlyBreakdown.find(entry => entry.month === month);
      const statementYear = monthData?.year ?? quarterlyData.year;
      const monthPlayerData = monthData?.players.find(
        p => normalizeAccount(p.playerInfo.playerAccount) === normalizedAccount
      );
      const monthTransactions =
        monthPlayerData?.dailyTransactions ??
        filterTransactionsByMonth(playerData.dailyTransactions, month, statementYear);
      const statementPeriod = `${monthName} ${statementYear}`;

      return `
    <div class="page-break"></div>
    <div class="page">
      <div class="cashless-statement">
        <div class="cashless-header">
          <div class="logo">
            ${
              logoDataUrl
                ? `<img src="${logoDataUrl}" alt="SkyCity Adelaide" />`
                : '<div class="text-logo">SKYCITY ADELAIDE</div>'
            }
          </div>
        </div>
        <table width="100%">
          <tr>
            <td width="50%">${displayName}</td>
            <td><h3>CASHLESS STATEMENT</h3></td>
          </tr>
          <tr>
            <td>${playerInfo.address1}</td>
            <td>Account Number: ${playerInfo.playerAccount}</td>
          </tr>
          <tr>
            <td>${playerInfo.address2 || ''}</td>
            <td>Statement Period: ${statementPeriod}</td>
          </tr>
          <tr>
            <td>${playerInfo.suburb}</td>
            <td>Enquiries: Please visit the Rewards Desk or call our Customer Care Centre on</td>
          </tr>
          <tr>
            <td>${playerInfo.state} ${playerInfo.postCode}</td>
            <td>(08) 8212 2811</td>
          </tr>
        </table>
        
        <div class="salutation-section">
          <div class="green-text">Dear ${greetingName},</div>
        </div>
        
        <div class="statement-intro">
          Please find below your cashless gaming activity for ${statementPeriod}. For any month in which you have engaged in cashless gaming we are required to send you a statement of activity.
        </div>
        
        <table class="cashless-table">
          <thead>
            <tr>
              <th></th>
              <th colspan="3">CASHLESS ACCOUNT ACTIVITY</th>
              <th colspan="3">GAMING ACTIVITY</th>
            </tr>
            <tr>
              <th>Date</th>
              <th>Cashless Card Deposit</th>
              <th>Credits Transferred From Card to Game</th>
              <th>Credits Transferred From Game to Card</th>
              <th>Total Amount Bet</th>
              <th>Total Amount Won</th>
              <th>Net Amount Won or -(Lost)</th>
            </tr>
          </thead>
          <tbody>
            ${generateCashlessTableRows(monthTransactions)}
            ${generateCashlessTotalsRow(monthTransactions)}
          </tbody>
        </table>

        <div class="cashless-footer">
          <p>
            <strong>DATE:</strong> Refers to any day that a cashless transaction has taken place.
            <strong>CASHLESS CARD DEPOSITS:</strong> Refers to money placed on your cashless account at either an EZYplay terminal or cashier.
            <strong>CREDITS TRANSFERRED FROM CARD TO GAME:</strong> Refers to credits (in dollar amounts) transferred from your cashless account to an electronic gaming machine or electronic table game.
            <strong>TOTAL AMOUNT BET:</strong> This is the accumulative total dollar amount wagered on all spins or hands you have played.
            <strong>CREDITS TRANSFERRED FROM GAME TO CARD:</strong> Refers to credits (in dollar amounts) transferred from an electronic gaming machine or electronic table game to your cashless account.
            <strong>TOTAL AMOUNT WON:</strong> This is the accumulative amount (in dollars) won by you.
            <strong>NET AMOUNT WON OR -(LOST):</strong> This is the difference between Bets Placed and Player Win from Game.
          </p>
          <p><strong><u>Further Information</u></strong></p>
          <p>
            This is not a complete record of your play. This statement only includes transactions made using your cashless account and daily gaming activity where your cashless account has been used at least once on that day and only includes months where your delivery preference was email or post. This statement is a regulatory requirement, is only sent to you and remains confidential. Please continue to use your card when playing as earning points is the best way to gain the most benefit from your membership.
          </p>
          <p>
            SkyCity Adelaide has a pre-commitment program (known as MyPlay) that allows customers to set individual limits to help them control their gaming on electronic gaming machines and electronic table games. Customers may limit the amount of money they wish to spend, the amount of time they wish to spend at the venue, and the number of visits they wish to make. The Host Responsibility team is available to assist customers with setting up personal pre-commitment limits. Visit https://skycityadelaide.com.au/about-us/host-responsibility/my-play/ for more information regarding MyPlay or ask venue staff for details. If you or someone you know needs help, please get in touch with our specially trained staff by calling (08) 8212 2811 and ask to be put through to HRC. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.
          </p>
        </div>
      </div>
    </div>
  `;
    })
    .join('');
}

const highlightNumericValue = (value: string | number | null | undefined): string =>
  wrapNegativeValue(formatNumber(value));

function generateCashlessTableRows(dailyTransactions: DailyTransaction[]): string {
  if (!dailyTransactions.length) {
    return '<tr><td colspan="7">No transactions for this month</td></tr>';
  }

  return dailyTransactions
    .map(
      transaction => `
    <tr>
      <td>${transaction.gamingDate}</td>
      <td>${highlightNumericValue(transaction.cashToCard)}</td>
      <td>${highlightNumericValue(transaction.cardCreditToGame)}</td>
      <td>${highlightNumericValue(transaction.gameCreditToCard)}</td>
      <td>${highlightNumericValue(transaction.betsPlaced)}</td>
      <td>${highlightNumericValue(transaction.deviceWin)}</td>
      <td>${highlightNumericValue(transaction.netWinLoss)}</td>
    </tr>
  `
    )
    .join('');
}

function generateCashlessTotalsRow(dailyTransactions: DailyTransaction[]): string {
  const totals = dailyTransactions.reduce(
    (acc, transaction) => ({
      totalCashToCard: acc.totalCashToCard + (transaction.cashToCard || 0),
      totalCardCreditToGame: acc.totalCardCreditToGame + (transaction.cardCreditToGame || 0),
      totalGameCreditToCard: acc.totalGameCreditToCard + (transaction.gameCreditToCard || 0),
      totalBetsPlaced: acc.totalBetsPlaced + (transaction.betsPlaced || 0),
      totalDeviceWin: acc.totalDeviceWin + (transaction.deviceWin || 0),
      totalNetWinLoss: acc.totalNetWinLoss + (transaction.netWinLoss || 0),
    }),
    {
      totalCashToCard: 0,
      totalCardCreditToGame: 0,
      totalGameCreditToCard: 0,
      totalBetsPlaced: 0,
      totalDeviceWin: 0,
      totalNetWinLoss: 0,
    }
  );

  return `
    <tr class="total-row">
      <td>TOTAL</td>
      <td>${highlightNumericValue(totals.totalCashToCard)}</td>
      <td>${highlightNumericValue(totals.totalCardCreditToGame)}</td>
      <td>${highlightNumericValue(totals.totalGameCreditToCard)}</td>
      <td>${highlightNumericValue(totals.totalBetsPlaced)}</td>
      <td>${highlightNumericValue(totals.totalDeviceWin)}</td>
      <td>${highlightNumericValue(totals.totalNetWinLoss)}</td>
    </tr>
  `;
}

function filterTransactionsByMonth(
  transactions: DailyTransaction[],
  targetMonth: number,
  targetYear: number
): DailyTransaction[] {
  if (!Array.isArray(transactions)) {
    return [];
  }

  return transactions.filter(transaction => {
    if (!transaction?.gamingDate) {
      return false;
    }

    const parts = transaction.gamingDate.split(/[\/\-]/).map(part => part.trim());
    if (parts.length < 3) {
      return false;
    }

    let dayPart: string;
    let monthPart: string;
    let yearPart: string;

    if (parts[0].length === 4) {
      [yearPart, monthPart, dayPart] = parts;
    } else {
      [dayPart, monthPart, yearPart] = parts;
    }

    const monthNumber = parseInt(monthPart, 10);
    const yearNumber = parseInt(yearPart, 10);

    if (Number.isNaN(monthNumber)) {
      return false;
    }

    if (!Number.isNaN(yearNumber) && yearNumber !== targetYear) {
      return false;
    }

    return monthNumber === targetMonth;
  });
}


