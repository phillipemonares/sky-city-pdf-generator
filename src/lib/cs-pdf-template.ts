import { DailyTransaction, PlayerData, QuarterlyData } from '@/types/player-data';
import { formatNumber } from './number-formatter';
import { getQuarterMonths, normalizeAccount, wrapNegativeValue } from './pdf-shared';

export const CS_STYLES = `
  .cashless-statement {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    flex: 1;
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
    flex-shrink: 0;
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
    margin-top: auto;
    text-align: center;
    font-size: 10px;
    line-height: 1.5;
    padding-top: 20px;
  }

  .cashless-footer p {
    margin-bottom: 8px;
  }

  .cashless-page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    background: white;
    padding: 40px;
    position: relative;
    display: flex;
    flex-direction: column;
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
      let monthTransactions =
        monthPlayerData?.dailyTransactions ??
        filterTransactionsByMonth(playerData.dailyTransactions, month, statementYear);
      
      // Deduplicate transactions by date - if same date exists, aggregate the values
      monthTransactions = deduplicateTransactionsByDate(monthTransactions);
      
      const statementPeriod = `${monthName} ${statementYear}`;

      // Pagination logic:
      // Page 1: 18 rows (or all rows if < 18)
      // Page 2+: 30 rows per page (max)
      // Special case: If totalRows < 18, totals go on page 2 with footer
      // Last page: If less than 20 rows, add footer
      const totalRows = monthTransactions.length;
      const pages: DailyTransaction[][] = [];
      const needsTotalsPage = totalRows > 0 && totalRows < 18; // Special case: totals on separate page if < 18 rows
      
      if (totalRows > 0) {
        if (needsTotalsPage) {
          // Special case: All rows on page 1, totals will go on page 2
          pages.push(monthTransactions);
        } else {
          // Normal case: Page 1 has 18 rows
          pages.push(monthTransactions.slice(0, 18));
          
          // Remaining pages: 30 rows each
          let startIndex = 18;
          while (startIndex < totalRows) {
            pages.push(monthTransactions.slice(startIndex, startIndex + 30));
            startIndex += 30;
          }
        }
      }

      const totalsRow = generateCashlessTotalsRow(monthTransactions);

      // Generate footer HTML
      const footerHTML = `
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
      `;

      // Generate pages HTML
      const pagesHTML = pages.map((pageRows, pageIndex) => {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === pages.length - 1;
        const pageRowCount = pageRows.length;
        
        // Footer logic:
        // - If special case (needsTotalsPage): footer only on page 2 (totals page)
        // - Otherwise: footer on last page if it has < 20 rows
        const shouldShowFooter = needsTotalsPage 
          ? false // Footer will be on the totals page (page 2)
          : (isLastPage && pageRowCount < 20);
        
        const tableRows = generateCashlessTableRows(pageRows);
        // Totals logic:
        // - If special case: totals on separate page (page 2)
        // - Otherwise: totals on last page
        const shouldShowTotals = needsTotalsPage ? false : isLastPage;

        if (isFirstPage) {
          // First page with header
          return `
    <div class="page-break"></div>
    <div class="cashless-page">
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
          Dear ${greetingName},
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
            ${tableRows}
            ${shouldShowTotals ? totalsRow : ''}
          </tbody>
        </table>
        ${shouldShowFooter ? footerHTML : ''}
      </div>
    </div>
          `;
        } else {
          // Subsequent pages (just table)
          return `
    <div class="page-break"></div>
    <div class="cashless-page">
      <div class="cashless-statement">
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
            ${tableRows}
            ${shouldShowTotals ? totalsRow : ''}
          </tbody>
        </table>
        ${shouldShowFooter ? footerHTML : ''}
      </div>
    </div>
          `;
        }
      }).join('');

      // Add totals page if needed (special case: totalRows < 18)
      const totalsPageHTML = needsTotalsPage ? `
    <div class="page-break"></div>
    <div class="cashless-page">
      <div class="cashless-statement">
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
            ${totalsRow}
          </tbody>
        </table>
        ${footerHTML}
      </div>
    </div>
      ` : '';

      return pagesHTML + totalsPageHTML;
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

function deduplicateTransactionsByDate(transactions: DailyTransaction[]): DailyTransaction[] {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return transactions;
  }

  // Use a Map to aggregate transactions by date
  const dateMap = new Map<string, DailyTransaction>();

  transactions.forEach(transaction => {
    if (!transaction?.gamingDate) {
      return;
    }

    const dateKey = transaction.gamingDate.trim();
    
    if (dateMap.has(dateKey)) {
      // Aggregate values for duplicate dates
      const existing = dateMap.get(dateKey)!;
      dateMap.set(dateKey, {
        gamingDate: dateKey,
        cashToCard: (existing.cashToCard || 0) + (transaction.cashToCard || 0),
        cardCreditToGame: (existing.cardCreditToGame || 0) + (transaction.cardCreditToGame || 0),
        gameCreditToCard: (existing.gameCreditToCard || 0) + (transaction.gameCreditToCard || 0),
        betsPlaced: (existing.betsPlaced || 0) + (transaction.betsPlaced || 0),
        deviceWin: (existing.deviceWin || 0) + (transaction.deviceWin || 0),
        netWinLoss: (existing.netWinLoss || 0) + (transaction.netWinLoss || 0),
      });
    } else {
      // First occurrence of this date
      dateMap.set(dateKey, { ...transaction });
    }
  });

  // Convert back to array and sort by date
  const deduplicated = Array.from(dateMap.values());
  deduplicated.sort((a, b) => {
    try {
      return new Date(a.gamingDate).getTime() - new Date(b.gamingDate).getTime();
    } catch {
      // If date parsing fails, keep original order
      return 0;
    }
  });

  return deduplicated;
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


