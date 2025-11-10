import { NextRequest, NextResponse } from 'next/server';
import { getSessionToken, getSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const sessionToken = await getSessionToken();
    
    if (!sessionToken) {
      return NextResponse.json(
        { authenticated: false },
        { status: 200 }
      );
    }

    const session = await getSession(sessionToken);
    
    if (!session) {
      return NextResponse.json(
        { authenticated: false },
        { status: 200 }
      );
    }

    return NextResponse.json({
      authenticated: true,
      username: session.username,
    });
  } catch (error) {
    console.error('Error checking authentication:', error);
    return NextResponse.json(
      { authenticated: false },
      { status: 200 }
    );
  }
}

