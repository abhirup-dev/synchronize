import { requestJson, type ClientConfig } from "../client.ts";
import type { AnnotationQuery, AnnotationQueryResult } from "../annotate/query.ts";
import type { AnnotateResult } from "../annotate/index.ts";

// Ingest: (re)parse a session transcript into the annotation lake.
export function annotateSession(client: ClientConfig, input: { session: string }): Promise<AnnotateResult> {
  return requestJson<AnnotateResult>(client, "/annotate", {
    method: "POST",
    body: JSON.stringify({ session: input.session }),
  });
}

// Query the annotation lake with an engine-neutral spec.
export function queryAnnotations(client: ClientConfig, spec: AnnotationQuery): Promise<AnnotationQueryResult> {
  return requestJson<AnnotationQueryResult>(client, "/query/annotations", {
    method: "POST",
    body: JSON.stringify(spec),
  });
}
