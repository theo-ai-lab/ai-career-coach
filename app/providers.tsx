'use client';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect } from 'react';

export function PHProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
    
    // Only initialize PostHog if the key is provided
    if (posthogKey) {
      posthog.init(posthogKey, {
        api_host: posthogHost || 'https://app.posthog.com',
        person_profiles: 'identified_only'
      });
    }
  }, []);
  
  // Only wrap with PostHogProvider if PostHog is initialized
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (posthogKey) {
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
  }
  
  // Return children without PostHog if not configured
  return <>{children}</>;
}