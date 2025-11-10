import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = body;
    
    if (!token) {
      return NextResponse.json(
        { valid: false },
        { status: 200 }
      );
    }

    const session = await getSession(token);
    
    if (!session) {
      return NextResponse.json(
        { valid: false },
        { status: 200 }
      );
    }

    return NextResponse.json({
      valid: true,
      username: session.username,
    });
  } catch (error) {
    console.error('Error validating session:', error);
    return NextResponse.json(
      { valid: false },
      { status: 200 }
    );
  }
}

