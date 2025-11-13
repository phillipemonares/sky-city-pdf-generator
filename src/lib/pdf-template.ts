import { PlayerData, QuarterlyData } from '@/types/player-data';
import { formatNumber } from './number-formatter';
import { generateCashlessStatements as renderCashlessStatements } from './cs-pdf-template';
import { getQuarterEndDate, getQuarterMonths, getQuarterStartDate } from './pdf-shared';

export function generatePDFHTML(quarterlyData: QuarterlyData, playerData: PlayerData, logoDataUrl?: string): string {
  const { playerInfo, monthlyTotals, dailyTransactions } = playerData;
  
  // Generate cover letter, activity statement, and monthly cashless statements
  const coverLetter = generateCoverLetter(quarterlyData, playerData, logoDataUrl);
  const activityStatement = generateActivityStatement(quarterlyData, playerData, logoDataUrl);
  const cashlessStatements = renderCashlessStatements(quarterlyData, playerData, logoDataUrl);
  
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
            position: relative;
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

        .cashless-footer {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            bottom: 0.4in;
            width: calc(100% - 1in);
            font-size: 10px;
            line-height: 1.5;
        }

        .cashless-footer p {
            margin-bottom: 8px;
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

function generateCoverLetter(quarterlyData: QuarterlyData, playerData: PlayerData, logoDataUrl?: string): string {
  const { playerInfo } = playerData;
  const quarterStart = quarterlyData.statementPeriod?.startDate || getQuarterStartDate(quarterlyData.quarter, quarterlyData.year);
  const quarterEnd = quarterlyData.statementPeriod?.endDate || getQuarterEndDate(quarterlyData.quarter, quarterlyData.year);
  
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

function generateActivityStatement(quarterlyData: QuarterlyData, playerData: PlayerData, logoDataUrl?: string): string {
  const { playerInfo, monthlyTotals, dailyTransactions } = playerData;
  const quarterStart = quarterlyData.statementPeriod?.startDate || getQuarterStartDate(quarterlyData.quarter, quarterlyData.year);
  const quarterEnd = quarterlyData.statementPeriod?.endDate || getQuarterEndDate(quarterlyData.quarter, quarterlyData.year);
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
                    <td style="font-weight: bold;">${formatNumber(monthlyTotals.totalBetsPlaced)}</td>
                </tr> 
                <tr>
                    <td style="font-weight: bold;">Total Amount Won:</td>
                    <td style="font-weight: bold;">${formatNumber(monthlyTotals.totalDeviceWin)}</td>
                </tr> 
                <tr>
                    <td style="font-weight: bold;">Overall Net Win (+) / Loss (-):</td>
                    <td style="font-weight: bold;">${formatNumber(monthlyTotals.totalNetWinLoss)}</td>
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
              <td>${formatNumber(monthlyTotals.totalBetsPlaced / 3)}</td>
              <td>${Math.floor(dailyTransactions.length / 3)}</td>
              <td>${formatNumber(monthlyTotals.totalNetWinLoss / 3)}</td>
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

export { renderCashlessStatements as generateCashlessStatements };
