import { NextRequest, NextResponse } from 'next/server';
import { saveGenerationBatch, saveMembersFromActivity } from '@/lib/db';
import { buildAnnotatedPlayers } from '@/lib/annotated-pdf-template';
import { AnnotatedPDFGenerationRequest } from '@/types/player-data';

// Increase body size limit for this route (default is 1MB, but we need more for large batches)
export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Use Node.js runtime for larger body support

export async function POST(request: NextRequest) {
  try {
    // Read body as text first to handle large payloads
    const text = await request.text();
    if (!text) {
      return NextResponse.json(
        { success: false, error: 'Empty request body' },
        { status: 400 }
      );
    }
    
    const body: AnnotatedPDFGenerationRequest = JSON.parse(text);
    const { activityRows, preCommitmentPlayers, quarterlyData } = body;

    if (!activityRows || activityRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No activity statement data provided' },
        { status: 400 }
      );
    }

    if (!preCommitmentPlayers || preCommitmentPlayers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No pre-commitment data provided' },
        { status: 400 }
      );
    }

    if (!quarterlyData || quarterlyData.players.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No cashless monthly data provided' },
        { status: 400 }
      );
    }

    // Save members from activity statement (unique members only)
    try {
      await saveMembersFromActivity(activityRows);
    } catch (memberError) {
      // Continue even if member saving fails
    }

    // Build annotated players
    const annotatedPlayers = buildAnnotatedPlayers(
      activityRows,
      preCommitmentPlayers,
      quarterlyData
    );

    if (annotatedPlayers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No matching accounts found across uploads' },
        { status: 400 }
      );
    }

    // Extract start_date and end_date from quarterlyData.statementPeriod if available
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    
    if (quarterlyData.statementPeriod?.startDate && quarterlyData.statementPeriod?.endDate) {
      // Parse DD/MM/YYYY format
      const [startDay, startMonth, startYear] = quarterlyData.statementPeriod.startDate.split('/');
      const [endDay, endMonth, endYear] = quarterlyData.statementPeriod.endDate.split('/');
      
      if (startDay && startMonth && startYear) {
        startDate = new Date(parseInt(startYear), parseInt(startMonth) - 1, parseInt(startDay));
      }
      if (endDay && endMonth && endYear) {
        endDate = new Date(parseInt(endYear), parseInt(endMonth) - 1, parseInt(endDay));
      }
    }

    // Save to database
    const batchId = await saveGenerationBatch(
      quarterlyData.quarter,
      quarterlyData.year,
      annotatedPlayers,
      quarterlyData,
      startDate,
      endDate
    );

    return NextResponse.json({
      success: true,
      batchId,
      totalAccounts: annotatedPlayers.length,
      quarter: quarterlyData.quarter,
      year: quarterlyData.year,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Error saving batch:', errorMessage, errorStack);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to save batch to database',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}


