import { NextRequest, NextResponse } from 'next/server';
import { checkEmailSentToday } from '@/lib/db/email';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accounts, emailType } = body;

    if (!accounts || !Array.isArray(accounts)) {
      return NextResponse.json(
        { success: false, error: 'Accounts array is required' },
        { status: 400 }
      );
    }

    if (!emailType || !['quarterly', 'play', 'no-play', 'pre-commitment', 'other'].includes(emailType)) {
      return NextResponse.json(
        { success: false, error: 'Valid emailType is required' },
        { status: 400 }
      );
    }

    // Check all accounts concurrently
    const checkPromises = accounts.map(async (account: string) => {
      const alreadySent = await checkEmailSentToday(account, emailType);
      return { account, alreadySent };
    });

    const results = await Promise.all(checkPromises);

    // Create a map of accounts that already have emails sent today
    const alreadySentMap = new Map<string, boolean>();
    results.forEach(({ account, alreadySent }) => {
      alreadySentMap.set(account, alreadySent);
    });

    return NextResponse.json({
      success: true,
      alreadySentMap: Object.fromEntries(alreadySentMap),
    });
  } catch (error) {
    console.error('Error checking emails sent today:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check emails sent today' },
      { status: 500 }
    );
  }
}







