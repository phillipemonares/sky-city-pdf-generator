import { NextRequest, NextResponse } from 'next/server';
import { deleteUser } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // Check if user is admin
    const adminCheck = await requireAdmin(request);
    if (!adminCheck.authorized) {
      return adminCheck.response || NextResponse.json(
        { success: false, error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    await deleteUser(userId);

    return NextResponse.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}

