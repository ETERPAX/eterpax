import { runRecipientDelivery } from '@/lib/recipient-delivery/worker';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = runRecipientDelivery;
