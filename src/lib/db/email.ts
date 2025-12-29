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
 */
export async function recordEmailOpen(trackingId: string, openedAt: Date): Promise<void> {
  const connection = await pool.getConnection();
  
  try {
    // Get current record to check if this is the first open
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT opened_at, open_count FROM email_tracking WHERE id = ?`,
      [trackingId]
    );
    
    if (rows.length === 0) {
      console.warn(`Email tracking record not found: ${trackingId}`);
      return;
    }
    
    const currentRecord = rows[0];
    const isFirstOpen = !currentRecord.opened_at;
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
      // Subsequent open - only update last_opened_at and count
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
}): Promise<{ records: EmailTracking[]; total: number }> {
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
    
    return { records, total };
  } catch (error) {
    console.error('Error getting email tracking records:', error);
    throw error;
  }
}





