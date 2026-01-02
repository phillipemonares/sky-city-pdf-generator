import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';
import { pool } from '../db';

// Email Tracking Functions
// ============================================

export interface EmailTracking {
  id: string;
  recipient_email: string;
  recipient_account: string | null;
  recipient_name: string | null;
  email_type: 'quarterly' | 'no-play' | 'play' | 'pre-commitment' | 'other';
  batch_id: string | null;
  subject: string;
  sendgrid_message_id: string | null;
  status: 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed';
  sent_at: Date | null;
  opened_at: Date | null;
  open_count: number;
  last_opened_at: Date | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Create an email tracking record
 */
export async function createEmailTrackingRecord(data: {
  recipient_email: string;
  recipient_account?: string | null;
  recipient_name?: string | null;
  email_type: 'quarterly' | 'no-play' | 'play' | 'pre-commitment' | 'other';
  batch_id?: string | null;
  subject: string;
}): Promise<string> {
  const connection = await pool.getConnection();
  
  try {
    const trackingId = randomUUID();
    
    await connection.execute(
      `INSERT INTO email_tracking 
       (id, recipient_email, recipient_account, recipient_name, email_type, batch_id, subject, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        trackingId,
        data.recipient_email,
        data.recipient_account || null,
        data.recipient_name || null,
        data.email_type,
        data.batch_id || null,
        data.subject,
      ]
    );
    
    return trackingId;
  } catch (error) {
    console.error('Error creating email tracking record:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Update email tracking status and SendGrid message ID
 */
export async function updateEmailTrackingStatus(
  trackingId: string,
  updates: {
    status?: 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed';
    sendgrid_message_id?: string | null;
    sent_at?: Date | null;
    error_message?: string | null;
  }
): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    const updateFields: string[] = [];
    const values: any[] = [];
    
    if (updates.status !== undefined) {
      updateFields.push('status = ?');
      values.push(updates.status);
    }
    
    if (updates.sendgrid_message_id !== undefined) {
      updateFields.push('sendgrid_message_id = ?');
      values.push(updates.sendgrid_message_id);
    }
    
    if (updates.sent_at !== undefined) {
      updateFields.push('sent_at = ?');
      values.push(updates.sent_at);
    }
    
    if (updates.error_message !== undefined) {
      updateFields.push('error_message = ?');
      values.push(updates.error_message);
    }
    
    if (updateFields.length === 0) {
      return;
    }
    
    values.push(trackingId);
    
    await connection.execute(
      `UPDATE email_tracking SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
      values
    );
  } catch (error) {
    console.error('Error updating email tracking status:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Record an email open event
 * Includes deduplication to prevent counting rapid duplicate events
 * Only counts opens that are at least 5 minutes apart
 */
export async function recordEmailOpen(trackingId: string, openedAt: Date): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    // Get current record to check if this is the first open
    // Also get sent_at to validate the open timestamp
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT opened_at, open_count, last_opened_at, sent_at FROM email_tracking WHERE id = ?`,
      [trackingId]
    );
    
    if (rows.length === 0) {
      console.warn(`Email tracking record not found: ${trackingId}`);
      return;
    }
    
    const currentRecord = rows[0];
    
    // Validate that opened_at is after sent_at (with a small buffer for timezone differences)
    // Only reject if it's significantly before sent_at (more than 1 hour), which would indicate a real problem
    if (currentRecord.sent_at) {
      const sentAt = new Date(currentRecord.sent_at);
      const timeDiff = openedAt.getTime() - sentAt.getTime();
      const MAX_NEGATIVE_DIFF_MS = 60 * 60 * 1000; // 1 hour buffer for timezone/timing differences
      
      if (timeDiff < -MAX_NEGATIVE_DIFF_MS) {
        // Only reject if it's more than 1 hour before sent_at (truly impossible)
        console.warn(`[Email Tracking] Rejecting open event: opened_at (${openedAt.toISOString()}) is more than 1 hour before sent_at (${sentAt.toISOString()}) for tracking ID: ${trackingId}`);
        return;
      } else if (timeDiff < 0) {
        // If it's within 1 hour before, log but allow it (likely timezone issue)
        console.log(`[Email Tracking] Open event timestamp is before sent_at but within acceptable range (${Math.round(Math.abs(timeDiff) / 1000)}s difference) - allowing for tracking ID: ${trackingId}`);
      }
    } else {
      // Email hasn't been sent yet - reject this open
      console.warn(`[Email Tracking] Rejecting open event: email not yet sent for tracking ID: ${trackingId}`);
      return;
    }
    
    const isFirstOpen = !currentRecord.opened_at;
    
    // Deduplication: Only count opens that are at least 5 minutes apart
    // This prevents rapid duplicate events from being counted multiple times
    const MIN_OPEN_INTERVAL_MINUTES = 5;
    const minOpenIntervalMs = MIN_OPEN_INTERVAL_MINUTES * 60 * 1000;
    
    if (!isFirstOpen && currentRecord.last_opened_at) {
      const lastOpenedAt = new Date(currentRecord.last_opened_at);
      const timeSinceLastOpen = openedAt.getTime() - lastOpenedAt.getTime();
      
      // If this open is too soon after the last one, only update last_opened_at but don't increment count
      if (timeSinceLastOpen < minOpenIntervalMs) {
        console.log(`[Email Tracking] Open event too soon after last open (${Math.round(timeSinceLastOpen / 1000)}s), skipping count increment for tracking ID: ${trackingId}`);
        // Still update last_opened_at to track the most recent open time
        await connection.execute(
          `UPDATE email_tracking 
           SET last_opened_at = ?, updated_at = NOW()
           WHERE id = ?`,
          [openedAt, trackingId]
        );
        return;
      }
    }
    
    // This is either the first open, or enough time has passed since the last open
    const newOpenCount = (currentRecord.open_count || 0) + 1;
    
    if (isFirstOpen) {
      // First open - set opened_at and last_opened_at
      await connection.execute(
        `UPDATE email_tracking 
         SET opened_at = ?, last_opened_at = ?, open_count = ?, updated_at = NOW()
         WHERE id = ?`,
        [openedAt, openedAt, newOpenCount, trackingId]
      );
    } else {
      // Subsequent open - update last_opened_at and increment count
      await connection.execute(
        `UPDATE email_tracking 
         SET last_opened_at = ?, open_count = ?, updated_at = NOW()
         WHERE id = ?`,
        [openedAt, newOpenCount, trackingId]
      );
    }
  } catch (error) {
    console.error('Error recording email open:', error);
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Find email tracking record by email address and SendGrid message ID
 * Used to match webhook events to tracking records when custom_args are missing
 */
export async function findTrackingRecordByEmailAndMessageId(
  email: string,
  sendgridMessageId?: string | null
): Promise<string | null> {
  const connection = await pool.getConnection();
  
  try {
    let query = `SELECT id, sendgrid_message_id FROM email_tracking WHERE recipient_email = ?`;
    const values: any[] = [email];
    
    // If we have a SendGrid message ID, use it for more precise matching
    if (sendgridMessageId) {
      // Try exact match first
      query += ` AND sendgrid_message_id = ?`;
      values.push(sendgridMessageId);
    }
    
    // Order by most recent first, prioritize records with message IDs
    query += ` ORDER BY 
      CASE WHEN sendgrid_message_id IS NOT NULL THEN 0 ELSE 1 END,
      created_at DESC 
      LIMIT 1`;
    
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(query, values);
    
    if (rows.length > 0) {
      const matchedId = rows[0].id;
      const storedMessageId = rows[0].sendgrid_message_id;
      
      // If exact match found, return it
      if (sendgridMessageId && storedMessageId && sendgridMessageId === storedMessageId) {
        return matchedId;
      }
      
      // If we searched with message ID but got a different one, check if it's a partial match
      // SendGrid webhook sends full ID like "howUkB_9RS6qS1FZhl6lYg.recvd-5fb7fdbd94-j4dtp-1-6954A7B8-D.0"
      // But we might store just "howUkB_9RS6qS1FZhl6lYg" (the prefix before the first dot)
      if (sendgridMessageId && storedMessageId) {
        const webhookPrefix = sendgridMessageId.split('.')[0]; // Get part before first dot
        if (webhookPrefix === storedMessageId || sendgridMessageId.startsWith(storedMessageId + '.')) {
          // Partial match - the stored ID is a prefix of the webhook ID
          console.log('[Email Tracking] Partial message ID match:', {
            email,
            webhookMessageId: sendgridMessageId,
            storedMessageId,
            matchedTrackingId: matchedId
          });
          return matchedId;
        }
      }
      
      // If no message ID was provided in search, return the match by email
      if (!sendgridMessageId) {
        return matchedId;
      }
    }
    
    // If exact match failed, try partial match (webhook ID starts with stored ID)
    if (sendgridMessageId && rows.length === 0) {
      const [partialRows] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT id, sendgrid_message_id FROM email_tracking 
         WHERE recipient_email = ? 
         AND sendgrid_message_id IS NOT NULL
         AND ? LIKE CONCAT(sendgrid_message_id, '%')
         ORDER BY created_at DESC 
         LIMIT 1`,
        [email, sendgridMessageId]
      );
      
      if (partialRows.length > 0) {
        console.log('[Email Tracking] Found partial message ID match:', {
          email,
          webhookMessageId: sendgridMessageId,
          storedMessageId: partialRows[0].sendgrid_message_id,
          matchedTrackingId: partialRows[0].id
        });
        return partialRows[0].id;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding tracking record by email:', error);
    return null;
  } finally {
    connection.release();
  }
}

/**
 * Check if an email exists in the tracking table
 */
export async function emailExistsInTracking(email: string): Promise<boolean> {
  const connection = await pool.getConnection();
  
  try {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as count FROM email_tracking WHERE recipient_email = ?`,
      [email]
    );
    
    return (rows[0]?.count || 0) > 0;
  } catch (error) {
    console.error('Error checking if email exists in tracking:', error);
    return false;
  } finally {
    connection.release();
  }
}

/**
 * Check if an email was already sent today for a given account and email type
 */
export async function checkEmailSentToday(
  account: string,
  emailType: 'quarterly' | 'no-play' | 'play' | 'pre-commitment' | 'other'
): Promise<boolean> {
  const connection = await pool.getConnection();
  
  try {
    // Get today's date range (start of day to end of day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as count 
       FROM email_tracking 
       WHERE recipient_account = ? 
         AND email_type = ? 
         AND status = 'sent' 
         AND sent_at >= ? 
         AND sent_at < ?`,
      [account, emailType, today, tomorrow]
    );
    
    return (rows[0]?.count || 0) > 0;
  } catch (error) {
    console.error('Error checking if email sent today:', error);
    return false;
  } finally {
    connection.release();
  }
}

/**
 * Check if an email was already sent for a given account, batch_id, and email type
 * This checks all time, not just today
 */
export async function checkEmailSentForBatch(
  account: string,
  batchId: string,
  emailType: 'quarterly' | 'no-play' | 'play' | 'pre-commitment' | 'other'
): Promise<boolean> {
  const connection = await pool.getConnection();
  
  try {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as count 
       FROM email_tracking 
       WHERE recipient_account = ? 
         AND batch_id = ? 
         AND email_type = ? 
         AND status = 'sent'`,
      [account, batchId, emailType]
    );
    
    return (rows[0]?.count || 0) > 0;
  } catch (error) {
    console.error('Error checking if email sent for batch:', error);
    return false;
  } finally {
    connection.release();
  }
}

/**
 * Get email tracking records with optional filters
 */
export async function getEmailTrackingRecords(filters?: {
  recipient_email?: string;
  recipient_account?: string;
  email_type?: 'quarterly' | 'no-play' | 'play' | 'pre-commitment' | 'other';
  status?: 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed';
  batch_id?: string;
  start_date?: Date;
  end_date?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ records: EmailTracking[]; total: number; stats: { total: number; sent: number; delivered: number; opened: number; bounced: number; failed: number } }> {
  try {
    const conditions: string[] = [];
    const values: any[] = [];
    
    if (filters?.recipient_email) {
      conditions.push('recipient_email = ?');
      values.push(filters.recipient_email);
    }
    
    if (filters?.recipient_account) {
      conditions.push('recipient_account = ?');
      values.push(filters.recipient_account);
    }
    
    if (filters?.email_type) {
      conditions.push('email_type = ?');
      values.push(filters.email_type);
    }
    
    if (filters?.status) {
      conditions.push('status = ?');
      values.push(filters.status);
    }
    
    if (filters?.batch_id) {
      conditions.push('batch_id = ?');
      values.push(filters.batch_id);
    }
    
    if (filters?.start_date) {
      conditions.push('created_at >= ?');
      values.push(filters.start_date);
    }
    
    if (filters?.end_date) {
      conditions.push('created_at <= ?');
      values.push(filters.end_date);
    }
    
    if (filters?.search) {
      conditions.push('(recipient_email LIKE ? OR recipient_account LIKE ? OR recipient_name LIKE ? OR subject LIKE ?)');
      const searchPattern = `%${filters.search}%`;
      values.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Get total count
    const [countRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM email_tracking ${whereClause}`,
      values
    );
    const total = countRows[0]?.total || 0;
    
    // Get aggregate statistics
    const [statsRows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM email_tracking ${whereClause}`,
      values
    );
    
    const stats = {
      total: Number(statsRows[0]?.total || 0),
      sent: Number(statsRows[0]?.sent || 0),
      delivered: Number(statsRows[0]?.delivered || 0),
      opened: Number(statsRows[0]?.opened || 0),
      bounced: Number(statsRows[0]?.bounced || 0),
      failed: Number(statsRows[0]?.failed || 0),
    };
    
    // Get records with pagination
    // Note: LIMIT and OFFSET must be integers - validate and use in SQL string (safe since we validate them)
    const limitValue = Number(filters?.limit || 50);
    const offsetValue = Number(filters?.offset || 0);
    
    // Validate that limit and offset are valid integers (prevent SQL injection)
    if (!Number.isInteger(limitValue) || !Number.isInteger(offsetValue) || limitValue < 0 || offsetValue < 0) {
      throw new Error('Invalid pagination parameters');
    }
    
    const [rows] = await pool.execute<mysql.RowDataPacket[]>(
      `SELECT id, recipient_email, recipient_account, recipient_name, email_type, batch_id, 
              subject, sendgrid_message_id, status, sent_at, opened_at, open_count, 
              last_opened_at, error_message, created_at, updated_at
       FROM email_tracking 
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limitValue} OFFSET ${offsetValue}`,
      values
    );
    
    const records: EmailTracking[] = rows.map(row => ({
      id: row.id,
      recipient_email: row.recipient_email,
      recipient_account: row.recipient_account,
      recipient_name: row.recipient_name,
      email_type: row.email_type,
      batch_id: row.batch_id,
      subject: row.subject,
      sendgrid_message_id: row.sendgrid_message_id,
      status: row.status,
      sent_at: row.sent_at ? new Date(row.sent_at) : null,
      opened_at: row.opened_at ? new Date(row.opened_at) : null,
      open_count: row.open_count || 0,
      last_opened_at: row.last_opened_at ? new Date(row.last_opened_at) : null,
      error_message: row.error_message,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
    
    return { records, total, stats };
  } catch (error) {
    console.error('Error getting email tracking records:', error);
    throw error;
  }
}








