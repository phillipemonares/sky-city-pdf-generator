import { NextRequest, NextResponse } from 'next/server';
import { getMemberByAccount } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accountNumbers } = body;

    if (!accountNumbers || !Array.isArray(accountNumbers)) {
      return NextResponse.json(
        { success: false, error: 'Account numbers array is required' },
        { status: 400 }
      );
    }

    const members = await Promise.all(
      accountNumbers.map(async (accountNumber: string) => {
        try {
          const member = await getMemberByAccount(accountNumber);
          return {
            accountNumber,
            member: member || null
          };
        } catch (error) {
          console.error(`Error fetching member for account ${accountNumber}:`, error);
          return {
            accountNumber,
            member: null
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      members
    });
  } catch (error) {
    console.error('Error fetching members:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch members from database' },
      { status: 500 }
    );
  }
}





