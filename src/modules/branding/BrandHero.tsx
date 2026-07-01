import { useEffect, useState, useCallback } from 'react';

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

export function BrandHero({ heroUrls, interval = 5000 }: { heroUrls: string[]; interval?: number }) {
  const [idx, setIdx] = useState(0);
  const reduce = usePrefersReducedMotion();
  const n = heroUrls.length;

  const go = useCallback((next: number) => setIdx(() => ((next % n) + n) % n), [n]);

  useEffect(() => {
    if (reduce || n < 2) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % n), interval);
    return () => clearInterval(id);
  }, [reduce, n, interval]);

  useEffect(() => {
    if (n < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(idx - 1);
      else if (e.key === 'ArrowRight') go(idx + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, n, go]);

  if (n === 0) return null;
  const current = heroUrls[Math.min(idx, n - 1)]!;

  return (
    <div className="brand-hero-carousel">
      <img className="brand-hero" src={current} alt="" />
      {n > 1 && (
        <>
          <button type="button" className="brand-hero-nav brand-hero-prev" aria-label="Previous slide" onClick={() => go(idx - 1)}>‹</button>
          <button type="button" className="brand-hero-nav brand-hero-next" aria-label="Next slide" onClick={() => go(idx + 1)}>›</button>
          <div className="brand-hero-dots">
            {heroUrls.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`brand-hero-dot${i === idx ? ' is-active' : ''}`}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === idx}
                onClick={() => go(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
