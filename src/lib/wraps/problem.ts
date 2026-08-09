export type WrapProblem = {
  code: string;
  problem: string;
  rule: string;
  nextAction: string;
};

export function wrapProblem(
  status: number,
  code: string,
  problem: string,
  rule: string,
  nextAction: string,
  headers: HeadersInit = {},
) {
  return new Response(
    JSON.stringify({ error: { code, problem, rule, nextAction } }),
    {
      status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        ...headers,
      },
    },
  );
}
