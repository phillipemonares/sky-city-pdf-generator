import Papa from 'papaparse';
import { CSVRow, PlayerData, PlayerInfo, MonthlyTotals, DailyTransaction, QuarterlyData } from '@/types/player-data';
import { parseCSVNumber, parseCSVDate } from './number-formatter';

export function parseCSVFile(csvContent: string): CSVRow[] {
  const result = Papa.parse<CSVRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  if (result.errors.length > 0) {
    console.warn('CSV parsing errors:', result.errors);
  }

  return result.data;
}

function getMonthFromFilename(filename?: string): number {
  if (!filename) return 0;
  
  const lowerFilename = filename.toLowerCase();
  
  // Map filenames to actual calendar month numbers
  const monthMappings: { match: string | RegExp; value: number }[] = [
    { match: /january|jan\b/, value: 1 },
    { match: /february|feb\b/, value: 2 },
    { match: /march|mar\b/, value: 3 },
    { match: /april|apr\b/, value: 4 },
    { match: /may\b/, value: 5 },
    { match: /june|jun\b/, value: 6 },
    { match: /july|jul\b/, value: 7 },
    { match: /august|aug\b/, value: 8 },
    { match: /september|sept|sep\b/, value: 9 },
    { match: /october|oct\b/, value: 10 },
    { match: /november|nov\b/, value: 11 },
    { match: /december|dec\b/, value: 12 },
  ];
  
  for (const { match, value } of monthMappings) {
    if (typeof match === 'string') {
      if (lowerFilename.includes(match)) {
        return value;
      }
    } else if (match.test(lowerFilename)) {
      return value;
    }
  }
  
  return 0;
}

export function transformCSVToPlayerData(csvRows: CSVRow[], filename?: string): PlayerData[] {
  const monthFromFilename = getMonthFromFilename(filename);
  
  return csvRows.map(row => {
    const playerInfo: PlayerInfo = {
      playerAccount: row['Player Account'] || '',
      salutation: row['PlayerSalutation'] || '',
      firstName: row['Player First Name'] || '',
      lastName: row['Player Last Name'] || '',
      email: row['Player Email Address'] || '',
      address1: row['Player Postal Address1'] || '',
      address2: row['Player Postal Address2'] || '',
      suburb: row['Suburb'] || '',
      state: row['State'] || '',
      postCode: row['PostCode'] || '',
      country: row['Country'] || '',
      playerType: row['Player Type'] || '',
      clubState: row['Club State'] || '',
    };

    const monthlyTotals: MonthlyTotals = {
      statementMonth: monthFromFilename || parseInt(row['Statement Month']) || 0,
      statementYear: parseInt(row['Statement Year']) || 0,
      totalCashToCard: parseCSVNumber(row['Total Cash to Card']),
      totalGameCreditToCard: parseCSVNumber(row['Total Game Credit to Card']),
      totalCardCreditToGame: parseCSVNumber(row['Total Card Credit to Game']),
      totalBetsPlaced: parseCSVNumber(row['Total Bets Placed']),
      totalDeviceWin: parseCSVNumber(row['Total Device Win']),
      totalNetWinLoss: parseCSVNumber(row['Total Net Win Loss']),
    };

    // Extract daily transactions (up to 31 days)
    const dailyTransactions: DailyTransaction[] = [];
    for (let i = 1; i <= 31; i++) {
      const gamingDate = parseCSVDate(row[`Gaming Date${i}`]);
      if (gamingDate) {
        dailyTransactions.push({
          gamingDate,
          cashToCard: parseCSVNumber(row[`Cash to Card${i}`]),
          gameCreditToCard: parseCSVNumber(row[`Game Credit to Card${i}`]),
          cardCreditToGame: parseCSVNumber(row[`Card Credit to Game${i}`]),
          betsPlaced: parseCSVNumber(row[`Bets Placed${i}`]),
          deviceWin: parseCSVNumber(row[`Device Win${i}`]),
          netWinLoss: parseCSVNumber(row[`Net Win Loss${i}`]),
        });
      }
    }

    return {
      playerInfo,
      monthlyTotals,
      dailyTransactions,
    };
  });
}

export function aggregateQuarterlyData(monthlyFiles: { month: number; year: number; data: PlayerData[] }[]): QuarterlyData {
  if (monthlyFiles.length === 0) {
    throw new Error('No monthly data provided');
  }

  // Determine quarter and year from the first month
  const firstMonth = monthlyFiles[0];
  const quarter = Math.ceil(firstMonth.month / 3);
  const year = firstMonth.year;

  // Group players by account number across all months
  const playerMap = new Map<string, PlayerData>();

  monthlyFiles.forEach(monthData => {
    monthData.data.forEach(player => {
      const accountKey = player.playerInfo.playerAccount;
      
      if (playerMap.has(accountKey)) {
        // Aggregate data for existing player
        const existingPlayer = playerMap.get(accountKey)!;
        
        // Add monthly totals
        existingPlayer.monthlyTotals.totalCashToCard += player.monthlyTotals.totalCashToCard;
        existingPlayer.monthlyTotals.totalGameCreditToCard += player.monthlyTotals.totalGameCreditToCard;
        existingPlayer.monthlyTotals.totalCardCreditToGame += player.monthlyTotals.totalCardCreditToGame;
        existingPlayer.monthlyTotals.totalBetsPlaced += player.monthlyTotals.totalBetsPlaced;
        existingPlayer.monthlyTotals.totalDeviceWin += player.monthlyTotals.totalDeviceWin;
        existingPlayer.monthlyTotals.totalNetWinLoss += player.monthlyTotals.totalNetWinLoss;
        
        // Add daily transactions
        existingPlayer.dailyTransactions.push(...player.dailyTransactions);
      } else {
        // Add new player
        playerMap.set(accountKey, { ...player });
      }
    });
  });

  // Sort daily transactions by date for each player
  playerMap.forEach(player => {
    player.dailyTransactions.sort((a, b) => 
      new Date(a.gamingDate).getTime() - new Date(b.gamingDate).getTime()
    );
  });

  return {
    quarter,
    year,
    players: Array.from(playerMap.values()),
    monthlyBreakdown: monthlyFiles.map(monthData => ({
      month: monthData.month,
      year: monthData.year,
      players: monthData.data.map(player => ({
        ...player,
        monthlyTotals: {
          ...player.monthlyTotals,
          statementMonth: monthData.month // Ensure month number matches the filename-based month
        }
      }))
    }))
  };
}

export function validateCSVStructure(csvRows: CSVRow[]): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (csvRows.length === 0) {
    errors.push('CSV file is empty');
    return { isValid: false, errors };
  }

  const requiredColumns = [
    'Player Account',
    'Player First Name',
    'Player Last Name',
    'Statement Month',
    'Statement Year',
    'Total Cash to Card',
    'Total Game Credit to Card',
    'Total Card Credit to Game',
    'Total Bets Placed',
    'Total Device Win',
    'Total Net Win Loss'
  ];

  const firstRow = csvRows[0];
  const missingColumns = requiredColumns.filter(col => !(col in firstRow));
  
  if (missingColumns.length > 0) {
    errors.push(`Missing required columns: ${missingColumns.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
