// app/api/agents/gap/route.ts

import { NextRequest } from "next/server";

import { findGaps } from "@/lib/agents/gap-finder/node";

import { ResumeAnalysis } from "@/lib/agents/resume-analyzer/schema";



export async function POST(req: NextRequest) {

  try {

    const { resumeAnalysis, jobDescription } = await req.json();

    if (!resumeAnalysis || !jobDescription) return Response.json({ error: "Missing data" }, { status: 400 });



    const gaps = await findGaps(resumeAnalysis as ResumeAnalysis, jobDescription);

    return Response.json({ success: true, gaps });

  } catch (error: any) {

    return Response.json({ error: error.message }, { status: 500 });

  }

}

