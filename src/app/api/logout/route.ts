import { NextRequest, NextResponse } from 'next/server';
import { getSessionToken, deleteSession, clearSessionCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const sessionToken = await getSessionToken();
    
    if (sessionToken) {
      await deleteSession(sessionToken);
    }
    
    await clearSessionCookie();

    return NextResponse.json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Error during logout:', error);
    return NextResponse.json(
      { success: false, error: 'An error occurred during logout' },
      { status: 500 }
    );
  }
}

