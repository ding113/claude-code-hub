import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateLogs } from "@/lib/data-generator/generator";
import type { GeneratorParams } from "@/lib/data-generator/types";

// 需要数据库连接
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await request.json();

    const { startDate, endDate, totalRecords, totalCostCny, models, userIds, providerIds } = body;

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
    }

    const params: GeneratorParams = {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      totalRecords,
      totalCostCny,
      models,
      userIds,
      providerIds,
    };

    const result = await generateLogs(params);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error generating logs:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate logs" },
      { status: 500 }
    );
  }
}
