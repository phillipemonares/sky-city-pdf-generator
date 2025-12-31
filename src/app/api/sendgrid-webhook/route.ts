import { NextRequest, NextResponse } from 'next/server';
import { updateEmailTrackingStatus, recordEmailOpen } from '@/lib/db/email';

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
 */
export async function POST(request: NextRequest) {
  console.log('[SendGrid Webhook] Received POST request');
  
  try {
    const events = await request.json();
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
        
        // Extract email_tracking_id from custom_args
        const trackingId = custom_args?.email_tracking_id;
        
        if (!trackingId) {
          console.warn('[SendGrid Webhook] Event missing email_tracking_id:', {
            eventType,
            email,
            hasCustomArgs: !!custom_args,
            customArgsKeys: custom_args ? Object.keys(custom_args) : null
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








