// Player data interfaces based on CSV structure
export interface PlayerInfo {
  playerAccount: string;
  salutation: string;
  firstName: string;
  lastName: string;
  email: string;
  address1: string;
  address2: string;
  suburb: string;
  state: string;
  postCode: string;
  country: string;
  playerType: string;
  clubState: string;
}

export interface MonthlyTotals {
  statementMonth: number;
  statementYear: number;
  totalCashToCard: number;
  totalGameCreditToCard: number;
  totalCardCreditToGame: number;
  totalBetsPlaced: number;
  totalDeviceWin: number;
  totalNetWinLoss: number;
}

export interface DailyTransaction {
  gamingDate: string;
  cashToCard: number;
  gameCreditToCard: number;
  cardCreditToGame: number;
  betsPlaced: number;
  deviceWin: number;
  netWinLoss: number;
}

export interface PlayerData {
  playerInfo: PlayerInfo;
  monthlyTotals: MonthlyTotals;
  dailyTransactions: DailyTransaction[];
}

export interface QuarterlyData {
  quarter: number;
  year: number;
  players: PlayerData[];
  monthlyBreakdown: { month: number; year: number; players: PlayerData[] }[];
  statementPeriod?: {
    startDate: string; // Format: DD/MM/YYYY
    endDate: string;   // Format: DD/MM/YYYY
  };
}

export interface CSVRow {
  'Player Account': string;
  'PlayerSalutation': string;
  'Player First Name': string;
  'Player Last Name': string;
  'Player Email Address': string;
  'Player Postal Address1': string;
  'Player Postal Address2': string;
  'Suburb': string;
  'State': string;
  'PostCode': string;
  'Country': string;
  'Player Type': string;
  'Club State': string;
  'Statement Month': string;
  'Statement Year': string;
  'Total Cash to Card': string;
  'Total Game Credit to Card': string;
  'Total Card Credit to Game': string;
  'Total Bets Placed': string;
  'Total Device Win': string;
  'Total Net Win Loss': string;
  [key: string]: string; // For dynamic daily transaction columns
}

export interface PDFGenerationRequest {
  quarterlyData: QuarterlyData;
  includeActivitySummary: boolean;
  includeCashless: boolean;
}

export interface PDFGenerationResponse {
  success: boolean;
  pdfBuffer?: Buffer;
  error?: string;
}

export interface AnnotatedPDFGenerationRequest {
  activityRows: ActivityStatementRow[];
  preCommitmentPlayers: PreCommitmentPlayer[];
  quarterlyData: QuarterlyData;
  account?: string;
}

// Pre-commitment specific interfaces
export interface PreCommitmentSessionSummary {
  session: string;
  sessionWin: string;
  sessionLoss: string;
  sessionNett: string;
}

export interface ActivityStatementRow {
  acct: string;
  title: string;
  firstName: string;
  lastName: string;
  email: string;
  address: string;
  suburb: string;
  state: string;
  postCode: string;
  country: string;
  playerType: string;
  emailTick: string;
  postalTick: string;
  kioskTick: string;
  gamingDays: string;
  totalTurnover: string;
  playerWin: string;
  totalAmountWon: string;
  totalTimeSpentHour: string;
  totalTimeSpentMinute: string;
  month1Name: string;
  month1TotalAmountBet: string;
  month1NoDaysGambled: string;
  month1NetAmountWonOrLost: string;
  month1TimeSpentHour: string;
  month1TimeSpentMinute: string;
  month2Name: string;
  month2TotalAmountBet: string;
  month2NoDaysGambled: string;
  month2NetAmountWonOrLost: string;
  month2TimeSpentHour: string;
  month2TimeSpentMinute: string;
  month3Name: string;
  month3TotalAmountBet: string;
  month3NoDaysGambled: string;
  month3NetAmountWonOrLost: string;
  month3TimeSpentHour: string;
  month3TimeSpentMinute: string;
  channelTag: string;
}

export interface PreCommitmentPlayer {
  playerInfo: PlayerInfo;
  statementPeriod: string;
  statementDate: string;
  noPlayStatus: string;
  enrollmentStatus?: string;
  startDay?: string;
  consecutiveDays?: string;
  dailyBudget?: string;
  dailyTime?: string;
  weeklyBudget?: string;
  weeklyTime?: string;
  monthlyBudget?: string;
  monthlyTime?: string;
  breaches?: string;
  // Daily schedule fields
  monStart?: string;
  monEnd?: string;
  tueStart?: string;
  tueEnd?: string;
  wedStart?: string;
  wedEnd?: string;
  thuStart?: string;
  thuEnd?: string;
  friStart?: string;
  friEnd?: string;
  satStart?: string;
  satEnd?: string;
  sunStart?: string;
  sunEnd?: string;
  mins?: string;
  every?: string;
  hour?: string;
  sessionSummaries?: PreCommitmentSessionSummary[];
}

export interface PreCommitmentCSVRow {
  // Section 1: Member Information (Blue Background)
  'Acct': string;
  'KnownAs': string;
  'LastName': string;
  'Add1': string;
  'Add2': string;
  'SuburbName': string;
  'StateName': string;
  'Pcode': string;
  'Enrolled': string;
  'Un Enrolled': string;
  'Status': string;
  'Is Play': string;
  'Breaches': string;
  'Start Day': string;
  'Consecutive Days': string;
  
  // Section 2: Budget and Time Information (Dark Gray Background)
  'Daily Budget': string;
  'Daily Time': string;
  'Weekly Budget': string;
  'Weekly Time': string;
  'Monthly Budget': string;
  'Monthly Time': string;
  
  // Section 3: Daily Schedule and Activity (Light Gray Background)
  'MON Start': string;
  'MON End': string;
  'TUE Start': string;
  'TUE End': string;
  'WED Start': string;
  'WED End': string;
  'THU Start': string;
  'THU End': string;
  'FRI Start': string;
  'FRI End': string;
  'SAT Start': string;
  'SAT End': string;
  'SUN Start': string;
  'SUN End': string;
  'Mins': string;
  'Every Hour': string;
  'Total Amount Spent': string;
  'Net Win/Loss': string;
  // Legacy support
  'Every'?: string;
  'Hour'?: string;
  [key: string]: string | undefined;
}

export interface PreCommitmentPDFRequest {
  players: PreCommitmentPlayer[];
}

export interface AnnotatedStatementPlayer {
  account: string;
  activity?: ActivityStatementRow;
  preCommitment?: PreCommitmentPlayer;
  cashless?: PlayerData;
  quarterlyData?: QuarterlyData;
}
