import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { disableUserTotp } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Disable 2FA for the user
    await disableUserTotp(currentUser.username);

    return NextResponse.json({
      success: true,
      message: '2FA has been successfully disabled',
    });
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    return NextResponse.json(
      { success: false, error: 'An error occurred while disabling 2FA' },
      { status: 500 }
    );
  }
}



















