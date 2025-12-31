import { NextRequest, NextResponse } from 'next/server';
import { updateEmailTrackingStatus, recordEmailOpen, findTrackingRecordByEmailAndMessageId, emailExistsInTracking } from '@/lib/db/email';
import { createVerify } from 'crypto';

/**
 * SendGrid Event Webhook Handler
 * 
 * Receives events from SendGrid and updates email tracking records.
 * 
 * Events handled:
 * - processed: Email was sent (update status to 'sent', set sent_at)
 * - delivered: Email was delivered (update status to 'delivered')
 * - open: Email was opened (increment open_count, set opened_at/last_opened_at)
 * - bounce: Email bounced (update status to 'bounced')
 * - dropped: Email was dropped (update status to 'failed')
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
    if (publicKey) {
      const signature = request.headers.get('x-twilio-email-event-webhook-signature');
      const timestamp = request.headers.get('x-twilio-email-event-webhook-timestamp');
      
      if (!signature || !timestamp) {
        console.error('[SendGrid Webhook] Missing signature or timestamp headers');
        return NextResponse.json(
          { success: false, error: 'Missing webhook signature headers' },
          { status: 401 }
        );
      }
      
      // Verify signature: concatenate timestamp + raw body
      const payload = timestamp + rawBody;
      
      try {
        // Convert base64 public key to PEM format
        // SendGrid provides the key in base64 SPKI format, need to wrap in PEM headers
        const publicKeyPEM = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
        
        // Verify signature: concatenate timestamp + raw body
        const verify = createVerify('SHA256');
        verify.update(payload, 'utf8');
        verify.end();
        
        const signatureBuffer = Buffer.from(signature, 'base64');
        
        // Verify the signature using the public key
        const isValid = verify.verify(publicKeyPEM, signatureBuffer);
        
        if (!isValid) {
          console.error('[SendGrid Webhook] Invalid signature - request rejected');
          return NextResponse.json(
            { success: false, error: 'Invalid webhook signature' },
            { status: 401 }
          );
        }
        
        console.log('[SendGrid Webhook] Signature verified successfully');
      } catch (verifyError) {
        console.error('[SendGrid Webhook] Signature verification error:', verifyError);
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
        
        // Extract email_tracking_id from custom_args
        let trackingId = custom_args?.email_tracking_id;
        
        // If no tracking ID in custom_args, try to find it by email and message ID
        if (!trackingId && email && sg_message_id) {
          trackingId = await findTrackingRecordByEmailAndMessageId(email, sg_message_id) || null;
        }
        
        // If still no tracking ID, try to find by email only (most recent)
        if (!trackingId && email) {
          trackingId = await findTrackingRecordByEmailAndMessageId(email, null) || null;
        }
        
        if (!trackingId) {
          // Email exists in tracking but we can't find the specific record
          // This shouldn't happen often, but log it for debugging
          console.warn('[SendGrid Webhook] Email in tracking table but could not find tracking ID:', {
            eventType,
            email,
            sg_message_id,
            hasCustomArgs: !!custom_args
          });
          skippedCount++;
          continue;
        }
        
        console.log('[SendGrid Webhook] Processing event:', {
          eventType,
          email,
          trackingId,
          timestamp
        });

        const eventTimestamp = timestamp ? new Date(timestamp * 1000) : new Date();

        switch (eventType) {
          case 'processed':
            // Email was sent
            await updateEmailTrackingStatus(trackingId, {
              status: 'sent',
              sendgrid_message_id: sg_message_id || null,
              sent_at: eventTimestamp,
            });
            break;

          case 'delivered':
            // Email was delivered
            await updateEmailTrackingStatus(trackingId, {
              status: 'delivered',
            });
            break;

          case 'open':
            // Email was opened
            // Check if this is a machine open (Apple Mail Privacy Protection, etc.)
            const isMachineOpen = event.sg_machine_open === true;
            
            console.log('[SendGrid Webhook] Open event:', {
              trackingId,
              email,
              isMachineOpen,
              sgMachineOpen: event.sg_machine_open
            });
            
            // Only record if not a machine open (optional - you may want to record all opens)
            if (!isMachineOpen) {
              await recordEmailOpen(trackingId, eventTimestamp);
              console.log('[SendGrid Webhook] Recorded email open for:', trackingId);
            } else {
              // Log machine opens but don't count them
              console.log(`[SendGrid Webhook] Machine open detected for tracking ID: ${trackingId}`);
            }
            break;

          case 'bounce':
            // Email bounced
            await updateEmailTrackingStatus(trackingId, {
              status: 'bounced',
              error_message: event.reason || 'Email bounced',
            });
            break;

          case 'dropped':
            // Email was dropped
            await updateEmailTrackingStatus(trackingId, {
              status: 'failed',
              error_message: event.reason || 'Email was dropped',
            });
            break;

          case 'deferred':
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








