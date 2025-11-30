// app/api/agents/resume/route.ts

import { NextRequest } from "next/server";

import { analyzeResume } from "@/lib/agents/resume-analyzer/node";



export async function POST(req: NextRequest) {

  try {

    const { userId, resumeText } = await req.json();

    if (!userId || !resumeText) return Response.json({ error: "Missing data" }, { status: 400 });



    const analysis = await analyzeResume(userId, resumeText);

    return Response.json({ success: true, analysis });

  } catch (error: any) {

    return Response.json({ error: error.message }, { status: 500 });

  }

}

