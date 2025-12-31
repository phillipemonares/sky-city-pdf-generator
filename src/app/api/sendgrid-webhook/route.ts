import { NextRequest, NextResponse } from 'next/server';
import { updateEmailTrackingStatus, recordEmailOpen, findTrackingRecordByEmailAndMessageId, emailExistsInTracking } from '@/lib/db/email';
import { pool } from '@/lib/db';
import { createVerify } from 'crypto';
import mysql from 'mysql2/promise';

/**
 * SendGrid Event Webhook Handler
 * 
 * Receives events from SendGrid and updates email tracking records.
 * 
 * Events handled:
 * - delivered: Email was delivered (update status to 'delivered')
 * - open: Email was opened (increment open_count, set opened_at/last_opened_at)
 * 
 * SendGrid sends events as an array in the request body.
 * 
 * Signature verification is performed to ensure requests are from SendGrid.
 */
export async function POST(request: NextRequest) {
  console.log('[SendGrid Webhook] Received POST request');
  
  try {
    // Get raw body text for signature verification
    const rawBody = await request.text();
    
    // Verify signature if public key is configured
    const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    const skipVerification = process.env.SENDGRID_SKIP_VERIFICATION === 'true';
    
    if (publicKey && !skipVerification) {
      const signature = request.headers.get('x-twilio-email-event-webhook-signature');
      const timestamp = request.headers.get('x-twilio-email-event-webhook-timestamp');
      
      if (!signature || !timestamp) {
        console.error('[SendGrid Webhook] Missing signature or timestamp headers', {
          hasSignature: !!signature,
          hasTimestamp: !!timestamp,
          headers: Object.fromEntries(request.headers.entries())
        });
        return NextResponse.json(
          { success: false, error: 'Missing webhook signature headers' },
          { status: 401 }
        );
      }
      
      // Verify signature: concatenate timestamp + raw body
      // SendGrid uses ECDSA with SHA-256 for signature verification
      const payload = timestamp + rawBody;
      
      try {
        // Convert base64 public key to PEM format
        // SendGrid provides the key in base64 SPKI format, need to wrap in PEM headers
        // The key might already be in PEM format, or might have whitespace
        let publicKeyPEM: string;
        
        if (publicKey.includes('BEGIN PUBLIC KEY')) {
          // Key is already in PEM format, just clean up whitespace
          publicKeyPEM = publicKey.replace(/\r\n/g, '\n').trim();
        } else {
          // Key is in base64 format, need to wrap in PEM headers
          // Remove all whitespace first
          const cleanPublicKey = publicKey.replace(/\s/g, '');
          // Add PEM headers
          publicKeyPEM = `-----BEGIN PUBLIC KEY-----\n${cleanPublicKey}\n-----END PUBLIC KEY-----`;
        }
        
        // Verify signature: concatenate timestamp + raw body
        // SendGrid uses ECDSA with SHA-256 for signature verification
        const verify = createVerify('SHA256');
        verify.update(payload, 'utf8');
        
        const signatureBuffer = Buffer.from(signature, 'base64');
        
        // Verify the signature using the public key
        // verify() handles the finalization automatically
        const isValid = verify.verify(publicKeyPEM, signatureBuffer);
        
        if (!isValid) {
          console.error('[SendGrid Webhook] Invalid signature - request rejected', {
            timestamp,
            payloadLength: payload.length,
            signatureLength: signature.length,
            publicKeyLength: publicKey.length
          });
          return NextResponse.json(
            { success: false, error: 'Invalid webhook signature' },
            { status: 401 }
          );
        }
        
        console.log('[SendGrid Webhook] Signature verified successfully');
      } catch (verifyError) {
        console.error('[SendGrid Webhook] Signature verification error:', {
          error: verifyError instanceof Error ? verifyError.message : String(verifyError),
          stack: verifyError instanceof Error ? verifyError.stack : undefined
        });
        return NextResponse.json(
          { success: false, error: 'Signature verification failed' },
          { status: 401 }
        );
      }
      
      // Check timestamp to prevent replay attacks (within 5 minutes)
      const requestTime = parseInt(timestamp, 10);
      const currentTime = Math.floor(Date.now() / 1000);
      const timeDiff = Math.abs(currentTime - requestTime);
      const MAX_TIME_DIFF = 5 * 60; // 5 minutes
      
      if (timeDiff > MAX_TIME_DIFF) {
        console.error('[SendGrid Webhook] Request timestamp too old or too far in future:', {
          requestTime,
          currentTime,
          timeDiff
        });
        return NextResponse.json(
          { success: false, error: 'Request timestamp out of acceptable range' },
          { status: 401 }
        );
      }
    } else if (skipVerification) {
      console.warn('[SendGrid Webhook] Signature verification disabled via SENDGRID_SKIP_VERIFICATION');
    } else {
      console.warn('[SendGrid Webhook] SENDGRID_WEBHOOK_PUBLIC_KEY not set - skipping signature verification');
    }
    
    // Parse the JSON body
    const events = JSON.parse(rawBody);
    console.log('[SendGrid Webhook] Parsed events:', {
      isArray: Array.isArray(events),
      count: Array.isArray(events) ? events.length : 0,
      firstEventType: Array.isArray(events) && events.length > 0 ? events[0].event : null
    });
    
    // SendGrid sends events as an array
    if (!Array.isArray(events)) {
      console.error('[SendGrid Webhook] Invalid webhook payload: expected array, got:', typeof events);
      return NextResponse.json({ success: false, error: 'Invalid payload format' }, { status: 400 });
    }

    // Process each event
    let processedCount = 0;
    let skippedCount = 0;
    for (const event of events) {
      try {
        const { event: eventType, email, timestamp, sg_message_id, custom_args } = event;
        
        // First, check if this email exists in our tracking table
        // Only process events for emails we actually sent
        const emailExists = await emailExistsInTracking(email);
        if (!emailExists) {
          // Silently skip events for emails not in our tracking table
          skippedCount++;
          continue;
        }
        
        // Filter by sender email - only process emails from statements@e.skycity.com.au
        const senderEmail = custom_args?.sender_email;
        const expectedSenderEmail = process.env.SENDGRID_FROM_EMAIL || 'statements@e.skycity.com.au';
        
        if (senderEmail && senderEmail !== expectedSenderEmail) {
          // Skip events from other sender emails
          skippedCount++;
          continue;
        }
        
        // Extract email_tracking_id from custom_args (most reliable method)
        let trackingId = custom_args?.email_tracking_id;
        
        // If no tracking ID in custom_args, try to find it by email and message ID
        // Note: SendGrid's sg_message_id format may differ from x-message-id header
        // sg_message_id can be like "filter0001p1mdw1-12345-67-89" or just the short ID
        if (!trackingId && email && sg_message_id) {
          // Try exact match first
          trackingId = await findTrackingRecordByEmailAndMessageId(email, sg_message_id) || null;
          
          // If no exact match, try to extract the short ID from sg_message_id
          // SendGrid format: "filter0001p1mdw1-12345-67-89" or just "12345-67-89"
          // The x-message-id header is usually just the short part after the filter prefix
          if (!trackingId && sg_message_id.includes('-')) {
            const parts = sg_message_id.split('-');
            if (parts.length >= 3) {
              // Extract the short ID part (last 3 segments)
              const shortId = parts.slice(-3).join('-');
              trackingId = await findTrackingRecordByEmailAndMessageId(email, shortId) || null;
            }
          }
        }
        
        // Only use email-only fallback if we have no other way to match
        // This is risky because it could match the wrong record, so we'll be very strict
        if (!trackingId && email) {
          // Only match by email if there's exactly one recent pending/sent record
          // This prevents matching old records
          const connection = await pool.getConnection();
          try {
            const [rows] = await connection.execute<any[]>(
              `SELECT id FROM email_tracking 
               WHERE recipient_email = ? 
               AND status IN ('pending', 'sent', 'delivered')
               AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
               ORDER BY created_at DESC 
               LIMIT 2`,
              [email]
            );
            
            // Only use this if there's exactly one match
            if (rows.length === 1) {
              trackingId = rows[0].id;
              console.log('[SendGrid Webhook] Matched by email only (single recent record):', {
                email,
                trackingId,
                eventType
              });
            } else if (rows.length > 1) {
              // Multiple records - can't safely match, skip this event
              console.warn('[SendGrid Webhook] Cannot match by email - multiple recent records found:', {
                email,
                count: rows.length,
                eventType,
                sg_message_id
              });
            }
          } finally {
            connection.release();
          }
        }
        
        if (!trackingId) {
          // Email exists in tracking but we can't find the specific record
          // This shouldn't happen often, but log it for debugging
          console.warn('[SendGrid Webhook] Email in tracking table but could not find tracking ID:', {
            eventType,
            email,
            sg_message_id,
            hasCustomArgs: !!custom_args,
            customArgsTrackingId: custom_args?.email_tracking_id
          });
          skippedCount++;
          continue;
        }
        
        console.log('[SendGrid Webhook] Processing event:', {
          eventType,
          email,
          trackingId,
          timestamp,
          sg_message_id,
          hasCustomArgs: !!custom_args,
          customArgsTrackingId: custom_args?.email_tracking_id
        });

        const eventTimestamp = timestamp ? new Date(timestamp * 1000) : new Date();

        switch (eventType) {
          case 'delivered':
            // Email was delivered
            await updateEmailTrackingStatus(trackingId, {
              status: 'delivered',
            });
            break;

          case 'open':
            // Email was opened
            // Check if this is a machine open (Apple Mail Privacy Protection, Gmail preloading, etc.)
            const isMachineOpen = event.sg_machine_open === true;
            
            // Additional checks for machine opens:
            // 1. Check if open happened too quickly after delivery (likely preload)
            // 2. Check for specific user agents that indicate machine opens
            // 3. Check if sg_machine_open flag is set
            // 4. Validate that opened_at is after sent_at
            
            // Get the sent_at time to check if open is suspiciously fast or invalid
            let isSuspiciousOpen = false;
            let isInvalidOpen = false;
            if (trackingId) {
              try {
                const connection = await pool.getConnection();
                const [rows] = await connection.execute<any[]>(
                  `SELECT sent_at, opened_at FROM email_tracking WHERE id = ?`,
                  [trackingId]
                );
                connection.release();
                
                if (rows.length > 0 && rows[0].sent_at) {
                  const sentAt = new Date(rows[0].sent_at);
                  const timeSinceSent = eventTimestamp.getTime() - sentAt.getTime();
                  
                  // CRITICAL: If opened_at is before sent_at, this is definitely wrong
                  if (timeSinceSent < 0) {
                    isInvalidOpen = true;
                    console.warn(`[SendGrid Webhook] INVALID open detected: opened ${Math.abs(Math.round(timeSinceSent / 1000))}s BEFORE send - rejecting for tracking ID: ${trackingId}`);
                  }
                  // If opened within 2 minutes of being sent, it's likely a machine open (Gmail preloading)
                  // Gmail often preloads images within 1-2 minutes of delivery
                  else {
                    const MIN_TIME_FOR_REAL_OPEN_MS = 2 * 60 * 1000; // 2 minutes
                    if (timeSinceSent < MIN_TIME_FOR_REAL_OPEN_MS) {
                      isSuspiciousOpen = true;
                      console.log(`[SendGrid Webhook] Suspicious open detected: opened ${Math.round(timeSinceSent / 1000)}s after send - likely machine open/preload`);
                    }
                  }
                } else if (!rows[0]?.sent_at) {
                  // If email hasn't been sent yet, this open is invalid
                  isInvalidOpen = true;
                  console.warn(`[SendGrid Webhook] INVALID open detected: email not yet sent - rejecting for tracking ID: ${trackingId}`);
                }
              } catch (err) {
                // If we can't check, be conservative and skip this open
                console.warn('[SendGrid Webhook] Could not check sent_at time for suspicious open detection - skipping open');
                isSuspiciousOpen = true;
              }
            }
            
            // Check user agent for known machine open patterns
            const userAgent = event.useragent || '';
            const isGmailPreload = userAgent.toLowerCase().includes('gmail') && 
                                   (userAgent.toLowerCase().includes('imageproxy') || 
                                    userAgent.toLowerCase().includes('proxy'));
            const isAppleMailPrivacy = userAgent.toLowerCase().includes('applewebkit') && 
                                       userAgent.toLowerCase().includes('apple');
            
            // Check IP address - Gmail preloading often comes from Google IPs
            const ip = event.ip || '';
            const isGoogleIP = ip.startsWith('66.249.') || ip.startsWith('64.233.') || 
                             ip.startsWith('72.14.') || ip.startsWith('74.125.');
            
            const isLikelyMachineOpen = isMachineOpen || isGmailPreload || isAppleMailPrivacy || isGoogleIP;
            
            console.log('[SendGrid Webhook] Open event:', {
              trackingId,
              email,
              isMachineOpen,
              isSuspiciousOpen,
              isInvalidOpen,
              isLikelyMachineOpen,
              sgMachineOpen: event.sg_machine_open,
              userAgent: event.useragent,
              ip: event.ip,
              isGmailPreload,
              isAppleMailPrivacy,
              isGoogleIP
            });
            
            // Only record if:
            // 1. Not a machine open (by flag or pattern detection)
            // 2. Not suspicious timing
            // 3. Not invalid (before sent_at)
            if (!isLikelyMachineOpen && !isSuspiciousOpen && !isInvalidOpen) {
              await recordEmailOpen(trackingId, eventTimestamp);
              console.log('[SendGrid Webhook] Recorded email open for:', trackingId);
            } else {
              // Log machine/suspicious/invalid opens but don't count them
              let reason = 'unknown';
              if (isInvalidOpen) reason = 'invalid (before sent_at)';
              else if (isMachineOpen) reason = 'machine open flag';
              else if (isGmailPreload) reason = 'Gmail preload';
              else if (isAppleMailPrivacy) reason = 'Apple Mail Privacy';
              else if (isGoogleIP) reason = 'Google IP';
              else if (isSuspiciousOpen) reason = 'suspicious timing';
              
              console.log(`[SendGrid Webhook] Skipping open (${reason}) for tracking ID: ${trackingId}`);
            }
            break;

          case 'delivery':
          case 'spamreport':
          case 'unsubscribe':
          case 'group_unsubscribe':
          case 'group_resubscribe':
            // Other events we can log but don't need to update tracking for
            console.log(`Received ${eventType} event for tracking ID: ${trackingId}`);
            break;

          default:
            console.log(`Unhandled event type: ${eventType} for tracking ID: ${trackingId}`);
        }
        
        processedCount++;
      } catch (eventError) {
        console.error('[SendGrid Webhook] Error processing webhook event:', {
          error: eventError instanceof Error ? eventError.message : String(eventError),
          stack: eventError instanceof Error ? eventError.stack : null,
          eventType: event?.event,
          email: event?.email
        });
        // Continue processing other events even if one fails
      }
    }

    console.log('[SendGrid Webhook] Completed processing:', {
      totalEvents: events.length,
      processed: processedCount,
      skipped: skippedCount
    });

    return NextResponse.json({ success: true, processed: events.length });
  } catch (error) {
    console.error('[SendGrid Webhook] Top-level error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null
    });
    return NextResponse.json(
      { success: false, error: 'Failed to process webhook' },
      { status: 500 }
    );
  }
}

// SendGrid webhooks should only accept POST requests
export async function GET() {
  return NextResponse.json({ message: 'SendGrid webhook endpoint - POST only' }, { status: 405 });
}








