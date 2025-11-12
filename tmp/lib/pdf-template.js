"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePDFHTML = generatePDFHTML;
const number_formatter_1 = require("./number-formatter");
function generatePDFHTML(quarterlyData, playerData, logoDataUrl) {
    const { playerInfo, monthlyTotals, dailyTransactions } = playerData;
    // Generate cover letter, activity statement, and monthly cashless statements
    const coverLetter = generateCoverLetter(quarterlyData, playerData, logoDataUrl);
    const activityStatement = generateActivityStatement(quarterlyData, playerData, logoDataUrl);
    const cashlessStatements = generateCashlessStatements(quarterlyData, playerData, logoDataUrl);
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sky City Adelaide - Quarterly Statement</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <style>
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
            width: 8.5in;
            min-height: 11in;
            padding: 0.5in;
            margin: 0 auto;
            background: white;
        }
        
        .page-break {
            page-break-before: always;
        }
        
        /* Cover Letter Styles */
        .cover-letter {
            margin-bottom: 20px;
        }
        
        .logo {
            margin-bottom: 20px;
        }
        
        .logo img {
            height: 60px;
            width: auto;
        }
        
        .text-logo {
            font-size: 24px;
            font-weight: bold;
            color: #000;
        }
        
        .address-block {
            margin-bottom: 30px;
        }
        
        .member-info {
            text-align: right;
            margin-bottom: 20px;
        }
        
        .member-number {
            color: #008000;
            font-weight: bold;
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
        
        .myplay-section {
            margin: 20px 0;
            padding: 0;
        }
        
        .contact-info {
            margin: 20px 0;
        }
        
        .closing {
            margin-top: 30px;
        }
        
        /* Activity Statement Styles */
        .activity-statement {
            margin-bottom: 30px;
        }
        
        .activity-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 20px;
            text-align: center;
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
            margin-bottom: 20px;
        }
        
        .summary-section td {
            padding: 8px;
            border: none;
            font-weight: 700 !important;
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
        
        .monthly-table th {
            font-weight: bold;
        }
        
        .notes-section {
            margin-top: 30px;
            padding: 0;
        }
        
        .notes-section h4 {
            margin-bottom: 10px;
        }
        
        .notes-section ol {
            padding-left: 20px;
        }
        
        .notes-section li {
            margin-bottom: 8px;
        }
        
        /* Cashless Statement Styles */
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
        
        .address-section {
            margin-bottom: 20px;
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
        
        .definitions-section {
            margin: 20px 0;
            padding: 15px;
            background: #f9f9f9;
        }
        
        .definitions-section h4 {
            margin-bottom: 10px;
        }
        
        .definitions-section p {
            margin-bottom: 5px;
        }
        
        .further-info {
            margin: 20px 0;
            padding: 15px;
            background: #f9f9f9;
        }
        
        .responsible-gaming {
            margin: 20px 0;
            padding: 15px;
            background: #f9f9f9;
            border-left: 4px solid #008000;
        }
    </style>
</head>
<body>
    ${coverLetter}
    <div class="page-break"></div>
    ${activityStatement}
    ${cashlessStatements}
</body>
</html>
  `;
}
function generateCoverLetter(quarterlyData, playerData, logoDataUrl) {
    const { playerInfo } = playerData;
    const quarterStart = getQuarterStartDate(quarterlyData.quarter, quarterlyData.year);
    const quarterEnd = getQuarterEndDate(quarterlyData.quarter, quarterlyData.year);
    return `
    <div class="page">
      <div class="cover-letter">
        <div class="logo">
          ${logoDataUrl ? `<img src="${logoDataUrl}" alt="SkyCity Adelaide" />` : '<div class="text-logo">SKYCITY ADELAIDE</div>'}
        </div>
        
        <div class="address-block">
          <div>${playerInfo.firstName} ${playerInfo.lastName}</div>
          <div>${playerInfo.address1}</div>
          ${playerInfo.address2 ? `<div>${playerInfo.address2}</div>` : ''}
          <div>${playerInfo.suburb}</div>
          <div>${playerInfo.state} ${playerInfo.postCode}</div>
        </div>
        
        <div class="member-info">
          <div class="member-number">Member Number: ${playerInfo.playerAccount}</div>
        </div>
        
        <div class="salutation">Dear ${playerInfo.firstName},</div>
        
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
    </div>
  `;
}
function generateActivityStatement(quarterlyData, playerData, logoDataUrl) {
    const { playerInfo, monthlyTotals, dailyTransactions } = playerData;
    const quarterStart = getQuarterStartDate(quarterlyData.quarter, quarterlyData.year);
    const quarterEnd = getQuarterEndDate(quarterlyData.quarter, quarterlyData.year);
    const quarterMonths = getQuarterMonths(quarterlyData.quarter, quarterlyData.year);
    return `
    <div class="page">
      <div class="activity-statement">
        <div class="logo">
          ${logoDataUrl ? `<img src="${logoDataUrl}" alt="SkyCity Adelaide" />` : '<div class="text-logo">SKYCITY ADELAIDE</div>'}
        </div>
        
        <div class="activity-title">PLAYER ACTIVITY STATEMENT</div>
        
        <div class="statement-period">
          <div>Member Number: ${playerInfo.playerAccount}</div>
          <div>Statement Period: ${quarterStart} - ${quarterEnd}</div>
        </div>
        
        <div class="summary-section">
            <table>
                <tr>
                    <td style="font-weight: bold;">Total Amount Bet:</td>
                    <td style="font-weight: bold;">${(0, number_formatter_1.formatNumber)(monthlyTotals.totalBetsPlaced)}</td>
                </tr> 
                <tr>
                    <td style="font-weight: bold;">Total Amount Won:</td>
                    <td style="font-weight: bold;">${(0, number_formatter_1.formatNumber)(monthlyTotals.totalDeviceWin)}</td>
                </tr> 
                <tr>
                    <td style="font-weight: bold;">Overall Net Win (+) / Loss (-):</td>
                    <td style="font-weight: bold;">${(0, number_formatter_1.formatNumber)(monthlyTotals.totalNetWinLoss)}</td>
                </tr> 
                <tr>
                    <td style="font-weight: bold;">Total Number of Days Gambled:</td>
                    <td style="font-weight: bold;">${dailyTransactions.length}</td>
                </tr>    
            </table>
        </div>
        
        <table class="monthly-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Total Amount Bet</th>
              <th>No. of Days Gambled</th>
              <th>Net Amount Won (+)/Lost (-)</th>
            </tr>
          </thead>
          <tbody>
            ${quarterMonths.map(monthInfo => `
            <tr>
              <td>${monthInfo.name} ${quarterlyData.year}</td>
              <td>${(0, number_formatter_1.formatNumber)(monthlyTotals.totalBetsPlaced / 3)}</td>
              <td>${Math.floor(dailyTransactions.length / 3)}</td>
              <td>${(0, number_formatter_1.formatNumber)(monthlyTotals.totalNetWinLoss / 3)}</td>
            </tr>
            `).join('')}
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
    </div>
  `;
}
function generateCashlessStatements(quarterlyData, playerData, logoDataUrl) {
    const { playerInfo } = playerData;
    console.log('Generating cashless statements for player:', playerInfo.playerAccount);
    console.log('Monthly breakdown:', quarterlyData.monthlyBreakdown.map(m => ({ month: m.month, year: m.year, playerCount: m.players.length })));
    // Generate cashless statements for each month in the quarterly data
    return quarterlyData.monthlyBreakdown.map(monthData => {
        // Find the player data for this specific month
        const monthPlayerData = monthData.players.find(p => p.playerInfo.playerAccount === playerData.playerInfo.playerAccount);
        if (!monthPlayerData) {
            return ''; // Skip if no data for this player in this month
        }
        const monthLabel = getMonthName(monthData.month) || `Month ${monthData.month}`;
        const statementPeriod = monthData.year
            ? `${monthLabel} ${monthData.year}`
            : monthLabel;
        return `
    <div class="page-break"></div>
    <div class="page">
      <div class="cashless-statement">
        <div class="cashless-header">
          <div class="logo">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="SkyCity Adelaide" />` : '<div class="text-logo">SKYCITY ADELAIDE</div>'}
          </div>
        </div>
        <table width="100%">
          <tr>
            <td width="50%">${playerInfo.firstName} ${playerInfo.lastName}</td>
            <td><h3>CASHLESS STATEMENT</h3></td>
          </tr>
          <tr>
            <td>${playerInfo.address1}</td>
            <td>Account Number: ${playerInfo.playerAccount}</td>
          </tr>
          <tr>
            <td>${playerInfo.address2}</td>
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
          <div class="green-text">Dear ${playerInfo.firstName}.</div>
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
            ${generateCashlessTableRows(monthPlayerData.dailyTransactions)}
            ${generateCashlessTotalsRow(monthPlayerData.dailyTransactions)}
          </tbody>
        </table>
        
        <small>
          <strong>DATE:</strong>
          Refers to any day that a cashless transaction has taken place.
          <strong>CASHLESS CARD DEPOSITS:</strong> Refers to money placed on your cashless account at either an EZYplay terminal or cashier.
          <strong>CREDITS TRANSFERRED FROM CARD TO GAME:</strong> Refers to credits (in dollar amounts) transferred from your cashless account to a electronic gaming machine or electronic table game.
          <strong>TOTAL AMOUNT BET:</strong> This is the accumulative total dollar amount wagered on all spins or hands you have played.
          <strong>CREDITS TRANSFERRED FROM GAME TO CARD:</strong> Refers to credits (in dollar amounts) transferred from an electronic gaming machine or electronic table game to your cashless account.
          <strong>TOTAL AMOUNT WON:</strong> This is the accumulative amount (in dollars) won by you.
          <strong>NET AMOUNT WON OR -(LOST):</strong> This is the difference between Bets Placed and Player Win from Game.
        </small>
        <br><br>
        <small><u>Further Information</u></small><br>
        <small>
          This is not a complete record of your play. This statement only includes transactions made using your cashless account and daily gaming activity where your cashless account has been used at least once on that day and only includes months where your delivery preference was email or post. This statement is a regulatory requirement, is only sent to you and remains confidential. Please continue to use your card when playing as earning points is the best way to gain the most benefit from your membership.
        </small>
        <br><br>
        <small>
          SkyCity Adelaide has a pre-commitment program (known as MyPlay) that allows customers to set individual limits to help them control their gaming on electronic gaming machines and electronic table games. Customers may limit the amount of money they wish to spend, the amount of time they wish to spend at the venue, and the number of visits they wish to make. The Host Responsibility team is available to assist customers with setting up personal pre-commitment limits. Visit https://skycityadelaide.com.au/about-us/host-responsibility/my-play/ for more information regarding MyPlay or ask venue staff for details. If you are someone you know needs help, please get in touch with our specially trained staff by calling (08) 8212 2811 and ask to be put through to HRC. Alternatively, you can contact the National Gambling Helpline on 1800 858 858. Available 24/7.
        </small>
      </div>
    </div>
  `;
    }).join('');
}
function generateCashlessTableRows(dailyTransactions) {
    if (dailyTransactions.length === 0) {
        return '<tr><td colspan="7">No transactions for this month</td></tr>';
    }
    return dailyTransactions.map(transaction => `
    <tr>
      <td>${transaction.gamingDate}</td>
      <td>${(0, number_formatter_1.formatNumber)(transaction.cashToCard)}</td>
      <td>${(0, number_formatter_1.formatNumber)(transaction.cardCreditToGame)}</td>
      <td>${(0, number_formatter_1.formatNumber)(transaction.gameCreditToCard)}</td>
      <td>${(0, number_formatter_1.formatNumber)(transaction.betsPlaced)}</td>
      <td>${(0, number_formatter_1.formatNumber)(transaction.deviceWin)}</td>
      <td>${(0, number_formatter_1.formatNumber)(transaction.netWinLoss)}</td>
    </tr>
  `).join('');
}
function generateCashlessTotalsRow(dailyTransactions) {
    // Calculate totals for this month's transactions
    const totals = dailyTransactions.reduce((acc, transaction) => ({
        totalCashToCard: acc.totalCashToCard + (transaction.cashToCard || 0),
        totalCardCreditToGame: acc.totalCardCreditToGame + (transaction.cardCreditToGame || 0),
        totalGameCreditToCard: acc.totalGameCreditToCard + (transaction.gameCreditToCard || 0),
        totalBetsPlaced: acc.totalBetsPlaced + (transaction.betsPlaced || 0),
        totalDeviceWin: acc.totalDeviceWin + (transaction.deviceWin || 0),
        totalNetWinLoss: acc.totalNetWinLoss + (transaction.netWinLoss || 0)
    }), {
        totalCashToCard: 0,
        totalCardCreditToGame: 0,
        totalGameCreditToCard: 0,
        totalBetsPlaced: 0,
        totalDeviceWin: 0,
        totalNetWinLoss: 0
    });
    return `
    <tr class="total-row">
      <td>TOTAL</td>
      <td>${(0, number_formatter_1.formatNumber)(totals.totalCashToCard)}</td>
      <td>${(0, number_formatter_1.formatNumber)(totals.totalCardCreditToGame)}</td>
      <td>${(0, number_formatter_1.formatNumber)(totals.totalGameCreditToCard)}</td>
      <td>${(0, number_formatter_1.formatNumber)(totals.totalBetsPlaced)}</td>
      <td>${(0, number_formatter_1.formatNumber)(totals.totalDeviceWin)}</td>
      <td>${(0, number_formatter_1.formatNumber)(totals.totalNetWinLoss)}</td>
    </tr>
  `;
}
function getQuarterStartDate(quarter, year) {
    const startMonths = [1, 4, 7, 10];
    const month = startMonths[quarter - 1];
    return `01/${month.toString().padStart(2, '0')}/${year}`;
}
function getQuarterEndDate(quarter, year) {
    const endMonths = [3, 6, 9, 12];
    const month = endMonths[quarter - 1];
    const daysInMonth = new Date(year, month, 0).getDate();
    return `${daysInMonth}/${month.toString().padStart(2, '0')}/${year}`;
}
function getQuarterMonths(quarter, year) {
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const startMonths = [1, 4, 7, 10]; // Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec
    const startMonth = startMonths[quarter - 1];
    return [
        { name: monthNames[startMonth - 1], month: startMonth },
        { name: monthNames[startMonth], month: startMonth + 1 },
        { name: monthNames[startMonth + 1], month: startMonth + 2 }
    ];
}
function getMonthName(month) {
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return monthNames[month - 1];
}
