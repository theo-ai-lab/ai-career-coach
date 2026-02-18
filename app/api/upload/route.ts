import { NextRequest } from "next/server";

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

import { OpenAIEmbeddings } from "@langchain/openai";

import { createClient } from "@supabase/supabase-js";

import { randomUUID } from "crypto";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key);
}

function getEmbeddings() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAIEmbeddings({
    openAIApiKey: apiKey,
    model: "text-embedding-3-small",
  });
}

export async function POST(req: NextRequest) {

  try {

    const formData = await req.formData();

    const file = formData.get("file") as File;

    const userId = formData.get("userId") as string;

    if (!file || !userId) {

      return Response.json({ error: "Missing file or userId" }, { status: 400 });

    }

    const supabase = getSupabaseClient();
    const embeddings = getEmbeddings();

    const buffer = Buffer.from(await file.arrayBuffer());

    const pdfParse = require("pdf-parse");

    const pdfData = await pdfParse(buffer);

    const text = pdfData.text;

    if (!text.trim()) {

      return Response.json({ error: "No text extracted" }, { status: 400 });

    }

    const splitter = new RecursiveCharacterTextSplitter({

      chunkSize: 1000,

      chunkOverlap: 200,

    });

    const chunks = await splitter.createDocuments([text]);

    const vectors = await embeddings.embedDocuments(chunks.map(c => c.pageContent));

    const resumeId: string = randomUUID();

    const documentsToInsert = chunks.map((chunk, i) => ({

      content: chunk.pageContent,

      embedding: vectors[i],

      metadata: { 

        source: file.name, 

        user_id: userId,

        resume_id: resumeId

      },

    }));

    const { error } = await supabase

      .from("documents")

      .insert(documentsToInsert as any);

    if (error) throw error;

    return Response.json({ success: true, resumeId, chunks: chunks.length });

  } catch (error: any) {

    console.error("RAG ingestion failed:", error);

    return Response.json({ error: error.message }, { status: 500 });

}

}

export const runtime = 'nodejs';
