import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { buildAnnotatedPlayers, generateAnnotatedHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { AnnotatedPDFGenerationRequest } from '@/types/player-data';
import { saveGenerationBatch, saveMembersFromActivity } from '@/lib/db';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function POST(request: NextRequest) {
  try {
    const body: AnnotatedPDFGenerationRequest = await request.json();
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
      const savedMembersCount = await saveMembersFromActivity(activityRows);
      console.log(`Saved ${savedMembersCount} new members from activity statement`);
    } catch (memberError) {
      console.error('Error saving members (continuing anyway):', memberError);
      // Continue even if member saving fails
    }

    const annotatedPlayers = buildAnnotatedPlayers(activityRows, preCommitmentPlayers, quarterlyData);

    if (annotatedPlayers.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No matching accounts found across uploads' },
        { status: 400 }
      );
    }

    const requestedAccount = normalizeAccount(body.account);
    const playersToProcess = requestedAccount
      ? annotatedPlayers.filter(player => normalizeAccount(player.account) === requestedAccount)
      : annotatedPlayers;

    if (requestedAccount && playersToProcess.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Requested account was not found in the matched players' },
        { status: 404 }
      );
    }

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      
      // Set timeout for page operations
      page.setDefaultTimeout(10000);
      
      // Convert logo to base64
      const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
      const logoBuffer = readFileSync(logoPath);
      const logoBase64 = logoBuffer.toString('base64');
      const logoDataUrl = `data:image/png;base64,${logoBase64}`;
      
      // Generate PDFs for each player
      const pdfResults: { buffer: Buffer; account: string }[] = [];
      
      for (const annotatedPlayer of playersToProcess) {
        // Ensure cashless is only included if it exists (matches UI highlighting logic)
        // If cashless is not highlighted in UI, annotatedPlayer.cashless will be undefined
        if (!annotatedPlayer.cashless) {
          console.log(`Cashless data not found for account ${annotatedPlayer.account}, excluding from export`);
        }
        
        const html = generateAnnotatedHTML(annotatedPlayer, quarterlyData, logoDataUrl);
        
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        // Wait for fonts to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {
            top: '0.5in',
            right: '0.5in',
            bottom: '0.5in',
            left: '0.5in'
          }
        });
        
        pdfResults.push({ buffer: pdfBuffer as Buffer, account: annotatedPlayer.account });
      }

      await browser.close();

      // Save to database if processing all accounts (not just a single account)
      // Only save if we processed all annotated players, not just one
      if (!requestedAccount && annotatedPlayers.length > 0) {
        try {
          await saveGenerationBatch(
            quarterlyData.quarter || 0,
            quarterlyData.year || new Date().getFullYear(),
            annotatedPlayers,
            quarterlyData
          );
        } catch (dbError) {
          // Log error but don't fail the PDF generation
          console.error('Error saving batch to database:', dbError);
        }
      }

      const [{ buffer: firstPdfBuffer, account: firstAccount }] = pdfResults;
      const sanitizedAccount = firstAccount.replace(/[^a-zA-Z0-9_-]/g, '');
      const pdfArrayBuffer = firstPdfBuffer.buffer.slice(
        firstPdfBuffer.byteOffset,
        firstPdfBuffer.byteOffset + firstPdfBuffer.byteLength
      ) as ArrayBuffer;

      return new NextResponse(pdfArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="Annotated_Statement_${sanitizedAccount || 'Member'}.pdf"`,
          'Content-Length': firstPdfBuffer.length.toString(),
        },
      });

    } catch (error) {
      await browser.close();
      throw error;
    }

  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
