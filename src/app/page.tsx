'use client';

import { drawEncodedBorder, generateUuid } from '@/lib/uuid-border';
import Link from 'next/link';
import { UUIDInput } from '@/components/UUIDInput';
import { useCallback, useState } from 'react';

export default function EncoderPage() {

  const [uuid, setUuid] = useState(generateUuid());

  const regenerateUuid = useCallback(() => {
    setUuid(generateUuid());
  }, []);

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="flex justify-between items-center mb-16">
          <h1 className="font-mono text-sm tracking-wide">encode</h1>
          <Link 
            href="/decode"
            className="font-mono text-sm text-neutral-500 hover:text-black"
          >
            decode →
          </Link>
        </div>

        {/* Input */}
        <div className="p-6">
          <UUIDInput 
            uuid={uuid}
            onRegenerate={regenerateUuid}
            placeholder="type here..."
          />
        </div>

        <div className="p-6">
          {uuid}
        </div>
      </div>
    </main>
  );
}
