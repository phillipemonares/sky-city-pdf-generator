import { getNextJob, completeJob, failJob, Job } from './job-queue';
import { updatePdfExportStatus, pool, getAccountFromBatch, getBatchById, getNoPlayBatchById, getNoPlayPlayersByBatch, getMemberByAccount } from './db';
import { decryptJson } from './encryption';
import mysql from 'mysql2/promise';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import JSZip from 'jszip';
import puppeteer, { Browser } from 'puppeteer';
import { generatePreviewHTML } from './annotated-pdf-template';
import { generatePlayPreCommitmentPDFHTML } from './pc-play-pdf-template';
import { generatePreCommitmentPDFHTML } from './pc-no-play-pdf-template';
import { normalizeAccount } from './pdf-shared';
import { readFileSync } from 'fs';

// Directory for storing export files
const EXPORTS_DIR = join(process.cwd(), 'exports');

// Ensure exports directory exists
async function ensureExportsDir() {
  if (!existsSync(EXPORTS_DIR)) {
    await mkdir(EXPORTS_DIR, { recursive: true });
  }
}

/**
 * Helper function to retry database operations with connection error handling
 */
async function retryDbOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if it's a connection error
      const isConnectionError = 
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.message?.includes('Connection closed') ||
        error.message?.includes('Connection lost');
      
      if (isConnectionError && attempt < maxRetries) {
        const backoffDelay = delay * Math.pow(2, attempt); // Exponential backoff
        console.warn(`Database connection error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoffDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        continue;
      }
      
      // If not a connection error or no retries left, throw
      throw lastError;
    }
  }
  
  throw lastError || new Error('Database operation failed after retries');
}

/**
 * Generate quarterly PDF
 */
async function generateQuarterlyPdf(
  accountNumber: string,
  batchId: string,
  browser: Browser
): Promise<Buffer> {
  const batch = await retryDbOperation(() => getBatchById(batchId));
  if (!batch) {
    throw new Error('Batch not found');
  }

  const normalizedAccount = normalizeAccount(accountNumber);
  let targetAccount = await retryDbOperation(() => getAccountFromBatch(batchId, normalizedAccount));

  if (!targetAccount) {
    throw new Error('Account not found in batch');
  }

  // Get quarterlyData - same approach as member-pdf route
  let quarterlyData: any = null;
  
  // Helper function to normalize quarterlyData structure
  const normalizeQuarterlyData = (data: any): any => {
    if (!data) return null;
    return {
      quarter: data.quarter || batch.quarter,
      year: data.year || batch.year,
      players: Array.isArray(data.players) ? data.players : [],
      monthlyBreakdown: Array.isArray(data.monthlyBreakdown) ? data.monthlyBreakdown : [],
      statementPeriod: data.statementPeriod || null,
    };
  };
  
  // First, try to get from batch metadata
  try {
    const [batchRows] = await retryDbOperation(() => 
      pool.execute<mysql.RowDataPacket[]>(
        `SELECT quarterly_data FROM generation_batches WHERE id = ?`,
        [batchId]
      )
    );
    
    if (batchRows.length > 0 && batchRows[0].quarterly_data) {
      const metadata = JSON.parse(batchRows[0].quarterly_data);
      quarterlyData = normalizeQuarterlyData(metadata.quarterlyData);
    }
  } catch (error: any) {
    // Column might not exist (for existing batches created before this feature)
    if (error.code !== 'ER_BAD_FIELD_ERROR') {
      console.log('Could not fetch quarterly_data from batch metadata:', error);
    }
  }
  
  // If not found, try to get from stored records (old format)
  if (!quarterlyData) {
    try {
      const [sampleRow] = await retryDbOperation(() =>
        pool.execute<mysql.RowDataPacket[]>(
          `SELECT data FROM quarterly_user_statements WHERE batch_id = ? LIMIT 1`,
          [batchId]
        )
      );
      if (sampleRow.length > 0) {
        const sampleData = JSON.parse(sampleRow[0].data) as { quarterlyData?: any };
        if (sampleData.quarterlyData) {
          quarterlyData = normalizeQuarterlyData(sampleData.quarterlyData);
        }
      }
    } catch (error) {
      // Ignore
    }
  }
  
  // If still not found, reconstruct from all cashless statements
  if (!quarterlyData) {
    try {
      const [allRows] = await retryDbOperation(() =>
        pool.execute<mysql.RowDataPacket[]>(
          `SELECT data FROM quarterly_user_statements WHERE batch_id = ?`,
          [batchId]
        )
      );
      
      const cashlessPlayersMap = new Map<string, any>();
      
      for (const row of allRows) {
        try {
          // Decrypt the user data (handles both encrypted and legacy unencrypted data)
          const userData = decryptJson<{ cashless_statement?: any }>(row.data);
          
          if (userData.cashless_statement) {
            const account = userData.cashless_statement.playerInfo?.playerAccount;
            if (account && !cashlessPlayersMap.has(account)) {
              cashlessPlayersMap.set(account, userData.cashless_statement);
            }
          }
        } catch (error) {
          // Ignore parsing errors
        }
      }
      
      // Reconstruct quarterlyData from collected cashless players
      if (cashlessPlayersMap.size > 0) {
        const allCashlessPlayers = Array.from(cashlessPlayersMap.values());
        quarterlyData = {
          quarter: batch.quarter,
          year: batch.year,
          players: allCashlessPlayers,
          monthlyBreakdown: [],
        };
      }
    } catch (error) {
      console.error('Error reconstructing quarterlyData:', error);
    }
  }

  // If still no quarterlyData, try from account_data (fallback)
  if (!quarterlyData && targetAccount.account_data.quarterlyData) {
    quarterlyData = normalizeQuarterlyData(targetAccount.account_data.quarterlyData);
  }

  // Ensure quarterlyData has required structure
  if (quarterlyData) {
    quarterlyData = normalizeQuarterlyData(quarterlyData);
    targetAccount.account_data.quarterlyData = quarterlyData;
  } else {
    quarterlyData = {
      quarter: batch.quarter,
      year: batch.year,
      players: [],
      monthlyBreakdown: [],
    };
    targetAccount.account_data.quarterlyData = quarterlyData;
  }

  // Format dates from batch to DD/MM/YYYY format
  const formatDateToDDMMYYYY = (date: Date | null): string | null => {
    if (!date) return null;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // If batch has start_date and end_date, use them
  if (batch.start_date && batch.end_date && quarterlyData) {
    const startDateFormatted = formatDateToDDMMYYYY(batch.start_date);
    const endDateFormatted = formatDateToDDMMYYYY(batch.end_date);
    
    if (startDateFormatted && endDateFormatted) {
      quarterlyData = {
        ...quarterlyData,
        statementPeriod: {
          startDate: startDateFormatted,
          endDate: endDateFormatted,
        },
      };
    }
  }

  // Load header images
  const logoPath = join(process.cwd(), 'public', 'skycity-logo.png');
  let logoBase64 = '';
  try {
    const logoBuffer = readFileSync(logoPath);
    logoBase64 = logoBuffer.toString('base64');
  } catch (error) {
    console.warn('Logo image not found, continuing without it');
  }
  const logoDataUrl = `data:image/png;base64,${logoBase64}`;

  const playHeaderPath = join(process.cwd(), 'public', 'no-play-header.png');
  let playHeaderBase64 = '';
  try {
    const playHeaderBuffer = readFileSync(playHeaderPath);
    playHeaderBase64 = playHeaderBuffer.toString('base64');
  } catch (error) {
    console.warn('Play header image not found, continuing without it');
  }
  const playHeaderDataUrl = `data:image/png;base64,${playHeaderBase64}`;

  // Generate HTML
  const html = generatePreviewHTML(targetAccount.account_data, quarterlyData, logoDataUrl, playHeaderDataUrl);

  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  await page.setContent(html, { waitUntil: 'load', timeout: 90000 });
  await new Promise(resolve => setTimeout(resolve, 1000));

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

  await page.close();
  return Buffer.from(pdfBuffer);
}

/**
 * Generate play PDF
 */
async function generatePlayPdf(
  accountNumber: string,
  batchId: string,
  browser: Browser
): Promise<Buffer> {
  const batch = await retryDbOperation(() => getNoPlayBatchById(batchId));
  if (!batch) {
    throw new Error('Batch not found');
  }

  const players = await retryDbOperation(() => getNoPlayPlayersByBatch(batchId));
  const normalizedAccount = normalizeAccount(accountNumber);
  const targetPlayer = players.find(
    p => normalizeAccount(p.account_number) === normalizedAccount && p.no_play_status === 'Play'
  );

  if (!targetPlayer) {
    throw new Error('Player not found or not a Play member');
  }

  const member = await retryDbOperation(() => getMemberByAccount(normalizedAccount));

  const headerPath = join(process.cwd(), 'public', 'no-play-header.png');
  let headerBase64 = '';
  try {
    const headerBuffer = readFileSync(headerPath);
    headerBase64 = headerBuffer.toString('base64');
  } catch (error) {
    console.warn('Header image not found, continuing without it');
  }

  const headerDataUrl = `data:image/png;base64,${headerBase64}`;
  const html = generatePlayPreCommitmentPDFHTML(targetPlayer.player_data, headerDataUrl, member || null);

  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  await page.setContent(html, { waitUntil: 'load', timeout: 90000 });
  await new Promise(resolve => setTimeout(resolve, 2000));

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: {
      top: '0.5in',
      right: '0.5in',
      bottom: '0.5in',
      left: '0.5in'
    },
  });

  await page.close();
  return Buffer.from(pdfBuffer);
}

/**
 * Generate no-play PDF
 */
async function generateNoPlayPdf(
  accountNumber: string,
  batchId: string,
  browser: Browser
): Promise<Buffer> {
  const batch = await retryDbOperation(() => getNoPlayBatchById(batchId));
  if (!batch) {
    throw new Error('Batch not found');
  }

  const players = await retryDbOperation(() => getNoPlayPlayersByBatch(batchId));
  const normalizedAccount = normalizeAccount(accountNumber);
  const targetPlayer = players.find(
    p => normalizeAccount(p.account_number) === normalizedAccount && p.no_play_status !== 'Play'
  );

  if (!targetPlayer) {
    throw new Error('Player not found or is a Play member');
  }

  const member = await retryDbOperation(() => getMemberByAccount(normalizedAccount));

  const headerPath = join(process.cwd(), 'public', 'no-play-header.png');
  let headerBase64 = '';
  try {
    const headerBuffer = readFileSync(headerPath);
    headerBase64 = headerBuffer.toString('base64');
  } catch (error) {
    console.warn('Header image not found, continuing without it');
  }

  const headerDataUrl = `data:image/png;base64,${headerBase64}`;
  const html = generatePreCommitmentPDFHTML(targetPlayer.player_data, headerDataUrl, member || null);

  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  await page.setContent(html, { waitUntil: 'load', timeout: 90000 });
  await new Promise(resolve => setTimeout(resolve, 2000));

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: {
      top: '0.5in',
      right: '0.5in',
      bottom: '0.5in',
      left: '0.5in'
    },
  });

  await page.close();
  return Buffer.from(pdfBuffer);
}

/**
 * Generate PDF for a single member
 */
async function generatePdfForMember(
  accountNumber: string,
  batchId: string,
  tab: 'quarterly' | 'play' | 'no-play',
  browser: Browser
): Promise<Buffer> {
  if (tab === 'quarterly') {
    return generateQuarterlyPdf(accountNumber, batchId, browser);
  } else if (tab === 'play') {
    return generatePlayPdf(accountNumber, batchId, browser);
  } else {
    return generateNoPlayPdf(accountNumber, batchId, browser);
  }
}

/**
 * Process PDF export job
 */
export async function processPdfExportJob(job: Job<{
  exportId: string;
  tab: 'quarterly' | 'play' | 'no-play';
  members: Array<{
    account: string;
    batchId: string;
    name: string;
  }>;
}>): Promise<void> {
  const { exportId, tab, members } = job.payload;
  
  console.log(`Processing PDF export job ${exportId} with ${members.length} members`);
  
  // Update status to processing
  await updatePdfExportStatus(exportId, { status: 'processing' });

  const BATCH_SIZE = 50;
  const CONCURRENT_PDFS = 10;
  const zip = new JSZip();
  let processedCount = 0;
  let failedCount = 0;

  // Launch browser once for all PDFs
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    timeout: 60000,
  });

  try {
    // Update initial progress
    await updatePdfExportStatus(exportId, {
      processed_members: 0,
      failed_members: 0,
    });

    for (let i = 0; i < members.length; i += BATCH_SIZE) {
      const batch = members.slice(i, i + BATCH_SIZE);
      
      // Process batch with concurrency limiting and retry logic
      const batchResults: Array<{ success: boolean; account: string; error?: string }> = [];
      
      // Process members in chunks to limit concurrent operations
      for (let j = 0; j < batch.length; j += CONCURRENT_PDFS) {
        const concurrentBatch = batch.slice(j, j + CONCURRENT_PDFS);
        
        const concurrentResults = await Promise.allSettled(
          concurrentBatch.map(async (member) => {
            const maxRetries = 2;
            let lastError: Error | null = null;
            
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              try {
                const pdfBuffer = await generatePdfForMember(member.account, member.batchId, tab, browser);
                const sanitizedAccount = member.account.replace(/[^a-zA-Z0-9_-]/g, '') || 'member';
                const sanitizedName = member.name.replace(/[^a-zA-Z0-9_-]/g, '_') || sanitizedAccount;
                const filename = `${sanitizedAccount}_${sanitizedName}.pdf`;
                
                zip.file(filename, pdfBuffer);
                return { success: true, account: member.account };
              } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                // If it's a timeout or connection error and we have retries left, wait a bit and retry
                if (attempt < maxRetries && (
                  lastError.message.includes('timeout') || 
                  lastError.message.includes('Timeout') ||
                  lastError.message.includes('Connection closed') ||
                  lastError.message.includes('Connection lost')
                )) {
                  console.warn(`Retry ${attempt + 1}/${maxRetries} for ${member.account} after error`);
                  await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
                  continue;
                }
                
                console.error(`Failed to generate PDF for ${member.account}${attempt > 0 ? ` (after ${attempt} retries)` : ''}:`, lastError);
                return { 
                  success: false, 
                  account: member.account,
                  error: lastError.message 
                };
              }
            }
            
            return { 
              success: false, 
              account: member.account,
              error: lastError?.message || 'Unknown error' 
            };
          })
        );
        
        // Collect results from this concurrent batch
        for (const result of concurrentResults) {
          if (result.status === 'fulfilled') {
            batchResults.push(result.value);
          } else {
            batchResults.push({
              success: false,
              account: 'unknown',
              error: result.reason instanceof Error ? result.reason.message : String(result.reason)
            });
          }
        }
      }

      // Count successes and failures from this batch
      let batchProcessed = 0;
      let batchFailed = 0;
      
      for (const result of batchResults) {
        if (result.success) {
          batchProcessed++;
        } else {
          batchFailed++;
        }
      }

      processedCount += batchProcessed;
      failedCount += batchFailed;

      // Update progress after each batch completes
      await updatePdfExportStatus(exportId, {
        processed_members: processedCount,
        failed_members: failedCount,
      });
    }

    await browser.close();

    // Generate zip file
    await ensureExportsDir();
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // Save zip file
    const filePath = join(EXPORTS_DIR, `${exportId}.zip`);
    await writeFile(filePath, zipBuffer);
    const fileSize = zipBuffer.length;

    // Update export status to completed
    await updatePdfExportStatus(exportId, {
      status: 'completed',
      processed_members: processedCount,
      failed_members: failedCount,
      file_path: filePath,
      file_size: fileSize,
    });

    console.log(`PDF export job ${exportId} completed successfully`);
  } catch (error) {
    await browser.close();
    console.error(`Error processing PDF export job ${exportId}:`, error);
    await updatePdfExportStatus(exportId, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}




