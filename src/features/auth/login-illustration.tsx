import { cn } from "@/lib/utils";

/**
 * Decorative picture for the sign-in panel: a small dashboard drawn with shapes,
 * in the theme's colours, with two cards floating gently (off with reduced motion).
 */
export function LoginIllustration({ className }: { className?: string }) {
  return (
    <div className={cn("relative mx-auto w-full max-w-lg", className)} aria-hidden="true">
      <div className="rounded-2xl bg-primary-foreground/12 p-3 ring-1 ring-primary-foreground/20 backdrop-blur-sm">
        <div className="grid grid-cols-[3.5rem_1fr] gap-3 rounded-xl bg-card p-3 text-card-foreground shadow-2xl">
          <div className="grid content-start gap-2 rounded-lg bg-muted p-2">
            <span className="mb-1 size-7 rounded-lg bg-gradient-1" />
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className={cn("h-2 rounded-full", i === 1 ? "bg-primary/60" : "bg-border")} />
            ))}
          </div>
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-2">
              <span className="h-12 rounded-lg bg-gradient-1" />
              <span className="h-12 rounded-lg bg-gradient-2" />
              <span className="h-12 rounded-lg bg-gradient-3" />
            </div>
            <div className="rounded-lg bg-muted p-2">
              <svg viewBox="0 0 200 70" className="h-24 w-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="login-art-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" className="[stop-color:var(--primary)]" stopOpacity="0.3" />
                    <stop offset="100%" className="[stop-color:var(--primary)]" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0,55 C25,50 35,30 60,34 C85,38 95,18 120,20 C145,22 160,8 200,10 L200,70 L0,70 Z"
                  fill="url(#login-art-fill)"
                />
                <path
                  d="M0,55 C25,50 35,30 60,34 C85,38 95,18 120,20 C145,22 160,8 200,10"
                  fill="none"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  className="stroke-primary"
                />
                <path
                  d="M0,62 C30,60 45,48 70,50 C95,52 115,40 140,42 C165,44 180,34 200,36"
                  fill="none"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                  className="stroke-brand-accent"
                />
              </svg>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[70, 45].map((w) => (
                <div key={w} className="grid gap-1.5 rounded-lg bg-muted p-2">
                  <span className="h-1.5 w-1/2 rounded-full bg-border" />
                  <span className="h-1.5 rounded-full bg-border">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="absolute top-10 -left-6 hidden w-36 animate-float rounded-xl bg-card p-3 text-card-foreground shadow-xl sm:block">
        <span className="mb-2 block size-6 rounded-md bg-gradient-2" />
        <span className="block h-2 w-3/4 rounded-full bg-border" />
        <span className="mt-1.5 block h-2 w-1/2 rounded-full bg-muted" />
      </div>
      <div className="absolute -right-5 bottom-8 hidden w-40 animate-float rounded-xl bg-card p-3 text-card-foreground shadow-xl [animation-delay:-3s] sm:block">
        <div className="flex items-center gap-2">
          <span className="size-7 rounded-full bg-gradient-3" />
          <span className="grid flex-1 gap-1">
            <span className="h-2 w-full rounded-full bg-border" />
            <span className="h-2 w-2/3 rounded-full bg-muted" />
          </span>
        </div>
      </div>
    </div>
  );
}
