import type { NextRequest } from "next/server";
import { handle } from "@/lib/ai";

export async function POST(req: NextRequest) {
  return handle(req, "verify");
}
