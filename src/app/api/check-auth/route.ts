import { NextRequest, NextResponse } from 'next/server';
import { getSessionToken, getSession, getCurrentUserWithRole } from '@/lib/auth';

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

    // Get user with role
    const user = await getCurrentUserWithRole();
    
    if (!user) {
      return NextResponse.json(
        { authenticated: false },
        { status: 200 }
      );
    }

    return NextResponse.json({
      authenticated: true,
      username: user.username,
      role: user.role,
    });
  } catch (error) {
    console.error('Error checking authentication:', error);
    return NextResponse.json(
      { authenticated: false },
      { status: 200 }
    );
  }
}

