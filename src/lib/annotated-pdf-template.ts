import {
  ActivityStatementRow,
  AnnotatedStatementPlayer,
  PreCommitmentPlayer,
  PlayerData,
  QuarterlyData,
} from '@/types/player-data';
import { AS_STYLES, renderActivityPages } from './as-pdf-template';
import { CS_STYLES, generateCashlessStatements } from './cs-pdf-template';
import { PC_PLAY_STYLES, renderPreCommitmentPage } from './pc-play-pdf-template';
import { COMMON_STYLES, normalizeAccount } from './pdf-shared';

const BASE_STYLES = `
  <style>
    ${COMMON_STYLES}
    ${AS_STYLES}
    ${PC_PLAY_STYLES}
    ${CS_STYLES}
  </style>
`;

const cleanText = (value: unknown): string => (value ?? '').toString().trim();

interface NameDetails {
  salutation: string;
  display: string;
}

const resolveNameDetails = (player: AnnotatedStatementPlayer): NameDetails => {
  const normalizeParts = (...parts: unknown[]): string =>
    parts
      .map(cleanText)
      .filter(Boolean)
      .join(' ');

  const pickSalutation = (...candidates: string[]): string => {
    for (const candidate of candidates) {
      const clean = cleanText(candidate);
      if (clean) {
        return clean;
      }
    }
    return '';
  };

  const activity = player.activity;
  const activityFirst = activity ? cleanText(activity.firstName) : '';
  const activityDisplay = activity
    ? normalizeParts(activity.title, activity.firstName, activity.lastName)
    : '';

  const preInfo = player.preCommitment?.playerInfo;
  const preFirst = preInfo ? cleanText(preInfo.firstName) : '';
  const preDisplay = preInfo ? normalizeParts(preInfo.firstName, preInfo.lastName) : '';

  const cashInfo = player.cashless?.playerInfo;
  const cashFirst = cashInfo ? cleanText(cashInfo.firstName) : '';
  const cashDisplay = cashInfo ? normalizeParts(cashInfo.firstName, cashInfo.lastName) : '';

  const salutation =
    pickSalutation(activityFirst, preFirst, cashFirst, activityDisplay, preDisplay, cashDisplay) || 'Member';

  const display = activityDisplay || preDisplay || cashDisplay || salutation || 'Member';

  return {
    salutation,
    display,
  };
};

export function buildAnnotatedPlayers(
  activityRows: ActivityStatementRow[],
  preCommitmentPlayers: PreCommitmentPlayer[],
  quarterlyData: QuarterlyData
): AnnotatedStatementPlayer[] {
  const preMap = new Map<string, PreCommitmentPlayer>();
  preCommitmentPlayers.forEach(player => {
    const key = normalizeAccount(player.playerInfo.playerAccount);
    if (!key) return;
    preMap.set(key, player);
  });

  const cashlessMap = new Map<string, PlayerData>();
  quarterlyData.players.forEach(player => {
    const key = normalizeAccount(player.playerInfo.playerAccount);
    if (!key) return;
    cashlessMap.set(key, player);
  });

  return activityRows
    .map(activity => {
      const account = normalizeAccount(activity.acct);
      if (!account) {
        return null;
      }
      return {
        account,
        activity,
        preCommitment: preMap.get(account),
        cashless: cashlessMap.get(account),
      } as AnnotatedStatementPlayer;
    })
    .filter((player): player is AnnotatedStatementPlayer => Boolean(player));
}

export function generateAnnotatedHTML(
  player: AnnotatedStatementPlayer,
  quarterlyData: QuarterlyData,
  logoDataUrl?: string,
  playHeaderDataUrl?: string
): string {
  const nameDetails = resolveNameDetails(player);
  const salutationName = nameDetails.salutation;
  const displayName = nameDetails.display;

  const activitySection = player.activity
    ? renderActivityPages(player.activity, quarterlyData, logoDataUrl, salutationName)
    : '';

  const preCommitmentSection = player.preCommitment
    ? renderPreCommitmentPage(player.preCommitment, quarterlyData, salutationName, playHeaderDataUrl)
    : '';

  // Only include cashless section if player.cashless exists and is truthy
  // This ensures cashless is only included when it's highlighted in the UI
  const cashlessSection = player.cashless && player.cashless.playerInfo
    ? generateCashlessStatements(quarterlyData, player.cashless, logoDataUrl, salutationName, displayName)
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SkyCity Adelaide - Annotated Statement</title>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  ${BASE_STYLES}
</head>
<body>
  ${activitySection}
  ${preCommitmentSection}
  ${cashlessSection}
</body>
</html>
  `;
}
