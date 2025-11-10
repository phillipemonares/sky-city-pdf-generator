import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const users = await getAllUsers();
    
    return NextResponse.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

