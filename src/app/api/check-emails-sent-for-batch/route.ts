import { NextRequest, NextResponse } from 'next/server';
import { checkEmailSentForBatch } from '@/lib/db/email';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accounts, batchIds, emailType } = body;

    if (!accounts || !Array.isArray(accounts)) {
      return NextResponse.json(
        { success: false, error: 'Accounts array is required' },
        { status: 400 }
      );
    }

    if (!batchIds || !Array.isArray(batchIds)) {
      return NextResponse.json(
        { success: false, error: 'BatchIds array is required' },
        { status: 400 }
      );
    }

    if (accounts.length !== batchIds.length) {
      return NextResponse.json(
        { success: false, error: 'Accounts and batchIds arrays must have the same length' },
        { status: 400 }
      );
    }

    if (!emailType || !['quarterly', 'play', 'no-play', 'pre-commitment', 'other'].includes(emailType)) {
      return NextResponse.json(
        { success: false, error: 'Valid emailType is required' },
        { status: 400 }
      );
    }

    // Check all account+batch combinations concurrently
    const checkPromises = accounts.map(async (account: string, index: number) => {
      const batchId = batchIds[index];
      if (!batchId) {
        return { account, batchId, alreadySent: false };
      }
      const alreadySent = await checkEmailSentForBatch(account, batchId, emailType);
      return { account, batchId, alreadySent };
    });

    const results = await Promise.all(checkPromises);

    // Create a map of accounts that already have emails sent for their batch
    const alreadySentMap: Record<string, boolean> = {};
    results.forEach(({ account, alreadySent }) => {
      alreadySentMap[account] = alreadySent;
    });

    return NextResponse.json({
      success: true,
      alreadySentMap,
    });
  } catch (error) {
    console.error('Error checking emails sent for batch:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check emails sent for batch' },
      { status: 500 }
    );
  }
}

