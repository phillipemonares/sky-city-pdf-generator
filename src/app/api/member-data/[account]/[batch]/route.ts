import { NextRequest, NextResponse } from 'next/server';
import { getAccountFromBatch, updateAccountData } from '@/lib/db';
import { normalizeAccount } from '@/lib/pdf-shared';
import { ActivityStatementRow, PreCommitmentPlayer, PlayerData, QuarterlyData } from '@/types/player-data';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ account: string; batch: string }> }
) {
  try {
    const { account, batch } = await params;
    
    if (!account || !batch) {
      return NextResponse.json(
        { success: false, error: 'Account and batch are required' },
        { status: 400 }
      );
    }

    const normalizedAccount = normalizeAccount(account);
    const matchedAccount = await getAccountFromBatch(batch, normalizedAccount);

    if (!matchedAccount) {
      return NextResponse.json(
        { success: false, error: 'Account not found in batch' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        activity: matchedAccount.account_data.activity || null,
        preCommitment: matchedAccount.account_data.preCommitment || null,
        cashless: matchedAccount.account_data.cashless || null,
        quarterlyData: matchedAccount.account_data.quarterlyData || null,
      },
    });
  } catch (error) {
    console.error('Error fetching member data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch member data' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ account: string; batch: string }> }
) {
  try {
    const { account, batch } = await params;
    
    if (!account || !batch) {
      return NextResponse.json(
        { success: false, error: 'Account and batch are required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { activity, preCommitment, cashless, quarterlyData } = body;

    const normalizedAccount = normalizeAccount(account);

    // Verify account exists in batch
    const existingAccount = await getAccountFromBatch(batch, normalizedAccount);
    if (!existingAccount) {
      return NextResponse.json(
        { success: false, error: 'Account not found in batch' },
        { status: 404 }
      );
    }

    // Prepare updates object (only include fields that are provided)
    const updates: {
      activity_statement?: ActivityStatementRow | null;
      pre_commitment?: PreCommitmentPlayer | null;
      cashless_statement?: PlayerData | null;
      quarterlyData?: QuarterlyData | null;
    } = {};

    if (activity !== undefined) {
      updates.activity_statement = activity;
    }
    if (preCommitment !== undefined) {
      updates.pre_commitment = preCommitment;
    }
    if (cashless !== undefined) {
      updates.cashless_statement = cashless;
    }
    if (quarterlyData !== undefined) {
      updates.quarterlyData = quarterlyData;
    }

    // Update the account data
    await updateAccountData(batch, normalizedAccount, updates);

    return NextResponse.json({
      success: true,
      message: 'Member data updated successfully',
    });
  } catch (error) {
    console.error('Error updating member data:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update member data' },
      { status: 500 }
    );
  }
}






















