import type { Metadata } from 'next';
import RecipientCollection from './recipient-collection';
export const metadata: Metadata = { title: 'Your private messages — ETERPAX', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function RecipientPage() { return <RecipientCollection />; }
