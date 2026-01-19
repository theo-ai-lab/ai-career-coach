-- Create the match_documents RPC function for vector similarity search
-- This function returns documents with metadata for filtering by resume_id

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Grant execute permission to anon role (for API routes)
GRANT EXECUTE ON FUNCTION match_documents(vector, int) TO anon;
GRANT EXECUTE ON FUNCTION match_documents(vector, int) TO authenticated;








