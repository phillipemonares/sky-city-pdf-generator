import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { verifyTotpToken } from '@/lib/auth';
import { updateUserTotpSecret } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    // Check if user is authenticated
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { secret, token } = body;

    if (!secret || !token) {
      return NextResponse.json(
        { success: false, error: 'Secret and token are required' },
        { status: 400 }
      );
    }

    // Verify the TOTP token
    const isValid = verifyTotpToken(secret, token);
    
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification code' },
        { status: 400 }
      );
    }

    // Save the secret to the database and enable 2FA
    await updateUserTotpSecret(currentUser.username, secret);

    return NextResponse.json({
      success: true,
      message: '2FA has been successfully enabled',
    });
  } catch (error) {
    console.error('Error verifying 2FA setup:', error);
    return NextResponse.json(
      { success: false, error: 'An error occurred while verifying 2FA setup' },
      { status: 500 }
    );
  }
}


















