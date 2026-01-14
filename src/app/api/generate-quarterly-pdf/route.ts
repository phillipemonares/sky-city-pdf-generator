import { NextRequest, NextResponse } from 'next/server';
import { getMemberByAccount, getAccountFromBatch } from '@/lib/db';
import { getQuarterlyDataFromBatch } from '@/lib/db/pdf-preview';
import { generatePreviewHTML } from '@/lib/annotated-pdf-template';
import { normalizeAccount } from '@/lib/pdf-shared';
import { encryptDeterministic } from '@/lib/encryption';
import { readFileSync } from 'fs';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import puppeteer from 'puppeteer';
import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dp-skycity',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(dbConfig);

// Increase timeout for PDF generation
export const maxDuration = 300; // 5 minutes

// Directory for storing PDF files
const UPLOADS_DIR = join(process.cwd(), 'uploads');

// Ensure uploads directory exists
async function ensureUploadsDir(quarterDir: string) {
  const fullPath = join(UPLOADS_DIR, quarterDir);
  if (!existsSync(fullPath)) {
    await mkdir(fullPath, { recursive: true });
  }
  return fullPath;
}

/**
 * Determine quarter number from a date
 * Q1: Jan-Mar (months 1-3)
 * Q2: Apr-Jun (months 4-6)
 * Q3: Jul-Sep (months 7-9)
 * Q4: Oct-Dec (months 10-12)
 */
function getQuarterFromDate(date: Date): { quarter: number; year: number } {
  const month = date.getMonth() + 1; // getMonth() returns 0-11
  const year = date.getFullYear();
  
  let quarter: number;
  if (month >= 1 && month <= 3) {
    quarter = 1;
  } else if (month >= 4 && month <= 6) {
    quarter = 2;
  } else if (month >= 7 && month <= 9) {
    quarter = 3;
  } else {
    quarter = 4;
  }
  
  return { quarter, year };
}

/**
 * Format quarter folder name (e.g., "q3-2025")
 */
function formatQuarterFolder(quarter: number, year: number): string {
  return `q${quarter}-${year}`;
}

/**
 * Get the latest batch ID for an account
 */
async function getLatestBatchForAccount(accountNumber: string): Promise<string | null> {
  try {
    const normalizedAccount = normalizeAccount(accountNumber);
    const encryptedAccount = encryptDeterministic(normalizedAccount);
    
    // Get the latest batch for this account
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT qus.batch_id, gb.generation_date
       FROM quarterly_user_statements qus
       INNER JOIN generation_batches gb ON qus.batch_id = gb.id
       WHERE qus.account_number = ?
       ORDER BY gb.generation_date DESC
       LIMIT 1`,
      [encryptedAccount]
    );
    
    if (rows.length === 0) {
      // Try with unencrypted account (legacy data)
      const [unencryptedRows] = await pool.execute<mysql.RowDataPacket[]>(
        `SELECT qus.batch_id, gb.generation_date
         FROM quarterly_user_statements qus
         INNER JOIN generation_batches gb ON qus.batch_id = gb.id
         WHERE qus.account_number = ?
         ORDER BY gb.generation_date DESC
         LIMIT 1`,
        [normalizedAccount]
      );
      
      if (unencryptedRows.length > 0) {
        return unencryptedRows[0].batch_id;
      }
      
      return null;
    }
    
    return rows[0].batch_id;
  } catch (error) {
    console.error('Error getting latest batch for account:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body first
    const body = await request.json();
    const { account, startDate, endDate, token } = body;
    
    // Check authentication token
    const authToken = request.headers.get('authorization')?.replace('Bearer ', '') || 
                     request.headers.get('x-api-token') || 
                     token;
    
    const expectedToken = process.env.QUARTERLY_PDF_API_TOKEN;
    
    if (!expectedToken) {
      return NextResponse.json(
        { success: false, error: 'API token not configured' },
        { status: 500 }
      );
    }
    
    if (!authToken || authToken !== expectedToken) {
      return NextResponse.json(
        { success: false, error: 'Invalid authentication token' },
        { status: 401 }
      );
    }
    
    // Validate required parameters
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Account number is required' },
        { status: 400 }
      );
    }
    
    if (!startDate) {
      return NextResponse.json(
        { success: false, error: 'Start date is required' },
        { status: 400 }
      );
    }
    
    if (!endDate) {
      return NextResponse.json(
        { success: false, error: 'End date is required' },
        { status: 400 }
      );
    }
    
    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Use YYYY-MM-DD or ISO format' },
        { status: 400 }
      );
    }
    
    // Determine quarter from start date
    const { quarter, year } = getQuarterFromDate(start);
    const quarterFolder = formatQuarterFolder(quarter, year);
    
    // Get member data
    const normalizedAccount = normalizeAccount(account);
    const member = await getMemberByAccount(normalizedAccount);
    
    if (!member) {
      return NextResponse.json(
        { success: false, error: 'Member not found' },
        { status: 404 }
      );
    }
    
    // Get the latest batch for this account
    const batchId = await getLatestBatchForAccount(normalizedAccount);
    
    if (!batchId) {
      return NextResponse.json(
        { success: false, error: 'No batch data found for this account' },
        { status: 404 }
      );
    }
    
    // Get account data from batch
    let targetAccount = await getAccountFromBatch(batchId, normalizedAccount);
    
    if (!targetAccount) {
      // Try with original account number
      targetAccount = await getAccountFromBatch(batchId, account);
    }
    
    if (!targetAccount) {
      return NextResponse.json(
        { success: false, error: 'Account data not found in batch' },
        { status: 404 }
      );
    }
    
    // Get quarterly data
    let quarterlyData = await getQuarterlyDataFromBatch(batchId);
    
    // Update quarterly data with statement period from provided dates
    if (quarterlyData) {
      const formatDate = (date: Date): string => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      };
      
      quarterlyData = {
        ...quarterlyData,
        quarter,
        year,
        statementPeriod: {
          startDate: formatDate(start),
          endDate: formatDate(end),
        },
      };
    } else {
      // Create minimal quarterly data if not found
      const formatDate = (date: Date): string => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      };
      
      quarterlyData = {
        quarter,
        year,
        players: [],
        monthlyBreakdown: [],
        statementPeriod: {
          startDate: formatDate(start),
          endDate: formatDate(end),
        },
      };
    }
    
    // Convert logos to base64
    const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
    const logoBuffer = readFileSync(logoPath);
    const logoBase64 = logoBuffer.toString('base64');
    const logoDataUrl = `data:image/png;base64,${logoBase64}`;
    
    const playHeaderPath = join(process.cwd(), 'public', 'no-play-header.png');
    const playHeaderBuffer = readFileSync(playHeaderPath);
    const playHeaderBase64 = playHeaderBuffer.toString('base64');
    const playHeaderDataUrl = `data:image/png;base64,${playHeaderBase64}`;
    
    // Generate HTML
    const html = generatePreviewHTML(targetAccount.account_data, quarterlyData, logoDataUrl, playHeaderDataUrl);
    
    // Generate PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(300000);
      await page.setContent(html, { waitUntil: 'load', timeout: 300000 });
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for fonts
      
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '0mm',
          right: '0mm',
          bottom: '0mm',
          left: '0mm',
        },
      });
      
      await browser.close();
      
      // Ensure uploads directory exists
      const uploadsPath = await ensureUploadsDir(quarterFolder);
      
      // Generate filename
      const sanitizedAccount = account.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
      const filename = `Statement_Q${quarter}_${year}_${sanitizedAccount}.pdf`;
      const filePath = join(uploadsPath, filename);
      
      // Save PDF to file
      await writeFile(filePath, pdfBuffer);
      
      return NextResponse.json({
        success: true,
        message: 'PDF generated and saved successfully',
        filePath: `uploads/${quarterFolder}/${filename}`,
        quarter,
        year,
        account: normalizedAccount,
      });
      
    } catch (error) {
      await browser.close();
      throw error;
    }
    
  } catch (error) {
    console.error('Error generating quarterly PDF:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to generate PDF' 
      },
      { status: 500 }
    );
  }
}

