import { config } from '../config';

type EmailRoute = '/api/auth/forgot-password' | '/api/orders/confirmation';

let warnedMissingSecret = false;

/**
 * Asks the frontend to send an email. The frontend's email routes accept only
 * calls carrying the shared secret, so nobody else can send mail in the shop's
 * name. Never throws: a failed email must not fail the order or the reset.
 * Logs never include the customer's email address.
 */
export async function notifyFrontend(path: EmailRoute, payload: object): Promise<void> {
  if (!config.internalApiSecret) {
    if (!warnedMissingSecret) {
      console.warn('INTERNAL_API_SECRET is not set, so no emails are sent.');
      warnedMissingSecret = true;
    }
    return;
  }

  try {
    const response = await fetch(`${config.frontendUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': config.internalApiSecret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`Email request to ${path} failed with status ${response.status}`);
    }
  } catch (error) {
    console.error(`Email request to ${path} failed: ${error instanceof Error ? error.message : error}`);
  }
}
