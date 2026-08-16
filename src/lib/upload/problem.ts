import { NextResponse } from "next/server";

export function uploadProblem(
  status: number,
  code: string,
  problem: string,
  rule: string,
  nextAction: string,
  headers: HeadersInit = {},
) {
  return NextResponse.json(
    { error: { code, problem, rule, nextAction } },
    {
      status,
      headers: { "cache-control": "no-store", ...headers },
    },
  );
}
