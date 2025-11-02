import { readFileSync } from 'fs';
import { parseCSVFile, transformCSVToPlayerData, aggregateQuarterlyData, validateCSVStructure } from './src/lib/csv-parser';
import { formatNumber } from './src/lib/number-formatter';

// Test the CSV parsing with the provided test files
async function testCSVParsing() {
  try {
    console.log('Testing CSV parsing with provided test files...\n');

    // Read the test CSV files
    const julyCSV = readFileSync('./test/july.csv', 'utf-8');
    const augustCSV = readFileSync('./test/august.csv', 'utf-8');
    const septemberCSV = readFileSync('./test/september.csv', 'utf-8');

    // Parse each CSV file
    const julyData = parseCSVFile(julyCSV);
    const augustData = parseCSVFile(augustCSV);
    const septemberData = parseCSVFile(septemberCSV);

    console.log(`July CSV: ${julyData.length} rows`);
    console.log(`August CSV: ${augustData.length} rows`);
    console.log(`September CSV: ${septemberData.length} rows\n`);

    // Validate CSV structure
    const julyValidation = validateCSVStructure(julyData);
    const augustValidation = validateCSVStructure(augustData);
    const septemberValidation = validateCSVStructure(septemberData);

    console.log('CSV Validation Results:');
    console.log(`July: ${julyValidation.isValid ? 'Valid' : 'Invalid'}`);
    if (!julyValidation.isValid) console.log(`  Errors: ${julyValidation.errors.join(', ')}`);
    
    console.log(`August: ${augustValidation.isValid ? 'Valid' : 'Invalid'}`);
    if (!augustValidation.isValid) console.log(`  Errors: ${augustValidation.errors.join(', ')}`);
    
    console.log(`September: ${septemberValidation.isValid ? 'Valid' : 'Invalid'}`);
    if (!septemberValidation.isValid) console.log(`  Errors: ${septemberValidation.errors.join(', ')}\n`);

    // Transform to player data
    const julyPlayers = transformCSVToPlayerData(julyData);
    const augustPlayers = transformCSVToPlayerData(augustData);
    const septemberPlayers = transformCSVToPlayerData(septemberData);

    console.log(`July Players: ${julyPlayers.length}`);
    console.log(`August Players: ${augustPlayers.length}`);
    console.log(`September Players: ${septemberPlayers.length}\n`);

    // Test number formatting
    console.log('Number Formatting Tests:');
    console.log(`Positive number: ${formatNumber(1350)}`);
    console.log(`Negative number: ${formatNumber(-390.2)}`);
    console.log(`Round number: ${formatNumber(100)}`);
    console.log(`Empty value: ${formatNumber('')}`);
    console.log(`Null value: ${formatNumber(null)}\n`);

    // Aggregate quarterly data
    const monthlyFiles = [
      { month: 7, year: 2024, data: julyPlayers },
      { month: 8, year: 2024, data: augustPlayers },
      { month: 9, year: 2024, data: septemberPlayers }
    ];

    const quarterlyData = aggregateQuarterlyData(monthlyFiles);
    
    console.log('Quarterly Data Summary:');
    console.log(`Quarter: Q${quarterlyData.quarter} ${quarterlyData.year}`);
    console.log(`Total Players: ${quarterlyData.players.length}\n`);

    // Show sample player data
    if (quarterlyData.players.length > 0) {
      const samplePlayer = quarterlyData.players[0];
      console.log('Sample Player Data:');
      console.log(`Account: ${samplePlayer.playerInfo.playerAccount}`);
      console.log(`Name: ${samplePlayer.playerInfo.salutation} ${samplePlayer.playerInfo.firstName} ${samplePlayer.playerInfo.lastName}`);
      console.log(`Email: ${samplePlayer.playerInfo.email}`);
      console.log(`Player Type: ${samplePlayer.playerInfo.playerType}`);
      console.log(`Total Cash to Card: ${formatNumber(samplePlayer.monthlyTotals.totalCashToCard)}`);
      console.log(`Total Net Win/Loss: ${formatNumber(samplePlayer.monthlyTotals.totalNetWinLoss)}`);
      console.log(`Daily Transactions: ${samplePlayer.dailyTransactions.length}`);
    }

    console.log('\n✅ CSV parsing test completed successfully!');

  } catch (error) {
    console.error('❌ Error during CSV parsing test:', error);
  }
}

testCSVParsing();

