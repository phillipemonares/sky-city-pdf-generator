import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, createSessionToken, createSession, setSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password are required' },
        { status: 400 }
      );
    }

    // Authenticate user
    const isValid = await authenticateUser(username, password);
    
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid username or password' },
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

    console.log('Login successful, session created:', { token: sessionToken.substring(0, 10) + '...', username });

    return response;
  } catch (error) {
    console.error('Error during login:', error);
    return NextResponse.json(
      { success: false, error: 'An error occurred during login' },
      { status: 500 }
    );
  }
}

