'use client';

import { useEffect, useState } from 'react';
import { refreshName, savedName } from '@/lib/account/profile';

function greetingFor(hour: number): [string, string] {
  if (hour < 5) return ['Hey night owl', '🦉'];
  if (hour < 12) return ['Good morning', '☀️'];
  if (hour < 17) return ['Good afternoon', '🌤️'];
  if (hour < 22) return ['Good evening', '🌆'];
  return ['Hey night owl', '🦉'];
}

/** "Good evening, Ashutosh 🌆" once a signed-in app has told us the shopper's name; nothing otherwise. */
export function Greeting() {
  const [name, setName] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);

  useEffect(() => {
    // Client-only: the server doesn't know the shopper's clock or name.
    setHour(new Date().getHours());
    setName(savedName());
    const lookUp = () => void refreshName().then(setName);
    const reread = () => setName(savedName());
    lookUp();
    window.addEventListener('jhola:accounts', lookUp);
    window.addEventListener('jhola:profile', reread);
    return () => {
      window.removeEventListener('jhola:accounts', lookUp);
      window.removeEventListener('jhola:profile', reread);
    };
  }, []);

  if (!name || hour === null) return null;
  const [words, emoji] = greetingFor(hour);
  return (
    <p className="text-[0.95rem] font-medium text-muted sm:text-base" data-testid="greeting">
      {words}, {name} <span aria-hidden>{emoji}</span>
    </p>
  );
}
