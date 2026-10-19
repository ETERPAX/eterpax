'use client';
import { useEffect, useRef, useState } from 'react';
type Asset = { id: string; kind: 'voice' | 'video' | 'photo' | 'document' };
type Message = { id: string; assets: Asset[] };
function Letter({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/recipient/content?item=${id}`, { cache: 'no-store', signal: controller.signal }).then(async res => {
      if (!res.ok) throw new Error();
      const body = await res.json();
      // Stored letters may be editor HTML. Convert to text in an inert document;
      // never execute or render HTML supplied by an owner.
      const template = document.createElement('template');
      template.innerHTML = body.text;
      const doc = template.content;
      doc.querySelectorAll('script,style,iframe,object').forEach(node => node.remove());
      doc.querySelectorAll('p,div,br,li,h1,h2,h3').forEach(node => node.append('\n'));
      setText(doc.textContent ?? '');
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [id]);
  if (error) return <p role="alert">This letter could not be opened. Please reopen your email link and try again.</p>;
  return <p className="whitespace-pre-wrap leading-8 text-slate-700">{text === null ? 'Opening letter…' : text}</p>;
}
export default function RecipientCollection() {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState('');
  const tokenRef = useRef<string | null>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const controller = new AbortController();
    // Keep the capability out of URLs sent to servers, referrers and history.
    tokenRef.current ??= window.location.hash.slice(1);
    const token = tokenRef.current;
    window.history.replaceState(null, '', window.location.pathname);
    async function open() {
      if (token) {
        const session = await fetch('/api/recipient/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }), signal: controller.signal });
        if (!session.ok) throw new Error();
      }
      const response = await fetch('/api/recipient/messages', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error();
      setMessages((await response.json()).messages);
    }
    void open().catch(() => { if (!controller.signal.aborted) setError('This private link is unavailable or has expired. Reopen the original email from ETERPAX.'); });
    return () => controller.abort();
  }, []);
  return <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:py-20">
    <p className="text-sm tracking-widest text-slate-500">ETERPAX</p>
    <h1 className="mt-4 text-3xl font-semibold text-slate-900">Messages entrusted to you</h1>
    <p className="mt-4 text-slate-600">Take your time. Your letters and memories are gathered here in a private collection. Keep your email link private.</p>
    {error ? <p role="alert" className="mt-8 rounded-xl bg-white p-6">{error}</p> : !messages ? <p role="status" className="mt-8">Opening your collection…</p> :
      <div className="mt-8 space-y-6">{messages.map((message, index) => <section key={message.id} className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        <h2 className="mb-5 text-xl font-medium">Message {index + 1}</h2>
        <Letter id={message.id} />
        <div className="mt-5 space-y-5">{message.assets.map((asset, assetIndex) => {
          const url = `/api/recipient/content?item=${message.id}&asset=${asset.id}`;
          const label = `${asset.kind === 'voice' ? 'Voice recording' : asset.kind.charAt(0).toUpperCase() + asset.kind.slice(1)} ${assetIndex + 1}`;
          return <div key={asset.id}><p className="mb-2 text-sm text-slate-600">{label}</p>
            {asset.kind !== 'document' && <a href={url} download className="mb-3 inline-block text-sm underline">Download {label.toLowerCase()}</a>}
            {failed[asset.id] && <p role="alert" className="mb-3 text-sm">Preview unavailable. Try downloading the file, or reopen your email link if access has expired.</p>}
            {asset.kind === 'document' ? <a href={url} download className="inline-block rounded-lg bg-slate-900 px-4 py-3 text-white">Download document</a> :
              !opened[asset.id] ? <button className="rounded-lg border border-slate-300 px-4 py-3" onClick={() => setOpened(current => ({ ...current, [asset.id]: true }))}>Open {label.toLowerCase()}</button> :
                asset.kind === 'voice' ? <audio src={url} aria-label={label} onError={() => setFailed(current => ({ ...current, [asset.id]: true }))} controls preload="none" className="w-full" /> :
                  asset.kind === 'video' ? <video src={url} aria-label={label} onError={() => setFailed(current => ({ ...current, [asset.id]: true }))} controls preload="metadata" playsInline className="w-full rounded-lg" /> :
                    // Authenticated same-origin image; Next optimization must not proxy/cache it.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={label} onError={() => setFailed(current => ({ ...current, [asset.id]: true }))} className="h-auto max-w-full rounded-lg" />}
          </div>;
        })}</div>
      </section>)}</div>}
    <p className="mt-10 text-sm text-slate-500">Access expires 30 days after your notification is prepared. Download the memories you wish to keep.</p>
  </main>;
}
