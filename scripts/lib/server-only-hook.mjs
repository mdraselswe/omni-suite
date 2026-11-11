/**
 * Lets server code run outside Next (pnpm db:seed / db:migrate under tsx):
 * "server-only" throws unless bundled for React Server Components, so it
 * resolves to an empty module here.
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
