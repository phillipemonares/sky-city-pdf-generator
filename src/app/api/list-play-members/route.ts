import { NextRequest, NextResponse } from 'next/server';
import { getPlayMembersPaginated } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const search = searchParams.get('search') || '';
    
    // Validate pagination parameters
    const validPage = Math.max(1, page);
    const validPageSize = Math.min(Math.max(1, pageSize), 100); // Max 100 per page
    
    const result = await getPlayMembersPaginated(validPage, validPageSize, search);
    
    return NextResponse.json({
      success: true,
      members: result.members,
      total: result.total,
      totalPages: result.totalPages,
      currentPage: validPage,
      pageSize: validPageSize,
    });
  } catch (error) {
    console.error('Error fetching play members:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch play members from database' },
      { status: 500 }
    );
  }
}









