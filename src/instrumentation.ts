import type { Instrumentation } from "next";

/**
 * Every error the server throws while answering a request (a server
 * component, a route handler, a server action) is recorded in error_events
 * and e-mailed to the owner, in the background, so the answer is never
 * slower for it. Only the Node.js runtime: the middleware's edge runtime has
 * no database client here (the `if` lets the edge build drop the import).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { captureRequestError } = await import("@/features/errors/alerts/server/capture");
      captureRequestError(error, request, context);
    } catch (failure) {
      console.error(
        "[error-alerts] capture failed",
        failure instanceof Error ? failure.message : "unknown",
      );
    }
  }
};
