import { NextRequest, NextResponse } from 'next/server';
import { getEmailTrackingRecords } from '@/lib/db/email';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Parse filters from query parameters
    const filters: any = {};
    
    const recipient_email = searchParams.get('recipient_email');
    if (recipient_email) filters.recipient_email = recipient_email;
    
    const recipient_account = searchParams.get('recipient_account');
    if (recipient_account) filters.recipient_account = recipient_account;
    
    const email_type = searchParams.get('email_type');
    if (email_type) filters.email_type = email_type;
    
    const status = searchParams.get('status');
    if (status) filters.status = status;
    
    const batch_id = searchParams.get('batch_id');
    if (batch_id) filters.batch_id = batch_id;
    
    const start_date = searchParams.get('start_date');
    if (start_date) {
      filters.start_date = new Date(start_date);
    }
    
    const end_date = searchParams.get('end_date');
    if (end_date) {
      filters.end_date = new Date(end_date);
    }
    
    const search = searchParams.get('search');
    if (search) filters.search = search;
    
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    filters.limit = limit;
    filters.offset = offset;
    
    const { records, total } = await getEmailTrackingRecords(filters);
    
    return NextResponse.json({
      success: true,
      records,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching email tracking records:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch email tracking records' },
      { status: 500 }
    );
  }
}
