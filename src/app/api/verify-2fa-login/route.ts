import { NextRequest, NextResponse } from 'next/server';
import { getUserByUsername } from '@/lib/db';
import { verifyTotpToken } from '@/lib/auth';
import { createSessionToken, createSession, setSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, token } = body;

    if (!username || !token) {
      return NextResponse.json(
        { success: false, error: 'Username and token are required' },
        { status: 400 }
      );
    }

    // Get user from database
    const user = await getUserByUsername(username);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Check if 2FA is enabled
    if (!user.totp_enabled || !user.totp_secret) {
      return NextResponse.json(
        { success: false, error: '2FA is not enabled for this user' },
        { status: 400 }
      );
    }

    // Verify the TOTP token
    const isValid = verifyTotpToken(user.totp_secret, token);
    
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid verification code' },
        { status: 401 }
      );
    }

    // Create session
    const sessionToken = createSessionToken();
    await createSession(sessionToken, username);
    
    // Create response
    const response = NextResponse.json({
      success: true,
      message: 'Login successful',
    });
    
    // Set cookie directly in response headers
    response.cookies.set('skycity_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    console.log('2FA login successful, session created:', { token: sessionToken.substring(0, 10) + '...', username });

    return response;
  } catch (error) {
    console.error('Error verifying 2FA login:', error);
    return NextResponse.json(
      { success: false, error: 'An error occurred during 2FA verification' },
      { status: 500 }
    );
  }
}




