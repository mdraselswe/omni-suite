# 8. OmniSuite runs in server mode only, without Cache Components

## Decision

- OmniSuite is a server-mode app (`render: "server"`). Static export is not supported: every page depends on the signed-in user and tenant. This replaces the starter rule "both render modes must build" for this project.
- `cacheComponents` and `partialPrefetching` are off. Pages render per request and stream with `loading.tsx` and `<Suspense>` skeletons.
- Speed comes from the data side: indexed tenant-scoped queries, few queries per page, an in-memory cache for permissions and domains, and Postgres next to the app.

## Why

With Cache Components every session and params read must sit inside its own Suspense boundary or the build fails. In an app where every page is per-user, that adds structure without a measurable gain. Streaming with loading states gives the same perceived speed with less complexity.
