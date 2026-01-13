import { NextRequest, NextResponse } from 'next/server';
import { saveStatementPeriod, getStatementPeriod } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { quarter, year, startDate, endDate } = body;

    if (!quarter || !year || !startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: quarter, year, startDate, endDate' },
        { status: 400 }
      );
    }

    // Convert date strings to Date objects
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format' },
        { status: 400 }
      );
    }

    await saveStatementPeriod(quarter, year, startDateObj, endDateObj);

    return NextResponse.json({
      success: true,
      message: 'Statement period saved successfully',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error saving statement period:', errorMessage);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to save statement period',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const quarter = searchParams.get('quarter');
    const year = searchParams.get('year');

    if (!quarter || !year) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: quarter, year' },
        { status: 400 }
      );
    }

    const quarterNum = parseInt(quarter, 10);
    const yearNum = parseInt(year, 10);

    if (isNaN(quarterNum) || isNaN(yearNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid quarter or year format' },
        { status: 400 }
      );
    }

    const statementPeriod = await getStatementPeriod(quarterNum, yearNum);

    if (!statementPeriod) {
      return NextResponse.json({
        success: true,
        statementPeriod: null,
      });
    }

    return NextResponse.json({
      success: true,
      statementPeriod: {
        startDate: statementPeriod.startDate.toISOString().split('T')[0],
        endDate: statementPeriod.endDate.toISOString().split('T')[0],
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error loading statement period:', errorMessage);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to load statement period',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}















