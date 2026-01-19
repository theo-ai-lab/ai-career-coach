import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key');
  }
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(req.url);
    const resumeId = searchParams.get('resumeId');

    // Get total document count
    const { count: totalCount } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true });

    // Get sample documents
    const { data: samples, error: sampleError } = await supabase
      .from('documents')
      .select('id, metadata')
      .limit(5);

    // If resumeId provided, check for matching documents
    let matchingDocs = null;
    if (resumeId) {
      const { data, error } = await supabase
        .from('documents')
        .select('id, metadata')
        .eq('metadata->>resume_id', resumeId)
        .limit(10);
      
      matchingDocs = { data, error, count: data?.length || 0 };
    }

    return NextResponse.json({
      totalDocuments: totalCount,
      sampleDocuments: samples?.map(d => ({
        id: d.id,
        metadata: d.metadata,
        resume_id: d.metadata?.resume_id
      })),
      resumeIdQuery: resumeId || 'not provided',
      matchingDocuments: matchingDocs,
      localStorageResumeId: 'Check browser console: localStorage.getItem("currentResumeId")'
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}





